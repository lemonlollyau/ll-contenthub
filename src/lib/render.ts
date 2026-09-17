import "server-only";
import sharp from "sharp";
import { config } from "./config";
import { db, must } from "./db";
import { downloadFile } from "./google-drive";
import { decodable } from "./images";
import type { Format } from "./types";

// Crops, resizes and compresses an image for a format, then puts it in the
// public "rendered" bucket at a stable path: <client>/<yyyy-mm>/<item>-<format>[-n].jpg

export const RENDER_SIZES = {
  feed: { width: 1080, height: 1350, label: "Feed 4:5" },
  square: { width: 1080, height: 1080, label: "Square 1:1" },
  story: { width: 1080, height: 1920, label: "Story / Reel 9:16" },
  email: { width: 1200, height: null, label: "Email (1200 wide)" },
  blog_hero: { width: 1600, height: 900, label: "Blog hero 16:9" },
} as const;
export type RenderFormat = keyof typeof RENDER_SIZES;

export function renderFormatFor(format: Format | null): RenderFormat {
  if (format === "square") return "square";
  if (format === "story" || format === "reel") return "story";
  return "feed";
}

/** Crop box in source pixels (after EXIF rotation). */
export type Crop = { left: number; top: number; width: number; height: number };

// Platform limits we flag rather than fix (no transcoding in v1).
export const VIDEO_LIMITS = { maxBytes: 50 * 1024 * 1024, reelMaxSeconds: 90, storyMaxSeconds: 60 };

export async function renderImage(source: Buffer, format: RenderFormat, crop?: Crop | null): Promise<{ data: Buffer; warnings: string[] }> {
  const size = RENDER_SIZES[format];
  const warnings: string[] = [];
  // Normalise orientation first so crop coordinates match what the UI shows.
  const upright = await sharp(source, { failOn: "none" }).rotate().toBuffer({ resolveWithObject: true });
  let img = sharp(upright.data);
  let srcW = upright.info.width;
  let srcH = upright.info.height;
  if (crop) {
    const c = clampCrop(crop, srcW, srcH);
    img = img.extract(c);
    srcW = c.width;
    srcH = c.height;
  }
  if (srcW < size.width * 0.8 || (size.height && srcH < size.height * 0.8)) {
    warnings.push(`Source is only ${srcW}×${srcH}; it will look soft at ${size.width}${size.height ? `×${size.height}` : " wide"}.`);
  }
  img = size.height
    ? img.resize(size.width, size.height, { fit: "cover", position: crop ? "centre" : sharp.strategy.attention })
    : img.resize({ width: size.width, withoutEnlargement: false });
  // No withMetadata(): EXIF (including GPS location) is stripped.
  let data = await img.flatten({ background: "#ffffff" }).jpeg({ quality: 85, mozjpeg: true, progressive: true }).toBuffer();
  if (data.length > 4.5 * 1024 * 1024) {
    data = await sharp(data).jpeg({ quality: 72, mozjpeg: true }).toBuffer();
  }
  return { data, warnings };
}

function clampCrop(c: Crop, w: number, h: number): Crop {
  const left = Math.max(0, Math.min(Math.round(c.left), w - 1));
  const top = Math.max(0, Math.min(Math.round(c.top), h - 1));
  return {
    left,
    top,
    width: Math.max(1, Math.min(Math.round(c.width), w - left)),
    height: Math.max(1, Math.min(Math.round(c.height), h - top)),
  };
}

export function renderPath(clientSlug: string, postDate: string | null, itemId: string, format: string, position: number, ext: string) {
  const month = postDate?.slice(0, 7) ?? "undated";
  return `${clientSlug}/${month}/${itemId}-${format}${position > 0 ? `-${position + 1}` : ""}.${ext}`;
}

export function publicUrl(path: string): string {
  return db().storage.from(config.storage.renderedBucket).getPublicUrl(path).data.publicUrl;
}

type RenderTarget = {
  clientId: string;
  clientSlug: string;
  item: { id: string; post_date: string | null };
  asset: { id: string; drive_file_id: string; name: string; mime_type: string; kind: string; size_bytes: number | null; duration_ms: number | null };
  format: RenderFormat;
  position: number;
  crop?: Crop | null;
  itemFormat?: Format | null;
};

/** Renders (or copies, for video) one asset for one item and records it. */
export async function renderAndStore(t: RenderTarget): Promise<{ url: string; warnings: string[] }> {
  const warnings: string[] = [];
  let data: Buffer;
  let ext = "jpg";
  let contentType = "image/jpeg";

  if (t.asset.kind === "video") {
    if (t.asset.size_bytes && t.asset.size_bytes > VIDEO_LIMITS.maxBytes) {
      throw new Error(`"${t.asset.name}" is ${Math.round(t.asset.size_bytes / 1048576)} MB. Videos over 50 MB need compressing before upload.`);
    }
    const secs = (t.asset.duration_ms ?? 0) / 1000;
    if (t.itemFormat === "story" && secs > VIDEO_LIMITS.storyMaxSeconds) warnings.push(`Video is ${Math.round(secs)}s; stories are split or cut after 60s.`);
    if (t.itemFormat === "reel" && secs > VIDEO_LIMITS.reelMaxSeconds) warnings.push(`Video is ${Math.round(secs)}s; check the reel length limit.`);
    data = await downloadFile(t.asset.drive_file_id, t.clientId);
    ext = t.asset.mime_type === "video/quicktime" ? "mov" : "mp4";
    contentType = t.asset.mime_type;
  } else {
    const source = await decodable(await downloadFile(t.asset.drive_file_id, t.clientId), t.asset.mime_type, t.asset.name);
    const out = await renderImage(source, t.format, t.crop);
    data = out.data;
    warnings.push(...out.warnings);
  }

  const path = renderPath(t.clientSlug, t.item.post_date, t.item.id, t.format, t.position, ext);
  const up = await db().storage.from(config.storage.renderedBucket).upload(path, data, {
    contentType,
    upsert: true,
    cacheControl: "60",
  });
  if (up.error) throw new Error(`Couldn't upload the prepared file: ${up.error.message}`);
  const url = publicUrl(path);
  const size = RENDER_SIZES[t.format];

  // One rendered file per (item, position, format): clear whatever was there.
  must(
    await db().from("rendered_assets").delete().eq("content_item_id", t.item.id).eq("format", t.format).eq("storage_path", path).select("id"),
    "replace the old render",
  );
  must(
    await db()
      .from("rendered_assets")
      .upsert(
        {
          asset_id: t.asset.id,
          content_item_id: t.item.id,
          format: t.format,
          width: size.width,
          height: size.height,
          crop: t.crop ?? null,
          storage_path: path,
          public_url: url,
          size_bytes: data.length,
          warnings,
          created_at: new Date().toISOString(),
        },
        { onConflict: "content_item_id,asset_id,format" },
      )
      .select("id"),
    "record the prepared image",
  );
  return { url, warnings };
}

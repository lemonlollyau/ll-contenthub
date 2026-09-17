import "server-only";
import sharp from "sharp";

// Shared image helpers: HEIC → JPEG, EXIF orientation, and smaller copies.

function isHeic(buf: Buffer, mime?: string, name?: string): boolean {
  if (mime && /heic|heif/i.test(mime)) return true;
  if (name && /\.(heic|heif)$/i.test(name)) return true;
  // ISO-BMFF "ftyp" box with a HEIF brand.
  const brand = buf.subarray(8, 12).toString("ascii");
  return buf.subarray(4, 8).toString("ascii") === "ftyp" && /^(heic|heix|hevc|hevx|mif1|msf1)$/.test(brand);
}

/** Returns a buffer sharp can read (HEIC is converted to JPEG first). */
export async function decodable(buf: Buffer, mime?: string, name?: string): Promise<Buffer> {
  if (!isHeic(buf, mime, name)) return buf;
  const { default: convert } = await import("heic-convert");
  const out = await convert({ buffer: buf, format: "JPEG", quality: 0.95 });
  return Buffer.from(out);
}

/** Auto-rotated sharp pipeline. Metadata (incl. GPS) is dropped unless asked for. */
export function pipeline(buf: Buffer) {
  return sharp(buf, { failOn: "none" }).rotate();
}

export async function dimensions(buf: Buffer): Promise<{ width: number; height: number }> {
  const meta = await sharp(buf, { failOn: "none" }).metadata();
  const w = meta.width ?? 0;
  const h = meta.height ?? 0;
  // EXIF orientations 5–8 are rotated 90°, so the displayed size is swapped.
  return (meta.orientation ?? 1) >= 5 ? { width: h, height: w } : { width: w, height: h };
}

export async function thumbnail(buf: Buffer): Promise<Buffer> {
  return pipeline(buf).resize(480, 480, { fit: "inside", withoutEnlargement: true }).webp({ quality: 72 }).toBuffer();
}

/** A modest JPEG for Claude vision (long edge 1024px keeps cost down). */
export async function visionCopy(buf: Buffer): Promise<Buffer> {
  return pipeline(buf).resize(1024, 1024, { fit: "inside", withoutEnlargement: true }).jpeg({ quality: 80 }).toBuffer();
}

export function orientationOf(width?: number | null, height?: number | null): "portrait" | "landscape" | "square" | "unknown" {
  if (!width || !height) return "unknown";
  const r = width / height;
  if (r > 1.05) return "landscape";
  if (r < 0.95) return "portrait";
  return "square";
}

import "server-only";
import { randomUUID } from "node:crypto";
import { config } from "./config";
import { db, must } from "./db";
import { isCaptionLocked } from "./flags";
import { pipeline } from "./images";
import { signedThumbs } from "./thumbs";
import type { Asset, Client, ContentItem } from "./types";

// Shared by the phone Pick page (/pick, Google sign-in) and the Chrome
// extension (/api/ext/*, shared key): upcoming posts, the Drive library,
// and photos picked on the phone waiting to be designed.

/** Today's date (yyyy-mm-dd) in a client's time zone. */
export function todayIn(timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

export type PostSummary = ReturnType<typeof summarise>;

function summarise(i: ContentItem) {
  return {
    id: i.id,
    row: i.row_number,
    date: i.post_date,
    time: i.post_time?.slice(0, 5) ?? null,
    channels: i.channels,
    format: i.format,
    pillar: i.pillar,
    hook: i.hook,
    caption: i.caption,
    captionLocked: isCaptionLocked(i),
    cta: i.cta,
    hashtags: i.hashtags,
    firstComment: i.first_comment,
    assetBrief: i.asset_brief,
    moment: i.moment_offer,
    status: i.status,
    alreadyPushed: Object.keys(i.external_posts ?? {}),
    customMedia: i.custom_media ?? [],
  };
}

/** A client's social posts from 3 days ago onwards, plus undated ones. */
export async function upcomingPosts(client: Client) {
  const from = new Date(Date.parse(todayIn(client.timezone)) - 3 * 86400_000).toISOString().slice(0, 10);
  const items = must(
    await db()
      .from("content_items")
      .select("*")
      .eq("client_id", client.id)
      .eq("type", "social")
      .or(`post_date.gte.${from},post_date.is.null`)
      .order("post_date", { nullsFirst: false })
      .order("row_number")
      .limit(150),
    "load posts",
  ) as ContentItem[];
  return items.map(summarise);
}

type LibraryRow = Pick<Asset, "id" | "drive_file_id" | "folder_path" | "name" | "width" | "height" | "thumbnail_path" | "ai_description">;

/**
 * Preview URL for a library photo. Untagged photos have no stored thumbnail
 * yet; for signed-in pages, /api/thumb makes one from Drive on first view.
 * The Chrome extension can't use that route (no sign-in), so it gets null.
 */
function previewFor(assetId: string, path: string | null, thumbs: Record<string, string>, driveFallback: boolean) {
  if (path && thumbs[path]) return thumbs[path];
  return driveFallback ? `/api/thumb/${assetId}` : null;
}

/** Images in a client's synced Drive library, by search words and/or folder. */
export async function searchLibrary(clientId: string, opts: { q?: string; folder?: string; limit?: number; driveFallback?: boolean } = {}) {
  let query = db()
    .from("assets")
    .select("id, drive_file_id, folder_path, name, width, height, thumbnail_path, ai_description")
    .eq("client_id", clientId)
    .eq("kind", "image")
    .is("removed_at", null);
  if (opts.folder !== undefined && opts.folder !== null && opts.folder !== "*") query = query.eq("folder_path", opts.folder);
  for (const word of (opts.q ?? "").trim().toLowerCase().split(/\s+/).filter(Boolean).slice(0, 5)) {
    query = query.ilike("search_text", `%${word.replace(/[%_]/g, "")}%`);
  }
  const assets = must(await query.order("drive_modified_at", { ascending: false }).limit(opts.limit ?? 60), "search the library") as LibraryRow[];
  const thumbs = await signedThumbs(assets.map((a) => a.thumbnail_path));
  return assets.map((a) => ({
    id: a.id,
    driveFileId: a.drive_file_id,
    name: a.name,
    folder: a.folder_path,
    width: a.width,
    height: a.height,
    description: a.ai_description,
    thumb: previewFor(a.id, a.thumbnail_path, thumbs, opts.driveFallback ?? true),
  }));
}

/** Folders that hold at least one image, with counts. */
export async function libraryFolders(clientId: string) {
  const rows = must(
    await db().from("assets").select("folder_path").eq("client_id", clientId).eq("kind", "image").is("removed_at", null).limit(5000),
    "load folders",
  ) as { folder_path: string }[];
  const counts = new Map<string, number>();
  for (const r of rows) counts.set(r.folder_path, (counts.get(r.folder_path) ?? 0) + 1);
  return [...counts.entries()].map(([path, count]) => ({ path, count })).sort((a, b) => a.path.localeCompare(b.path));
}

// ---------------------------------------------------------------------------
// Photos attached to posts (asset_matches, the same rows the review board and
// the Buffer push use)
// ---------------------------------------------------------------------------

export type PostPhoto = {
  matchId: string;
  assetId: string | null; // null = "no suitable photo" was chosen
  driveFileId: string | null;
  name: string;
  kind: string;
  thumb: string | null;
  state: "suggested" | "approved" | "swapped" | "rejected";
  confidence: number | null;
  reason: string | null;
  position: number;
};

type MatchRow = {
  id: string;
  content_item_id: string;
  asset_id: string | null;
  position: number;
  state: PostPhoto["state"];
  confidence: number | null;
  reason: string | null;
  assets: { drive_file_id: string; name: string; kind: string; thumbnail_path: string | null } | null;
};

/** itemId → its current photos, in carousel order (rejected ones left out). */
export async function postPhotos(itemIds: string[], driveFallback = true): Promise<Record<string, PostPhoto[]>> {
  if (!itemIds.length) return {};
  const rows = must(
    await db()
      .from("asset_matches")
      .select("id, content_item_id, asset_id, position, state, confidence, reason, assets!asset_matches_asset_id_fkey(drive_file_id, name, kind, thumbnail_path)")
      .in("content_item_id", itemIds)
      .neq("state", "rejected")
      .order("position"),
    "load attached photos",
  ) as unknown as MatchRow[];
  const thumbs = await signedThumbs(rows.map((r) => r.assets?.thumbnail_path ?? null));
  const out: Record<string, PostPhoto[]> = {};
  for (const r of rows) {
    (out[r.content_item_id] ??= []).push({
      matchId: r.id,
      assetId: r.asset_id,
      driveFileId: r.assets?.drive_file_id ?? null,
      name: r.assets?.name ?? "",
      kind: r.assets?.kind ?? "image",
      thumb: r.asset_id ? previewFor(r.asset_id, r.assets?.thumbnail_path ?? null, thumbs, driveFallback) : null,
      state: r.state,
      confidence: r.confidence === null ? null : Number(r.confidence),
      reason: r.reason,
      position: r.position,
    });
  }
  return out;
}

/** Library size and how much of it Claude has tagged (matching needs tags). */
export async function libraryStats(clientId: string) {
  const [all, tagged] = await Promise.all([
    db().from("assets").select("id", { count: "exact", head: true }).eq("client_id", clientId).is("removed_at", null),
    db().from("assets").select("id", { count: "exact", head: true }).eq("client_id", clientId).is("removed_at", null).not("ai_description", "is", null),
  ]);
  return { total: all.count ?? 0, tagged: tagged.count ?? 0 };
}

// ---------------------------------------------------------------------------
// Picks
// ---------------------------------------------------------------------------

async function checkPost(clientId: string, contentItemId: string | null) {
  if (!contentItemId) return;
  const res = await db().from("content_items").select("id").eq("id", contentItemId).eq("client_id", clientId).maybeSingle();
  if (!res.data) throw new Error("That post isn't in this client's calendar.");
}

/** Stores a camera-roll photo (re-encoded, location data stripped) as a pick. */
export async function pickUpload(client: Client, contentItemId: string | null, file: Blob, label: string, by: string, note = "") {
  await checkPost(client.id, contentItemId);
  const data = await pipeline(Buffer.from(await file.arrayBuffer()))
    .resize(2400, 2400, { fit: "inside", withoutEnlargement: true })
    .flatten({ background: "#ffffff" })
    .jpeg({ quality: 88, mozjpeg: true })
    .toBuffer();
  const path = `${client.slug}/${todayIn(client.timezone).slice(0, 7)}/${randomUUID()}.jpg`;
  const up = await db().storage.from(config.storage.picksBucket).upload(path, data, { contentType: "image/jpeg" });
  if (up.error) throw new Error(`Couldn't store the photo: ${up.error.message}`);
  must(
    await db()
      .from("photo_picks")
      .insert({ client_id: client.id, content_item_id: contentItemId, storage_path: path, label: label.slice(0, 120) || "Phone photo", note, created_by: by })
      .select("id"),
    "save the pick",
  );
}

type PickRow = {
  id: string;
  content_item_id: string | null;
  storage_path: string | null;
  label: string;
  note: string;
  created_at: string;
  assets: { drive_file_id: string; thumbnail_path: string | null } | null;
};

/** Picks not yet pulled into the extension, newest first. */
export async function openPicks(clientId: string) {
  const rows = must(
    await db()
      .from("photo_picks")
      .select("id, content_item_id, storage_path, label, note, created_at, assets(drive_file_id, thumbnail_path)")
      .eq("client_id", clientId)
      .is("used_at", null)
      .order("created_at", { ascending: false })
      .limit(200),
    "load picked photos",
  ) as unknown as PickRow[];
  const thumbs = await signedThumbs(rows.map((r) => r.assets?.thumbnail_path ?? null));
  const uploads = rows.filter((r) => r.storage_path).map((r) => r.storage_path!);
  const uploadUrls: Record<string, string> = {};
  if (uploads.length) {
    const signed = await db().storage.from(config.storage.picksBucket).createSignedUrls(uploads, 60 * 60);
    for (const s of signed.data ?? []) if (s.path && s.signedUrl) uploadUrls[s.path] = s.signedUrl;
  }
  return rows.map((r) => ({
    id: r.id,
    postId: r.content_item_id,
    label: r.label,
    note: r.note,
    createdAt: r.created_at,
    kind: r.storage_path ? ("upload" as const) : ("drive" as const),
    driveFileId: r.assets?.drive_file_id ?? null,
    thumb: r.storage_path ? uploadUrls[r.storage_path] ?? null : r.assets?.thumbnail_path ? thumbs[r.assets.thumbnail_path] ?? null : null,
  }));
}

export async function pickImage(clientId: string, pickId: string): Promise<Buffer> {
  const row = must(
    await db().from("photo_picks").select("storage_path").eq("id", pickId).eq("client_id", clientId).single(),
    "find that photo",
  ) as { storage_path: string | null };
  if (!row.storage_path) throw new Error("That pick is a Drive photo; load it through Drive instead.");
  const file = await db().storage.from(config.storage.picksBucket).download(row.storage_path);
  if (file.error || !file.data) throw new Error(`Couldn't load the photo: ${file.error?.message ?? "missing"}`);
  return Buffer.from(await file.data.arrayBuffer());
}

export async function markPicksUsed(clientId: string, ids: string[]) {
  if (!ids.length) return;
  must(
    await db().from("photo_picks").update({ used_at: new Date().toISOString() }).eq("client_id", clientId).in("id", ids).select("id"),
    "mark photos as used",
  );
}

export async function removePick(clientId: string, id: string) {
  const row = (await db().from("photo_picks").select("storage_path").eq("id", id).eq("client_id", clientId).maybeSingle()).data as
    | { storage_path: string | null }
    | null;
  if (!row) return;
  if (row.storage_path) await db().storage.from(config.storage.picksBucket).remove([row.storage_path]);
  must(await db().from("photo_picks").delete().eq("id", id).eq("client_id", clientId).select("id"), "remove the photo");
}

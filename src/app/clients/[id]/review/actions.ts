"use server";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { db, must } from "@/lib/db";
import { renderAndStore, renderFormatFor, type Crop } from "@/lib/render";
import { signedThumbs } from "@/lib/thumbs";
import type { Asset, Format } from "@/lib/types";
import { errorMessage } from "@/lib/log";

const now = () => new Date().toISOString();

async function assertItem(clientId: string, itemId: string) {
  const item = await db().from("content_items").select("id").eq("id", itemId).eq("client_id", clientId).maybeSingle();
  if (!item.data) throw new Error("That post doesn't belong to this client.");
}

export async function approveItem(clientId: string, itemId: string) {
  await requireUser();
  await assertItem(clientId, itemId);
  must(
    await db().from("asset_matches").update({ state: "approved", decided_at: now() }).eq("content_item_id", itemId).eq("state", "suggested").select("id"),
    "approve",
  );
  revalidatePath(`/clients/${clientId}/review`);
}

export async function unapproveItem(clientId: string, itemId: string) {
  await requireUser();
  await assertItem(clientId, itemId);
  must(
    await db().from("asset_matches").update({ state: "suggested", decided_at: null }).eq("content_item_id", itemId).in("state", ["approved"]).select("id"),
    "undo approval",
  );
  revalidatePath(`/clients/${clientId}/review`);
}

export async function approveAbove(clientId: string, calendarId: string, formData: FormData) {
  await requireUser();
  const pct = Number(formData.get("threshold") ?? 80);
  const threshold = Math.max(0, Math.min(100, pct)) / 100;
  const rows = must(
    await db()
      .from("asset_matches")
      .select("id, content_item_id, confidence, content_items!inner(calendar_id, client_id)")
      .eq("content_items.calendar_id", calendarId)
      .eq("content_items.client_id", clientId)
      .eq("state", "suggested")
      .not("asset_id", "is", null),
    "load suggestions",
  ) as unknown as { id: string; content_item_id: string; confidence: number | null }[];
  // A carousel is approved only if every image clears the bar.
  const byItem = new Map<string, { ids: string[]; min: number }>();
  for (const r of rows) {
    const e = byItem.get(r.content_item_id) ?? { ids: [], min: 1 };
    e.ids.push(r.id);
    e.min = Math.min(e.min, Number(r.confidence ?? 0));
    byItem.set(r.content_item_id, e);
  }
  const ids = [...byItem.values()].filter((e) => e.min >= threshold).flatMap((e) => e.ids);
  if (ids.length) must(await db().from("asset_matches").update({ state: "approved", decided_at: now() }).in("id", ids).select("id"), "approve");
  revalidatePath(`/clients/${clientId}/review`);
}

/** Replace an item's images with the ones I picked. Old picks are remembered to improve future matching. */
export async function swapAssets(clientId: string, itemId: string, assetIds: string[]) {
  await requireUser();
  await assertItem(clientId, itemId);
  const owned = must(await db().from("assets").select("id").eq("client_id", clientId).in("id", assetIds), "check images") as { id: string }[];
  if (owned.length !== new Set(assetIds).size) throw new Error("One of those images isn't in this client's library.");

  const old = must(
    await db().from("asset_matches").select("id, asset_id, position, state, replaced_asset_id").eq("content_item_id", itemId).order("position"),
    "load current images",
  ) as { asset_id: string | null; position: number; state: string; replaced_asset_id: string | null }[];
  // Remember what the AI originally suggested (not a previous manual pick).
  const aiPick = (pos: number) => {
    const o = old.find((m) => m.position === pos) ?? old[0];
    if (!o) return null;
    return o.state === "swapped" ? o.replaced_asset_id : o.asset_id;
  };
  must(await db().from("asset_matches").delete().eq("content_item_id", itemId).select("id"), "clear old images");
  if (assetIds.length) {
    must(
      await db().from("asset_matches").insert(
        assetIds.map((assetId, position) => ({
          content_item_id: itemId,
          asset_id: assetId,
          position,
          confidence: null,
          reason: "Chosen by you",
          method: "manual",
          state: "swapped",
          replaced_asset_id: aiPick(position) === assetId ? null : aiPick(position),
          decided_at: now(),
        })),
      ).select("id"),
      "save your choice",
    );
  } else {
    must(
      await db().from("asset_matches").insert({
        content_item_id: itemId, asset_id: null, method: "manual", state: "approved",
        reason: "No suitable asset (set by you)", decided_at: now(),
      }).select("id"),
      "save",
    );
  }
  revalidatePath(`/clients/${clientId}/review`);
}

export type PickerAsset = Pick<Asset, "id" | "name" | "folder_path" | "kind" | "width" | "height" | "ai_description"> & { thumb: string | null };

export async function searchLibrary(clientId: string, q: string, folder: string, page: number): Promise<{ assets: PickerAsset[]; hasMore: boolean }> {
  await requireUser();
  const size = 48;
  let query = db()
    .from("assets")
    .select("id, name, folder_path, kind, width, height, ai_description, thumbnail_path")
    .eq("client_id", clientId)
    .is("removed_at", null)
    .order("folder_path")
    .order("name")
    .range(page * size, page * size + size);
  if (folder) query = query.eq("folder_path", folder);
  for (const w of q.toLowerCase().split(/\s+/).filter(Boolean)) query = query.ilike("search_text", `%${w}%`);
  const rows = must(await query, "search the library") as (PickerAsset & { thumbnail_path: string | null })[];
  const thumbs = await signedThumbs(rows.map((r) => r.thumbnail_path));
  return {
    assets: rows.slice(0, size).map(({ thumbnail_path, ...r }) => ({ ...r, thumb: thumbnail_path ? thumbs[thumbnail_path] ?? null : null })),
    hasMore: rows.length > size,
  };
}

/** Save a manual crop and re-render that image straight away. */
export async function saveCrop(clientId: string, matchId: string, crop: Crop | null): Promise<{ ok: boolean; message: string; url?: string }> {
  await requireUser();
  try {
    const m = must(
      await db()
        .from("asset_matches")
        .select("id, position, content_items!inner(id, client_id, post_date, format), assets!asset_matches_asset_id_fkey(id, drive_file_id, name, mime_type, kind, size_bytes, duration_ms)")
        .eq("id", matchId)
        .eq("content_items.client_id", clientId)
        .single(),
      "load the image",
    ) as unknown as {
      position: number;
      content_items: { id: string; post_date: string | null; format: Format | null };
      assets: { id: string; drive_file_id: string; name: string; mime_type: string; kind: string; size_bytes: number | null; duration_ms: number | null };
    };
    must(await db().from("asset_matches").update({ crop }).eq("id", matchId).select("id"), "save the crop");
    const client = must(await db().from("clients").select("slug").eq("id", clientId).single(), "load client") as { slug: string };
    const out = await renderAndStore({
      clientId,
      clientSlug: client.slug,
      item: m.content_items,
      asset: m.assets,
      format: renderFormatFor(m.content_items.format),
      position: m.position,
      crop,
      itemFormat: m.content_items.format,
    });
    revalidatePath(`/clients/${clientId}/review`);
    return { ok: true, message: out.warnings.join(" ") || "Crop saved.", url: out.url };
  } catch (err) {
    return { ok: false, message: errorMessage(err) };
  }
}

/** A larger preview (signed Drive-free URL) for the crop tool: the thumbnail at 480px is enough for positioning. */
export async function cropSource(clientId: string, assetId: string) {
  await requireUser();
  const a = must(await db().from("assets").select("thumbnail_path, width, height").eq("id", assetId).eq("client_id", clientId).single(), "load image") as {
    thumbnail_path: string | null; width: number | null; height: number | null;
  };
  const thumbs = await signedThumbs([a.thumbnail_path]);
  return { url: a.thumbnail_path ? thumbs[a.thumbnail_path] : null, width: a.width, height: a.height };
}

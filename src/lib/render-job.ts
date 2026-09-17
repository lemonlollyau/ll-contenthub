import "server-only";
import { config } from "./config";
import { db, must } from "./db";
import type { Job, StepResult } from "./jobs";
import { errorMessage } from "./log";
import { renderAndStore, renderFormatFor, type Crop } from "./render";
import type { Format } from "./types";

// Prepares every approved image for a calendar. Skips anything already
// rendered with the same asset, format and crop.

type RenderState = { queue: string[]; rendered: number; failed: number; errors: string[] };

type ApprovedMatch = {
  id: string;
  asset_id: string;
  position: number;
  crop: Crop | null;
  content_item_id: string;
  content_items: { id: string; post_date: string | null; format: Format | null; row_number: number | null; client_id: string };
  assets: { id: string; drive_file_id: string; name: string; mime_type: string; kind: string; size_bytes: number | null; duration_ms: number | null };
};

const SELECT =
  "id, asset_id, position, crop, content_item_id, content_items!inner(id, post_date, format, row_number, client_id, calendar_id), assets!asset_matches_asset_id_fkey(id, drive_file_id, name, mime_type, kind, size_bytes, duration_ms)";

export async function initialRenderState(calendarId: string, itemIds?: string[]): Promise<RenderState> {
  let q = db()
    .from("asset_matches")
    .select(SELECT)
    .eq("content_items.calendar_id", calendarId)
    .in("state", ["approved", "swapped"])
    .not("asset_id", "is", null);
  if (itemIds?.length) q = q.in("content_item_id", itemIds);
  const matches = must(await q, "load approved images") as unknown as ApprovedMatch[];

  const rendered = must(
    await db()
      .from("rendered_assets")
      .select("content_item_id, asset_id, format, crop")
      .in("content_item_id", [...new Set(matches.map((m) => m.content_item_id))]),
    "load prepared images",
  ) as { content_item_id: string; asset_id: string; format: string; crop: Crop | null }[];
  const done = new Set(rendered.map((r) => `${r.content_item_id}|${r.asset_id}|${r.format}|${JSON.stringify(r.crop ?? null)}`));

  const queue = matches
    .filter((m) => {
      const key = `${m.content_item_id}|${m.asset_id}|${renderFormatFor(m.content_items.format)}|${JSON.stringify(m.crop ?? null)}`;
      return itemIds?.length ? true : !done.has(key);
    })
    .map((m) => m.id);
  return { queue, rendered: 0, failed: 0, errors: [] };
}

export async function renderStep(job: Job): Promise<StepResult<RenderState>> {
  const state = job.state as unknown as RenderState;
  const total = state.rendered + state.failed + state.queue.length;
  if (!state.queue.length) {
    return {
      state, total, done: total, finished: true,
      message: `Prepared ${state.rendered} files.` + (state.failed ? ` ${state.failed} failed: ${state.errors.slice(0, 3).join(" · ")}` : ""),
    };
  }
  const ids = state.queue.slice(0, config.batch.renderItemsPerCall);
  const [matchesRes, clientRes] = await Promise.all([
    db().from("asset_matches").select(SELECT).in("id", ids),
    db().from("clients").select("slug").eq("id", job.client_id!).single(),
  ]);
  const matches = must(matchesRes, "load images") as unknown as ApprovedMatch[];
  const client = must(clientRes, "load client") as { slug: string };

  await Promise.all(
    matches.map(async (m) => {
      try {
        await renderAndStore({
          clientId: job.client_id!,
          clientSlug: client.slug,
          item: m.content_items,
          asset: m.assets,
          format: renderFormatFor(m.content_items.format),
          position: m.position,
          crop: m.crop,
          itemFormat: m.content_items.format,
        });
        state.rendered += 1;
      } catch (err) {
        state.failed += 1;
        state.errors.push(`#${m.content_items.row_number ?? "?"} ${m.assets.name}: ${errorMessage(err)}`);
      }
    }),
  );
  state.queue = state.queue.slice(ids.length);
  const done = state.rendered + state.failed;
  return { state, total, done, finished: false, message: `Preparing images… ${done} of ${total}` };
}

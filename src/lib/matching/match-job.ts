import "server-only";
import { z } from "zod";
import { config } from "../config";
import { claudeJson, friendlyClaudeError } from "../claude";
import { getBrandProfile } from "../clients";
import { db, must } from "../db";
import { parseDriveId } from "../google-drive";
import type { Job, StepResult } from "../jobs";
import type { Asset, Client, ContentItem } from "../types";
import { carouselCount, keywords, normFolder, orientationFit, overlapScore, recentlyUsed } from "./rules";

// Matches imagery to content items in three passes:
//   1. explicit reference (file name / Drive link / file id)
//   2. Asset group ↔ Drive subfolder
//   3. AI ranking over a keyword-prefiltered shortlist
// Each result has a confidence and a one-line reason, or "No suitable asset".

type MatchState = { queue: string[]; usage: Record<string, string[]>; matched: number; none: number; failed: number };
type LibAsset = Asset & { search_text: string };

const CANDIDATES = 40;

export async function initialMatchState(clientId: string, calendarId: string, rematchAll: boolean): Promise<MatchState> {
  const items = must(
    await db()
      .from("content_items")
      .select("id, format, channels, type, post_date, row_number")
      .eq("calendar_id", calendarId)
      .eq("type", "social")
      .order("post_date")
      .order("row_number"),
    "load items to match",
  ) as Pick<ContentItem, "id" | "format" | "channels">[];

  // Items with a decided match are left alone unless re-matching everything.
  const decided = new Set(
    (must(
      await db().from("asset_matches").select("content_item_id").in("content_item_id", items.map((i) => i.id)).in("state", ["approved", "swapped"]),
      "load decisions",
    ) as { content_item_id: string }[]).map((r) => r.content_item_id),
  );
  const queue = items
    .filter((i) => !(i.format === "text" && !i.channels.includes("instagram")))
    .filter((i) => rematchAll || !decided.has(i.id))
    .map((i) => i.id);

  return { queue, usage: await usageMap(clientId, queue), matched: 0, none: 0, failed: 0 };
}

/** assetId → dates it's used on, from matches on items not being re-matched now. */
async function usageMap(clientId: string, excludeItemIds: string[]): Promise<Record<string, string[]>> {
  const rows = must(
    await db()
      .from("asset_matches")
      .select("asset_id, content_item_id, state, content_items!inner(client_id, post_date)")
      .eq("content_items.client_id", clientId)
      .not("asset_id", "is", null)
      .neq("state", "rejected"),
    "load image usage",
  ) as unknown as { asset_id: string; content_item_id: string; content_items: { post_date: string | null } }[];
  const exclude = new Set(excludeItemIds);
  const usage: Record<string, string[]> = {};
  for (const r of rows) {
    if (exclude.has(r.content_item_id) || !r.content_items.post_date) continue;
    (usage[r.asset_id] ??= []).push(r.content_items.post_date);
  }
  return usage;
}

async function loadLibrary(clientId: string): Promise<LibAsset[]> {
  const out: LibAsset[] = [];
  for (let from = 0; ; from += 1000) {
    const page = must(
      await db()
        .from("assets")
        .select("id, client_id, drive_file_id, folder_path, name, mime_type, kind, width, height, duration_ms, size_bytes, thumbnail_path, ai_description, ai_tags, removed_at, search_text")
        .eq("client_id", clientId)
        .is("removed_at", null)
        .range(from, from + 999),
      "load the image library",
    ) as LibAsset[];
    out.push(...page);
    if (page.length < 1000) return out;
  }
}

async function swapExamples(clientId: string): Promise<string> {
  const rows = must(
    await db()
      .from("asset_matches")
      .select("reason, content_items!inner(client_id, hook, asset_brief, format), chosen:assets!asset_matches_asset_id_fkey(name, ai_description), replaced:assets!asset_matches_replaced_asset_id_fkey(name, ai_description)")
      .eq("content_items.client_id", clientId)
      .eq("state", "swapped")
      .not("replaced_asset_id", "is", null)
      .order("decided_at", { ascending: false })
      .limit(12),
    "load past swaps",
  ) as unknown as {
    content_items: { hook: string | null; asset_brief: string | null; format: string | null };
    chosen: { name: string; ai_description: string | null } | null;
    replaced: { name: string; ai_description: string | null } | null;
  }[];
  if (!rows.length) return "";
  return rows
    .filter((r) => r.chosen && r.replaced)
    .map(
      (r) =>
        `- Post "${r.content_items.hook ?? ""}" (brief: ${r.content_items.asset_brief ?? "none"}, ${r.content_items.format ?? "feed"}): ` +
        `the manager REJECTED "${r.replaced!.ai_description ?? r.replaced!.name}" and CHOSE "${r.chosen!.ai_description ?? r.chosen!.name}".`,
    )
    .join("\n");
}

const PickSchema = z.object({
  no_suitable_asset: z.boolean().describe("True if none of the candidates genuinely fit this post."),
  reason: z.string().describe("One short line explaining the choice (or why nothing fits)."),
  picks: z
    .array(
      z.object({
        candidate: z.string().describe("Candidate key, e.g. C7"),
        confidence: z.number().describe("0 to 1: how well this fits the post"),
      }),
    )
    .describe("Best candidates in order. One for a single-image post; an ordered set for a carousel."),
});

type Proposed = { assetIds: string[]; confidence: number | null; reason: string; method: "explicit" | "folder" | "ai" };

function explicitMatch(item: ContentItem, lib: LibAsset[]): Proposed | null {
  if (!item.asset_ref) return null;
  const refs = item.asset_ref.split(/[\n,;]+/).map((s) => s.trim()).filter(Boolean);
  const ids: string[] = [];
  for (const ref of refs) {
    const id = parseDriveId(ref);
    const byId = lib.find((a) => a.drive_file_id === id);
    const lower = ref.toLowerCase();
    const byName = lib.find((a) => a.name.toLowerCase() === lower) ?? lib.find((a) => a.name.toLowerCase().startsWith(lower.replace(/\.[a-z0-9]+$/, "")));
    const hit = byId ?? byName;
    if (hit && !ids.includes(hit.id)) ids.push(hit.id);
  }
  return ids.length ? { assetIds: ids, confidence: 1, reason: `Named in the calendar (${refs.join(", ")})`, method: "explicit" } : null;
}

function itemBrief(item: ContentItem): string {
  return [
    `Date: ${item.post_date ?? "?"} · Platforms: ${item.channels.join(", ") || "?"} · Format: ${item.format ?? "feed"}`,
    item.pillar && `Pillar: ${item.pillar}`,
    item.moment_offer && `Moment / offer: ${item.moment_offer}`,
    item.hook && `Hook: ${item.hook}`,
    item.asset_brief && `Asset brief: ${item.asset_brief}`,
    item.caption && `Caption: ${item.caption.slice(0, 1200)}`,
  ]
    .filter(Boolean)
    .join("\n");
}

async function aiMatch(
  item: ContentItem,
  pool: LibAsset[],
  ctx: { client: Client; brandNotes: string; examples: string; state: MatchState; folderNote?: string },
): Promise<Proposed> {
  const wantsVideo = item.format === "reel" || item.format === "story";
  const words = keywords([item.hook, item.asset_brief, item.moment_offer, item.pillar, item.caption?.slice(0, 400)].filter(Boolean).join(" "));
  const usable = pool.filter(
    (a) => a.ai_description && !recentlyUsed(ctx.state.usage, a.id, item.post_date, ctx.client.reuse_window_days),
  );
  if (!usable.length) {
    return { assetIds: [], confidence: null, reason: pool.length ? "Every candidate was used in the last few days" : "The library has no tagged images yet", method: "ai" };
  }
  const ranked = usable
    .map((a) => ({
      a,
      score: overlapScore(words, a.search_text) + orientationFit(item.format, a) + (wantsVideo && a.kind === "video" ? 0.8 : 0) - (!wantsVideo && a.kind === "video" ? 1 : 0),
    }))
    .sort((x, y) => y.score - x.score)
    .slice(0, CANDIDATES);

  const keyed = ranked.map((r, i) => ({ key: `C${i + 1}`, a: r.a }));
  const list = keyed
    .map(({ key, a }) => {
      const t = a.ai_tags ?? {};
      return `${key}: [${a.kind}, ${String(t.orientation ?? "?")}${a.duration_ms ? `, ${Math.round(a.duration_ms / 1000)}s` : ""}] folder "${a.folder_path || "/"}" file "${a.name}". ${a.ai_description}` +
        ` Tags: ${[...((t.products as string[]) ?? []), String(t.shot_type ?? ""), String(t.setting ?? ""), ...((t.keywords as string[]) ?? [])].filter(Boolean).join(", ")}` +
        `${t.has_text ? ` (has text: "${String(t.text_content ?? "").slice(0, 60)}")` : ""}`;
    })
    .join("\n");

  const count = item.format === "carousel" ? carouselCount(item.asset_brief) : 1;
  const instructions = [
    item.format === "carousel"
      ? `This is a carousel: return an ordered set of ${count ?? "3–6"} images that tell the story in order (cover first).`
      : "Return the single best image.",
    wantsVideo ? "This is a reel/story: prefer a video if a good one exists; otherwise a portrait image." : "Prefer images over videos.",
    item.format === "feed" || item.format === "carousel" ? "Feed posts crop to 4:5 portrait; portrait or square images crop best." : "",
    item.format === "story" || item.format === "reel" ? "Stories/reels crop to 9:16; landscape images crop badly." : "",
    "Avoid images with baked-in text unless the brief asks for it, and anything with quality problems.",
    "If nothing genuinely fits the brief, set no_suitable_asset to true. A wrong image is worse than none.",
    "Confidence: 0.9+ clearly right, 0.7 good, 0.5 plausible, below 0.4 weak.",
  ].filter(Boolean).join("\n");

  const result = await claudeJson({
    schema: PickSchema,
    operation: "match.item",
    clientId: ctx.client.id,
    effort: "low",
    maxTokens: 4000,
    system:
      `You pick imagery from ${ctx.client.name}'s Google Drive library for their social media posts. ` +
      `You only see text descriptions of each image.\n\nBrand notes:\n${ctx.brandNotes || "(none)"}` +
      (ctx.examples ? `\n\nThis manager's past corrections (learn their taste from these):\n${ctx.examples}` : ""),
    content: [
      {
        type: "text",
        text: `POST\n${itemBrief(item)}\n\n${ctx.folderNote ?? ""}INSTRUCTIONS\n${instructions}\n\nCANDIDATES\n${list}`,
      },
    ],
  });

  const byKey = new Map(keyed.map((k) => [k.key, k.a]));
  const picks = result.picks.filter((p) => byKey.has(p.candidate));
  if (result.no_suitable_asset || !picks.length) {
    return { assetIds: [], confidence: null, reason: result.reason, method: "ai" };
  }
  const chosen = item.format === "carousel" ? picks : picks.slice(0, 1);
  const conf = Math.min(...chosen.map((p) => Math.max(0, Math.min(1, p.confidence))));
  return { assetIds: [...new Set(chosen.map((p) => byKey.get(p.candidate)!.id))], confidence: conf, reason: result.reason, method: "ai" };
}

export async function matchStep(job: Job): Promise<StepResult<MatchState>> {
  const state = job.state as unknown as MatchState;
  const clientId = job.client_id!;
  const total = state.matched + state.none + state.failed + state.queue.length;
  if (!state.queue.length) {
    return {
      state,
      total,
      done: total,
      finished: true,
      message: `Matched ${state.matched} posts. ${state.none} had no suitable image.${state.failed ? ` ${state.failed} failed (see Activity log).` : ""}`,
    };
  }

  const batchIds = state.queue.slice(0, config.batch.matchItemsPerCall);
  const [clientRow, brand, lib, examples, itemsRes] = await Promise.all([
    db().from("clients").select("*").eq("id", clientId).single(),
    getBrandProfile(clientId),
    loadLibrary(clientId),
    swapExamples(clientId),
    db().from("content_items").select("*").in("id", batchIds),
  ]);
  const client = must(clientRow, "load the client") as Client;
  const items = (must(itemsRes, "load items") as ContentItem[]).sort((a, b) => batchIds.indexOf(a.id) - batchIds.indexOf(b.id));
  const brandNotes = [brand.voice_notes, brand.compliance_notes && `Compliance: ${brand.compliance_notes}`].filter(Boolean).join("\n");

  // Sequential within the batch so the reuse rule sees earlier picks.
  for (const item of items) {
    try {
      let proposed = explicitMatch(item, lib);
      if (!proposed && item.asset_group) {
        const g = normFolder(item.asset_group);
        const inFolder = lib.filter((a) => {
          const path = normFolder(a.folder_path);
          const last = normFolder(a.folder_path.split("/").pop() ?? "");
          return last === g || path === g || path.endsWith(` ${g}`);
        });
        if (inFolder.length) {
          const ai = await aiMatch(item, inFolder, {
            client, brandNotes, examples, state,
            folderNote: `All candidates are from the "${item.asset_group}" folder named in the calendar.\n\n`,
          });
          proposed = ai.assetIds.length
            ? { ...ai, method: "folder", confidence: Math.max(ai.confidence ?? 0, 0.6), reason: `From folder "${item.asset_group}": ${ai.reason}` }
            : null;
        }
      }
      proposed ??= await aiMatch(item, lib, { client, brandNotes, examples, state });

      // Replace this item's undecided suggestions.
      must(
        await db().from("asset_matches").delete().eq("content_item_id", item.id).in("state", ["suggested", "rejected"]).select("id"),
        "clear old suggestions",
      );
      if (proposed.assetIds.length) {
        must(
          await db().from("asset_matches").insert(
            proposed.assetIds.map((assetId, position) => ({
              content_item_id: item.id,
              asset_id: assetId,
              position,
              confidence: proposed!.confidence,
              reason: proposed!.reason,
              method: proposed!.method,
            })),
          ).select("id"),
          "save the match",
        );
        for (const id of proposed.assetIds) if (item.post_date) (state.usage[id] ??= []).push(item.post_date);
        state.matched += 1;
      } else {
        must(
          await db().from("asset_matches").insert({
            content_item_id: item.id,
            asset_id: null,
            confidence: null,
            reason: `No suitable asset: ${proposed.reason}`,
            method: proposed.method,
          }).select("id"),
          "save the result",
        );
        state.none += 1;
      }
    } catch (err) {
      state.failed += 1;
      await db().from("api_calls").insert({
        client_id: clientId, service: "app", operation: "match.item", ok: false,
        error: `Post #${item.row_number ?? "?"}: ${friendlyClaudeError(err)}`,
      });
    }
  }

  state.queue = state.queue.slice(batchIds.length);
  const done = state.matched + state.none + state.failed;
  return { state, total, done, finished: false, message: `Matching imagery… ${done} of ${total} posts` };
}

/** Match job for specific posts (the phone page's "Auto-match" for upcoming posts without photos). */
export async function initialMatchStateForItems(clientId: string, itemIds: string[]): Promise<MatchState> {
  return { queue: itemIds, usage: await usageMap(clientId, itemIds), matched: 0, none: 0, failed: 0 };
}

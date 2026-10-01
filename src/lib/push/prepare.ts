import "server-only";
import { assembleText } from "../caption";
import { db, must } from "../db";
import { itemFlags } from "../flags";
import { suggestTime } from "../posting-times";
import { zonedToUtc } from "../tz";
import { csMediaPlan } from "../contentstudio";
import { providerInfo } from "./provider";
import type { ChannelMapping, Client, ContentItem } from "../types";

// Builds the list of posts for a calendar (one per item × channel), with every
// check that must pass before anything is sent to Buffer or ContentStudio.

export type PlannedPost = {
  key: string; // itemId:platform
  itemId: string;
  rowNumber: number | null;
  platform: string;
  channel: ChannelMapping | null;
  format: string | null;
  date: string | null;
  time: string | null;
  timeRule: string | null;
  dueAt: string | null;
  text: string;
  media: { url: string; kind: "image" | "video"; altText: string }[];
  firstComment: string | null;
  existingPostId: string | null;
  /** The calendar's compliance note: read before publishing, not a fault to fix. */
  compliance: string | null;
  errors: string[];
  warnings: string[];
  csvOnly: string | null; // why bulk CSV can't do this post fully
};

/** Plans a whole calendar, or specific posts by id (the Chrome extension sends one at a time). */
export async function planPosts(client: Client, scope: string | { itemIds: string[] }): Promise<PlannedPost[]> {
  let query = db().from("content_items").select("*").eq("client_id", client.id).eq("type", "social");
  query = typeof scope === "string" ? query.eq("calendar_id", scope) : query.in("id", scope.itemIds);
  const items = must(await query.order("post_date").order("row_number"), "load posts") as ContentItem[];
  const ids = items.map((i) => i.id);
  const [matchesRes, rendersRes] = await Promise.all([
    db().from("asset_matches").select("content_item_id, asset_id, position, state, assets!asset_matches_asset_id_fkey(kind, ai_description)").in("content_item_id", ids).in("state", ["approved", "swapped"]).order("position"),
    db().from("rendered_assets").select("content_item_id, asset_id, public_url").in("content_item_id", ids),
  ]);
  const matches = must(matchesRes, "load approved images") as unknown as {
    content_item_id: string; asset_id: string | null; position: number; assets: { kind: string; ai_description: string | null } | null;
  }[];
  const renders = new Map((must(rendersRes, "load prepared images") as { content_item_id: string; asset_id: string; public_url: string }[]).map((r) => [`${r.content_item_id}|${r.asset_id}`, r.public_url]));

  const provider = providerInfo(client);
  const plans: PlannedPost[] = [];
  for (const item of items) {
    const approved = matches.filter((m) => m.content_item_id === item.id && m.asset_id);
    const media: PlannedPost["media"] = [];
    const itemErrors: string[] = [];
    if (item.custom_media?.length) {
      // Designed in the Chrome extension: these replace any matched Drive images.
      media.push(...item.custom_media.map((m) => ({ url: m.url, kind: m.kind, altText: m.altText ?? "" })));
    } else {
      for (const m of approved) {
        const url = renders.get(`${item.id}|${m.asset_id}`);
        if (!url) itemErrors.push("An approved image hasn't been prepared yet. Click \"Prepare approved images\".");
        else media.push({ url, kind: m.assets?.kind === "video" ? "video" : "image", altText: m.assets?.ai_description ?? "" });
      }
    }
    const flags = itemFlags(item, { hasAsset: media.length > 0 || approved.length > 0 });
    const suggestion = item.post_time ? null : suggestTime(item, client.posting_rules);
    const time = item.post_time?.slice(0, 5) ?? suggestion?.time ?? null;
    const dueAt = item.post_date && time ? zonedToUtc(item.post_date, time, client.timezone).toISOString() : null;
    const text = assembleText(item);

    for (const platform of item.channels) {
      const channel = provider.channels.find((c) => c.platform === platform) ?? null;
      const errors = [...itemErrors, ...flags.filter((f) => f.level === "error").map((f) => f.text)];
      // Compliance notes get their own column, so they don't drown the real checks.
      const warnings = flags.filter((f) => f.level === "warn" && !f.text.startsWith("Compliance:")).map((f) => f.text);
      if (provider.missing) errors.push(provider.missing);
      if (!channel) errors.push(`No ${provider.label} channel mapped for ${platform}. Map it in Settings.`);
      if (dueAt && Date.parse(dueAt) < Date.now()) errors.push("Posting time is in the past.");
      if (!time) errors.push("No posting time.");
      if (platform === "instagram" && !media.length && !errors.some((e) => e.includes("no approved image"))) {
        errors.push("Instagram post has no image.");
      }
      if (media.length > 1 && item.format !== "carousel") warnings.push("Several images on a non-carousel post; only the first is used.");
      if (provider.id === "contentstudio") {
        // ContentStudio is strict about media per post type: say up front what it will do.
        const note = csMediaPlan(platform, item.format, item.format === "carousel" ? media : media.slice(0, 1)).note;
        if (note) warnings.push(note);
      }
      if (item.format === "carousel" && media.some((m) => m.kind === "video") && platform !== "instagram") warnings.push("Mixed video carousels may not be supported here.");
      const csvOnly =
        item.format === "carousel" ? "carousel" : item.format === "reel" ? "reel" : item.format === "story" ? "story"
        : media.some((m) => m.kind === "video") ? "video" : null;
      plans.push({
        key: `${item.id}:${platform}`,
        itemId: item.id,
        rowNumber: item.row_number,
        platform,
        channel,
        format: item.format,
        date: item.post_date,
        time,
        timeRule: suggestion?.rule ?? null,
        dueAt,
        text,
        media: item.format === "carousel" ? media : media.slice(0, 1),
        firstComment: item.first_comment,
        existingPostId: item.external_posts?.[platform] ?? null,
        compliance: item.compliance_note,
        errors,
        warnings,
        csvOnly,
      });
    }
  }

  // Two posts on the same channel at the same minute is almost always a mistake.
  const seen = new Map<string, PlannedPost>();
  for (const p of plans) {
    if (!p.dueAt) continue;
    const k = `${p.platform}|${p.dueAt}`;
    const other = seen.get(k);
    if (other) {
      p.errors.push(`Same time as post #${other.rowNumber} on ${p.platform}.`);
    } else seen.set(k, p);
  }
  return plans;
}

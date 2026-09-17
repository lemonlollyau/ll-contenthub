import { assembleText, findPlaceholders } from "./caption";
import type { ContentItem } from "./types";

export type Flag = { level: "error" | "warn"; text: string };

export const IG_CAPTION_LIMIT = 2200;

/** Problems to show loudly in the table and to block pushes on. */
export function itemFlags(item: ContentItem, opts: { hasAsset?: boolean } = {}): Flag[] {
  const flags: Flag[] = [];
  if (item.type !== "social") return flags;
  const text = assembleText(item);
  const placeholders = findPlaceholders([text, item.hook ?? ""].join("\n"));
  if (placeholders.length) flags.push({ level: "error", text: `Placeholder: ${placeholders.join(", ")}` });
  if (!text.trim()) flags.push({ level: "error", text: "No caption" });
  if (item.channels.includes("instagram") && text.length > IG_CAPTION_LIMIT) {
    flags.push({ level: "error", text: `${text.length} characters (Instagram max ${IG_CAPTION_LIMIT})` });
  }
  if (!item.post_date) flags.push({ level: "error", text: "No date" });
  if (!item.channels.length) flags.push({ level: "error", text: "No platform" });
  if (item.compliance_note) flags.push({ level: "warn", text: `Compliance: ${item.compliance_note}` });
  if (opts.hasAsset === false && item.channels.includes("instagram")) flags.push({ level: "error", text: "Instagram post has no approved image" });
  return flags;
}

export function isCaptionLocked(item: Pick<ContentItem, "caption_status">): boolean {
  return /approved|final|signed/i.test(item.caption_status ?? "");
}

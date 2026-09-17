import type { Asset, Format } from "../types";
import { orientationOf } from "../images";

// Pure helpers for matching: orientation fit, keyword overlap, reuse window.

export function orientationFit(format: Format | null, asset: Pick<Asset, "width" | "height" | "kind">): number {
  const o = orientationOf(asset.width, asset.height);
  switch (format) {
    case "story":
    case "reel":
      return o === "portrait" ? 1 : o === "square" ? 0.4 : o === "unknown" ? 0.5 : 0.1;
    case "feed":
    case "carousel":
      return o === "portrait" ? 1 : o === "square" ? 0.85 : o === "unknown" ? 0.6 : 0.45;
    default:
      return o === "unknown" ? 0.6 : 0.9;
  }
}

const STOP = new Set(
  "the a an and or of to in on for with your you our we is are it this that at by from be as can how why what get just more".split(" "),
);

export function keywords(text: string): string[] {
  return [...new Set(text.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").split(/\s+/).filter((w) => w.length > 2 && !STOP.has(w)))];
}

export function overlapScore(itemWords: string[], searchText: string): number {
  if (!itemWords.length) return 0;
  let hits = 0;
  for (const w of itemWords) if (searchText.includes(w)) hits += 1;
  return hits / Math.sqrt(itemWords.length);
}

export function daysBetween(a: string, b: string): number {
  return Math.abs(Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000;
}

/** True if the asset is already used within `windowDays` of `date` (by another item). */
export function recentlyUsed(usage: Record<string, string[]>, assetId: string, date: string | null, windowDays: number): boolean {
  if (!date || windowDays <= 0) return false;
  return (usage[assetId] ?? []).some((d) => daysBetween(d, date) < windowDays);
}

/** "5 slides", "carousel of 4" → 5 / 4. Default 3–5 is left to Claude. */
export function carouselCount(brief: string | null): number | null {
  const m = brief?.match(/(\d{1,2})\s*(?:-|to)?\s*(?:\d{1,2}\s*)?(?:slides?|images?|frames?|photos?|cards?)/i);
  const n = m ? Number(m[1]) : null;
  return n && n >= 2 && n <= 10 ? n : null;
}

export function normFolder(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

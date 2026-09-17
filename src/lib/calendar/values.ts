import type { Format } from "../types";

// Cell value parsing: dates, times, platforms, formats, asset references.

const pad = (n: number) => String(n).padStart(2, "0");

/** Excel serial date → {y,m,d,H,M} without timezone games. */
export function excelSerialParts(serial: number) {
  const ms = Math.round((serial - 25569) * 86400 * 1000); // 25569 = 1970-01-01
  const d = new Date(ms);
  return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate(), H: d.getUTCHours(), M: d.getUTCMinutes() };
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/**
 * Parses a date cell into YYYY-MM-DD. Numbers are Excel serials; text is read
 * Australian-style (day before month). `fallbackYear` fills in "Mon 3 Nov".
 */
export function parseDate(value: unknown, fallbackYear: number): string | null {
  if (value == null || value === "") return null;
  if (typeof value === "number" && value > 20000 && value < 80000) {
    const p = excelSerialParts(value);
    return `${p.y}-${pad(p.m)}-${pad(p.d)}`;
  }
  const s = String(value).trim().toLowerCase();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return `${m[1]}-${pad(+m[2])}-${pad(+m[3])}`;
  m = s.match(/(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{2,4}))?/);
  if (m) {
    const y = m[3] ? (m[3].length === 2 ? 2000 + +m[3] : +m[3]) : fallbackYear;
    return valid(y, +m[2], +m[1]);
  }
  m = s.match(/(\d{1,2})(?:st|nd|rd|th)?\s+([a-z]{3})[a-z]*\.?(?:\s+(\d{4}))?/);
  if (m && MONTHS.includes(m[2])) return valid(m[3] ? +m[3] : fallbackYear, MONTHS.indexOf(m[2]) + 1, +m[1]);
  m = s.match(/([a-z]{3})[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(\d{4}))?/);
  if (m && MONTHS.includes(m[1])) return valid(m[3] ? +m[3] : fallbackYear, MONTHS.indexOf(m[1]) + 1, +m[2]);
  return null;
}

function valid(y: number, mo: number, d: number): string | null {
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const date = new Date(Date.UTC(y, mo - 1, d));
  if (date.getUTCMonth() !== mo - 1) return null;
  return `${y}-${pad(mo)}-${pad(d)}`;
}

/** Parses "8:00am", "20:30", "8pm" or an Excel time fraction into HH:MM. */
export function parseTime(value: unknown): string | null {
  if (value == null || value === "") return null;
  if (typeof value === "number") {
    const frac = value % 1;
    if (frac === 0 && value >= 1) return null; // a date with no time
    const mins = Math.round(frac * 24 * 60);
    return `${pad(Math.floor(mins / 60) % 24)}:${pad(mins % 60)}`;
  }
  const s = String(value).trim().toLowerCase().replace(/\s+/g, "");
  const m = s.match(/^(\d{1,2})(?:[:.](\d{2}))?(am|pm)?$/);
  if (!m) return null;
  let h = +m[1];
  const min = m[2] ? +m[2] : 0;
  if (m[3] === "pm" && h < 12) h += 12;
  if (m[3] === "am" && h === 12) h = 0;
  if (!m[2] && !m[3]) return null; // a bare number isn't a time
  if (h > 23 || min > 59) return null;
  return `${pad(h)}:${pad(min)}`;
}

const PLATFORM_ALIASES: Record<string, string> = {
  ig: "instagram", insta: "instagram", instagram: "instagram",
  fb: "facebook", facebook: "facebook", meta: "facebook",
  li: "linkedin", linkedin: "linkedin",
  tt: "tiktok", tiktok: "tiktok", "tik tok": "tiktok",
  pin: "pinterest", pinterest: "pinterest",
  x: "twitter", twitter: "twitter",
  threads: "threads",
  yt: "youtube", youtube: "youtube",
  gbp: "googlebusiness", google: "googlebusiness", "google business": "googlebusiness", gmb: "googlebusiness",
  bluesky: "bluesky", mastodon: "mastodon",
};

export function parseChannels(value: unknown): string[] {
  if (value == null) return [];
  const parts = String(value)
    .toLowerCase()
    .split(/[/,+&|\n]| and /)
    .map((p) => p.replace(/[^a-z ]/g, "").trim())
    .filter(Boolean);
  const out = parts.map((p) => PLATFORM_ALIASES[p] ?? PLATFORM_ALIASES[p.split(" ")[0]] ?? p);
  return [...new Set(out)];
}

export function parseFormat(value: unknown): Format | null {
  const s = String(value ?? "").toLowerCase();
  if (!s.trim()) return null;
  if (/carou?sel|slides?|multi/.test(s)) return "carousel";
  if (/reel|video|tiktok/.test(s)) return "reel";
  if (/stor(y|ies)/.test(s)) return "story";
  if (/square|1:1/.test(s)) return "square";
  if (/text only|text post|^text$/.test(s)) return "text";
  return "feed";
}

/** Pulls a Drive file id/link or a file name out of free text. */
export function findAssetRef(text: string | null | undefined): string | null {
  if (!text) return null;
  const link = text.match(/https?:\/\/(?:drive|docs)\.google\.com\/\S+/);
  if (link) return link[0];
  const file = text.match(/[\w\-.()]+\.(?:jpe?g|png|webp|heic|mp4|mov)\b/i);
  return file ? file[0] : null;
}

export function cellText(value: unknown): string | null {
  if (value == null) return null;
  const s = String(value).replace(/\r\n/g, "\n").trim();
  return s === "" ? null : s;
}

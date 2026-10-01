import "server-only";
import * as XLSX from "xlsx";
import type { ContentItem } from "../types";
import { autoMap, FIELD_KEYS, headerScore, type FieldKey } from "./columns";
import { cellText, findAssetRef, parseChannels, parseDate, parseFormat, parseTime } from "./values";

export type SheetPreview = {
  name: string;
  kind: "social" | "email";
  headerRow: number;
  headers: string[];
  rows: unknown[][];
};

/** Reads every sheet that looks like a calendar (has a recognisable header row). */
export function readWorkbook(buf: Buffer): SheetPreview[] {
  const wb = XLSX.read(buf, { type: "buffer", cellDates: false, raw: false, codepage: 65001 });
  const out: SheetPreview[] = [];
  for (const name of wb.SheetNames) {
    const ws = wb.Sheets[name];
    const grid = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: true, defval: null, blankrows: false });
    // The header row is the row in the first 15 with the most known column names.
    let best = -1;
    let bestScore = 0;
    grid.slice(0, 15).forEach((row, i) => {
      const score = headerScore(row);
      if (score > bestScore) {
        best = i;
        bestScore = score;
      }
    });
    if (best < 0 || bestScore < 3) continue;
    const raw = grid[best].map((h) => String(h ?? "").trim());
    // Make headers unique and non-empty.
    const seen = new Map<string, number>();
    const headers = raw.map((h, i) => {
      const base = h || `Column ${i + 1}`;
      const n = seen.get(base) ?? 0;
      seen.set(base, n + 1);
      return n ? `${base} (${n + 1})` : base;
    });
    const rows = grid
      .slice(best + 1)
      .filter((r) => r.some((c) => c !== null && String(c).trim() !== ""));
    out.push({ name, kind: /email|klaviyo|edm/i.test(name) ? "email" : "social", headerRow: best, headers, rows });
  }
  return out;
}

export function sheetMapping(sheet: SheetPreview, saved: Record<string, string>) {
  return autoMap(sheet.headers, saved);
}

/** Guesses the calendar month (YYYY-MM-01) from the most common date in the sheets. */
export function guessMonth(sheets: SheetPreview[], mappings: Record<string, Record<string, string>>): string | null {
  const year = new Date().getFullYear();
  const counts = new Map<string, number>();
  for (const s of sheets) {
    const col = s.headers.findIndex((h) => mappings[s.name]?.[h] === "post_date");
    if (col < 0) continue;
    for (const r of s.rows) {
      const d = parseDate(r[col], year);
      if (d) counts.set(d.slice(0, 7), (counts.get(d.slice(0, 7)) ?? 0) + 1);
    }
  }
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  return top ? `${top[0]}-01` : null;
}

export type ParsedItem = Omit<ContentItem, "id" | "client_id" | "calendar_id" | "status" | "caption_suggestion" | "buffer_posts" | "custom_media"> & {
  warnings: string[];
};

/** Turns one sheet's rows into content items using the header → field mapping. */
export function rowsToItems(sheet: SheetPreview, mapping: Record<string, string>, monthStart: string): ParsedItem[] {
  const year = Number(monthStart.slice(0, 4));
  const col = new Map<FieldKey, number>();
  sheet.headers.forEach((h, i) => {
    const f = mapping[h];
    if (f && FIELD_KEYS.includes(f as FieldKey)) col.set(f as FieldKey, i);
  });
  const get = (r: unknown[], f: FieldKey) => (col.has(f) ? r[col.get(f)!] : null);
  const txt = (r: unknown[], f: FieldKey) => cellText(get(r, f));

  const items: ParsedItem[] = [];
  sheet.rows.forEach((r, idx) => {
    const caption = txt(r, "caption");
    const hook = txt(r, "hook");
    const subject = txt(r, "email_subject");
    // Skip section-divider rows (e.g. "WEEK 2") that have no content.
    if (!caption && !hook && !subject && !txt(r, "asset_brief")) return;

    const warnings: string[] = [];
    const rawDate = get(r, "post_date");
    const post_date = parseDate(rawDate, year);
    if (rawDate != null && !post_date) warnings.push(`Couldn't read the date "${String(rawDate)}"`);
    const dateCell = typeof rawDate === "number" ? parseTime(rawDate) : null;
    const post_time = parseTime(get(r, "post_time")) ?? (dateCell && dateCell !== "00:00" ? dateCell : null);

    const numberCell = get(r, "row_number");
    const row_number = numberCell != null && !Number.isNaN(Number(numberCell)) ? Number(numberCell) : idx + 1;

    const assetBrief = txt(r, "asset_brief");
    const source_row: Record<string, unknown> = {};
    sheet.headers.forEach((h, i) => {
      if (r[i] != null && r[i] !== "") source_row[h] = r[i];
    });

    const type = sheet.kind;
    items.push({
      type,
      row_number,
      post_date,
      post_time,
      day: txt(r, "day"),
      phase: txt(r, "phase"),
      slot: txt(r, "slot"),
      channels: type === "email" ? ["email"] : parseChannels(get(r, "channels")),
      format: type === "email" ? null : parseFormat(get(r, "format")),
      pillar: txt(r, "pillar"),
      moment_offer: txt(r, "moment_offer"),
      hook,
      caption,
      caption_status: txt(r, "caption_status"),
      cta: txt(r, "cta"),
      hashtags: txt(r, "hashtags"),
      first_comment: txt(r, "first_comment"),
      asset_brief: assetBrief,
      asset_group: txt(r, "asset_group"),
      asset_status: txt(r, "asset_status"),
      asset_ref: txt(r, "asset_ref") ?? findAssetRef(assetBrief),
      owner: txt(r, "owner"),
      scheduled: txt(r, "scheduled"),
      live: txt(r, "live"),
      compliance_note: txt(r, "compliance_note"),
      email_subject: subject,
      email_preview: txt(r, "email_preview"),
      source_row,
      warnings,
    });
  });
  return items;
}

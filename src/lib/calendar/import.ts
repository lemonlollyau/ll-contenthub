import "server-only";
import { config } from "../config";
import { db, must } from "../db";
import type { Calendar, Client } from "../types";
import { readWorkbook, rowsToItems, type ParsedItem, type SheetPreview } from "./parse";

// Import is two steps: upload (stores the file, creates a draft calendar),
// then confirm (applies the column mapping and writes content items).
// Re-importing a month updates matching rows in place, so approved imagery
// and Buffer post ids are kept.

export async function loadSheets(calendar: Calendar): Promise<SheetPreview[]> {
  if (!calendar.source_path) throw new Error("This calendar has no uploaded file.");
  const { data, error } = await db().storage.from(config.storage.importsBucket).download(calendar.source_path);
  if (error || !data) throw new Error(`Couldn't open the uploaded file: ${error?.message ?? "missing"}`);
  const sheets = readWorkbook(Buffer.from(await data.arrayBuffer()));
  if (!sheets.length) {
    throw new Error("Couldn't find a calendar in that file. The header row needs columns like Date, Platform, Caption.");
  }
  return sheets;
}

export function safeFileName(name: string): string {
  return name.replace(/[^\w.\- ]+/g, "_").slice(0, 120);
}

export type ImportSummary = { created: number; updated: number; removed: number; keptPushed: number; warnings: string[] };

export async function applyImport(
  client: Client,
  calendar: Calendar,
  sheets: SheetPreview[],
  mappings: Record<string, Record<string, string>>,
  sheetIncluded: Record<string, boolean>,
  month: string,
): Promise<{ calendarId: string; summary: ImportSummary }> {
  const parsed: ParsedItem[] = [];
  for (const s of sheets) {
    if (!sheetIncluded[s.name]) continue;
    parsed.push(...rowsToItems(s, mappings[s.name] ?? {}, month));
  }
  if (!parsed.length) throw new Error("No rows to import. Check the Caption/Hook column mapping.");

  // Same month already imported? Update that calendar instead of making a second one.
  const existing = must(
    await db().from("calendars").select("*").eq("client_id", client.id).eq("month", month).not("imported_at", "is", null).neq("id", calendar.id).maybeSingle(),
    "check for an existing month",
  ) as Calendar | null;
  const target = existing ?? calendar;

  const current = must(
    await db().from("content_items").select("id, type, row_number, external_posts, status").eq("calendar_id", target.id),
    "load existing rows",
  ) as { id: string; type: string; row_number: number | null; external_posts: Record<string, string>; status: string }[];
  const byKey = new Map(current.map((c) => [`${c.type}:${c.row_number}`, c]));

  const summary: ImportSummary = { created: 0, updated: 0, removed: 0, keptPushed: 0, warnings: [] };
  const seen = new Set<string>();
  const inserts: Record<string, unknown>[] = [];

  for (const p of parsed) {
    const { warnings, ...fields } = p;
    let key = `${p.type}:${p.row_number}`;
    // Duplicate "#" values: give later rows a unique number.
    while (seen.has(key)) {
      fields.row_number = (fields.row_number ?? 0) + 1000;
      key = `${p.type}:${fields.row_number}`;
    }
    seen.add(key);
    for (const w of warnings) summary.warnings.push(`${p.type} #${p.row_number}: ${w}`);

    const prev = byKey.get(key);
    if (prev) {
      must(await db().from("content_items").update(fields).eq("id", prev.id).select("id"), `update row #${p.row_number}`);
      summary.updated += 1;
    } else {
      inserts.push({ ...fields, client_id: client.id, calendar_id: target.id });
    }
  }
  for (let i = 0; i < inserts.length; i += 200) {
    must(await db().from("content_items").insert(inserts.slice(i, i + 200)).select("id"), "add new rows");
  }
  summary.created = inserts.length;

  // Rows no longer in the sheet: delete, unless they've already been sent to Buffer.
  const gone = current.filter((c) => !seen.has(`${c.type}:${c.row_number}`));
  const pushed = gone.filter((c) => c.status === "pushed" || Object.keys(c.external_posts ?? {}).length);
  const removable = gone.filter((c) => !pushed.includes(c));
  if (removable.length) {
    must(await db().from("content_items").delete().in("id", removable.map((c) => c.id)).select("id"), "remove deleted rows");
  }
  summary.removed = removable.length;
  summary.keptPushed = pushed.length;
  if (pushed.length) summary.warnings.push(`${pushed.length} row(s) were removed from the sheet but are already in Buffer, so they were kept.`);

  must(
    await db().from("calendars").update({
      month,
      imported_at: new Date().toISOString(),
      column_mapping: mappings,
      source_filename: calendar.source_filename,
      source_path: calendar.source_path,
    }).eq("id", target.id).select("id"),
    "save the calendar",
  );
  if (existing) must(await db().from("calendars").delete().eq("id", calendar.id).select("id"), "tidy up");

  // Remember the mapping for next month, per sheet kind.
  const saved = { ...client.import_mapping };
  for (const s of sheets) if (sheetIncluded[s.name]) saved[s.kind] = { ...(saved[s.kind] ?? {}), ...mappings[s.name] };
  must(await db().from("clients").update({ import_mapping: saved }).eq("id", client.id).select("id"), "save the column mapping");

  return { calendarId: target.id, summary };
}

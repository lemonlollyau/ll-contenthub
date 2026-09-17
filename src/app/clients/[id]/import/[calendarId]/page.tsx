import { requireUser } from "@/lib/auth";
import { FIELDS, FIELD_KEYS } from "@/lib/calendar/columns";
import { loadSheets } from "@/lib/calendar/import";
import { guessMonth, rowsToItems, sheetMapping } from "@/lib/calendar/parse";
import { getClient } from "@/lib/clients";
import { db, must } from "@/lib/db";
import type { Calendar } from "@/lib/types";
import { errorMessage } from "@/lib/log";
import { cancelImport } from "../../calendar-actions";
import { ImportForm } from "./import-form";

export default async function ImportPage({ params }: PageProps<"/clients/[id]/import/[calendarId]">) {
  await requireUser();
  const { id, calendarId } = await params;
  const client = await getClient(id);
  const calendar = must(await db().from("calendars").select("*").eq("id", calendarId).single(), "load the import") as Calendar;

  let sheets;
  try {
    sheets = await loadSheets(calendar);
  } catch (err) {
    return (
      <div className="rounded-xl bg-red-50 p-4 text-sm text-red-700">
        {errorMessage(err)}
        <form action={cancelImport.bind(null, id, calendarId)} className="mt-3">
          <button className="rounded border border-red-300 px-3 py-1">Start again</button>
        </form>
      </div>
    );
  }

  const mappings = Object.fromEntries(sheets.map((s) => [s.name, sheetMapping(s, client.import_mapping[s.kind] ?? {})]));
  const month = guessMonth(sheets, mappings)?.slice(0, 7) ?? calendar.month.slice(0, 7);
  const previews = sheets.map((s) => rowsToItems(s, mappings[s.name], `${month}-01`));
  const fieldOptions = FIELD_KEYS.map((k) => ({ value: k, label: FIELDS[k].label }));

  return (
    <div>
      <h2 className="text-lg font-semibold">Check the import: {calendar.source_filename}</h2>
      <p className="mt-1 text-sm text-stone-500">
        Columns are matched by header name. Anything set to &quot;Ignore&quot; is kept with the row but not used. Your choices are saved for next month.
      </p>
      <ImportForm
        clientId={id}
        calendarId={calendarId}
        month={month}
        fieldOptions={fieldOptions}
        sheets={sheets.map((s, si) => ({
          name: s.name,
          kind: s.kind,
          rowCount: previews[si].length,
          headers: s.headers.map((h, hi) => ({ header: h, mapped: mappings[s.name][h] ?? "", sample: String(s.rows.find((r) => r[hi] != null && r[hi] !== "")?.[hi] ?? "").slice(0, 60) })),
          preview: previews[si].slice(0, 4).map((p) => ({
            row: p.row_number, date: p.post_date, time: p.post_time, channels: p.channels.join(", "), format: p.format,
            hook: p.hook ?? p.email_subject, warnings: p.warnings,
          })),
          warnings: previews[si].flatMap((p) => p.warnings.map((w) => `#${p.row_number}: ${w}`)).slice(0, 10),
        }))}
      />
      <form action={cancelImport.bind(null, id, calendarId)} className="mt-3">
        <button className="text-sm text-stone-500 underline">Cancel import</button>
      </form>
    </div>
  );
}

import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { getClient } from "@/lib/clients";
import { db } from "@/lib/db";
import { isCaptionLocked, itemFlags } from "@/lib/flags";
import { suggestTime } from "@/lib/posting-times";
import type { Calendar, ContentItem } from "@/lib/types";
import { EditableCell } from "./editable-cell";
import { startMatching, uploadCalendar } from "./calendar-actions";

const STATUSES = ["draft", "ready", "approved", "pushed"] as const;
const monthLabel = (m: string) => new Date(`${m}T00:00:00Z`).toLocaleDateString("en-AU", { month: "long", year: "numeric", timeZone: "UTC" });

export default async function CalendarPage({ params, searchParams }: PageProps<"/clients/[id]">) {
  await requireUser();
  const { id } = await params;
  const sp = await searchParams;
  const client = await getClient(id);
  const calendars = ((await db().from("calendars").select("*").eq("client_id", id).not("imported_at", "is", null).order("month", { ascending: false })).data ?? []) as Calendar[];
  const calendar = calendars.find((c) => c.id === sp.calendar) ?? calendars[0];
  const status = typeof sp.status === "string" && (STATUSES as readonly string[]).includes(sp.status) ? sp.status : "";
  const type = typeof sp.type === "string" ? sp.type : "";

  let items: ContentItem[] = [];
  let approvedAssetItems = new Set<string>();
  if (calendar) {
    let q = db().from("content_items").select("*").eq("calendar_id", calendar.id).order("type", { ascending: false }).order("post_date").order("row_number");
    if (status) q = q.eq("status", status);
    if (type) q = q.eq("type", type);
    items = ((await q).data ?? []) as ContentItem[];
    const approved = await db().from("asset_matches").select("content_item_id").in("content_item_id", items.map((i) => i.id)).in("state", ["approved", "swapped"]).not("asset_id", "is", null);
    approvedAssetItems = new Set((approved.data ?? []).map((r) => r.content_item_id as string));
  }
  const warnings = typeof sp.warnings === "string" ? sp.warnings.split("\n") : [];
  const errorCount = items.reduce((n, i) => n + itemFlags(i).filter((f) => f.level === "error").length, 0);
  const link = (p: Record<string, string>) =>
    `?${new URLSearchParams({ ...(calendar && { calendar: calendar.id }), ...(status && { status }), ...(type && { type }), ...p })}`;

  return (
    <div>
      {sp.imported && (
        <div className="mb-4 rounded-xl bg-green-50 p-3 text-sm text-green-800">
          Imported {sp.imported} rows.
          {warnings.length > 0 && <ul className="mt-1 list-disc pl-5 text-amber-800">{warnings.map((w) => <li key={w}>{w}</li>)}</ul>}
        </div>
      )}

      <div className="flex flex-wrap items-end gap-4">
        {calendars.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {calendars.map((c) => (
              <Link key={c.id} href={`?calendar=${c.id}`} className={`rounded-full px-3 py-1 text-sm ${c.id === calendar?.id ? "bg-stone-900 text-white" : "border border-stone-300 bg-white"}`}>
                {monthLabel(c.month)}
              </Link>
            ))}
          </div>
        )}
        <form action={uploadCalendar.bind(null, id)} className="ml-auto flex items-center gap-2 text-sm">
          <input type="file" name="file" accept=".xlsx,.xlsm,.xls,.csv" required className="text-sm" />
          <button className="rounded-lg bg-stone-900 px-3 py-1.5 text-white hover:bg-stone-700">Import calendar</button>
        </form>
      </div>

      {!calendar ? (
        <p className="mt-10 text-center text-stone-500">No calendars yet. Import this month&apos;s .xlsx to get started.</p>
      ) : (
        <>
          <div className="mt-6 flex flex-wrap items-center gap-2 text-sm">
            <span className="text-stone-500">{calendar.source_filename}</span>
            <span className="mx-2 text-stone-300">|</span>
            {["", ...STATUSES].map((s) => (
              <Link key={s || "all"} href={link({ status: s })} className={`rounded px-2 py-0.5 ${status === s ? "bg-amber-100 text-amber-900" : "text-stone-600 hover:bg-stone-100"}`}>
                {s || "All"}
              </Link>
            ))}
            <span className="mx-2 text-stone-300">|</span>
            {["", "social", "email"].map((t) => (
              <Link key={t || "all-types"} href={link({ type: t })} className={`rounded px-2 py-0.5 ${type === t ? "bg-amber-100 text-amber-900" : "text-stone-600 hover:bg-stone-100"}`}>
                {t || "All types"}
              </Link>
            ))}
            <div className="ml-auto flex items-center gap-3">
              {errorCount > 0 && <span className="rounded bg-red-100 px-2 py-0.5 font-medium text-red-700">{errorCount} problems to fix</span>}
              <form action={startMatching.bind(null, id, calendar.id)}>
                <button className="rounded-lg bg-amber-500 px-3 py-1.5 font-medium text-white hover:bg-amber-600">Match imagery →</button>
              </form>
            </div>
          </div>

          <div className="mt-3 overflow-x-auto rounded-xl border border-stone-200 bg-white">
            <table className="min-w-[1400px] text-xs">
              <thead className="bg-stone-50 text-left text-stone-500">
                <tr>
                  {["#", "Date", "Time", "Platform", "Format", "Pillar", "Hook", "Caption", "CTA", "Hashtags", "Asset brief", "Asset group", "Flags", "Status"].map((h) => (
                    <th key={h} className="px-2 py-2 font-medium">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {items.map((item) => {
                  const cell = (field: keyof ContentItem, opts: { multiline?: boolean; w?: string; locked?: string } = {}) => (
                    <td className={`px-1 py-1.5 align-top ${opts.w ?? ""}`}>
                      <EditableCell clientId={id} itemId={item.id} field={field} value={String(item[field] ?? "")} multiline={opts.multiline} locked={opts.locked} />
                    </td>
                  );
                  const suggestion = item.post_time ? null : suggestTime(item, client.posting_rules);
                  const flags = itemFlags(item, { hasAsset: item.type === "social" ? approvedAssetItems.has(item.id) : undefined });
                  return (
                    <tr key={item.id} className="border-t border-stone-100">
                      <td className="px-2 py-1.5 align-top text-stone-500">{item.type === "email" ? "✉︎ " : ""}{item.row_number}</td>
                      {cell("post_date", { w: "w-24" })}
                      <td className="w-16 px-1 py-1.5 align-top">
                        <EditableCell
                          clientId={id} itemId={item.id} field="post_time" value={item.post_time?.slice(0, 5) ?? ""}
                          display={suggestion ? <span className="text-stone-400" title={`Suggested: ${suggestion.rule}`}>{suggestion.time}*</span> : undefined}
                        />
                      </td>
                      <td className="px-1 py-1.5 align-top">
                        <EditableCell clientId={id} itemId={item.id} field="channels" value={item.channels.join(", ")} />
                      </td>
                      {cell("format")}
                      {cell("pillar")}
                      {cell("hook", { w: "w-48", multiline: true })}
                      {cell("caption", {
                        w: "w-80",
                        multiline: true,
                        locked: isCaptionLocked(item) ? "Caption is marked approved and can't be edited here." : undefined,
                      })}
                      {cell("cta", { w: "w-32" })}
                      {cell("hashtags", { w: "w-40", multiline: true })}
                      {cell("asset_brief", { w: "w-48", multiline: true })}
                      {cell("asset_group")}
                      <td className="w-48 px-2 py-1.5 align-top">
                        {flags.map((f) => (
                          <p key={f.text} className={`mb-1 rounded px-1 ${f.level === "error" ? "bg-red-50 text-red-700" : "bg-amber-50 text-amber-800"}`}>{f.text}</p>
                        ))}
                      </td>
                      {cell("status")}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-xs text-stone-500">* grey times are suggested from the posting-time rules. Click any cell to edit.</p>
        </>
      )}
    </div>
  );
}

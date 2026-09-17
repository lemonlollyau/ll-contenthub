"use client";
import { useActionState } from "react";
import { confirmImport } from "../../calendar-actions";
import { inputClass } from "@/components/ui/form";

type SheetView = {
  name: string;
  kind: string;
  rowCount: number;
  headers: { header: string; mapped: string; sample: string }[];
  preview: { row: number | null; date: string | null; time: string | null; channels: string; format: string | null; hook: string | null; warnings: string[] }[];
  warnings: string[];
};

export function ImportForm({
  clientId, calendarId, month, sheets, fieldOptions,
}: {
  clientId: string;
  calendarId: string;
  month: string;
  sheets: SheetView[];
  fieldOptions: { value: string; label: string }[];
}) {
  const [result, action, pending] = useActionState(confirmImport.bind(null, clientId, calendarId), null);
  const total = sheets.reduce((n, s) => n + s.rowCount, 0);
  return (
    <form action={action} className="mt-4 space-y-6">
      <label className="block max-w-xs">
        <span className="text-sm font-medium">Calendar month</span>
        <input type="month" name="month" defaultValue={month} required className={`${inputClass} mt-1`} />
      </label>

      {sheets.map((s, si) => (
        <section key={s.name} className="rounded-2xl border border-stone-200 bg-white p-5">
          <label className="flex items-center gap-2">
            <input type="checkbox" name={`include_${si}`} defaultChecked />
            <span className="font-semibold">Tab &quot;{s.name}&quot;</span>
            <span className="rounded bg-stone-100 px-2 text-xs">{s.kind === "email" ? "email items" : "social posts"}</span>
            <span className="text-sm text-stone-500">{s.rowCount} rows</span>
          </label>
          <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {s.headers.map((h, hi) => (
              <div key={h.header} className="flex items-center gap-2 text-sm">
                <div className="w-40 shrink-0 truncate" title={h.sample ? `e.g. ${h.sample}` : undefined}>
                  <span className="font-medium">{h.header}</span>
                  {h.sample && <span className="block truncate text-xs text-stone-400">{h.sample}</span>}
                </div>
                <select name={`map_${si}_${hi}`} defaultValue={h.mapped} className={`${inputClass} py-1 ${h.mapped ? "" : "text-stone-400"}`}>
                  <option value="">Ignore</option>
                  {fieldOptions.map((f) => (
                    <option key={f.value} value={f.value}>{f.label}</option>
                  ))}
                </select>
              </div>
            ))}
          </div>
          <table className="mt-4 w-full text-xs">
            <thead className="text-left text-stone-500">
              <tr><th>#</th><th>Date</th><th>Time</th><th>Platform</th><th>Format</th><th>Hook / subject</th></tr>
            </thead>
            <tbody>
              {s.preview.map((p, i) => (
                <tr key={i} className="border-t border-stone-100">
                  <td className="py-1">{p.row}</td><td>{p.date ?? "?"}</td><td>{p.time ?? "–"}</td><td>{p.channels}</td><td>{p.format}</td>
                  <td className="max-w-md truncate">{p.hook}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-1 text-xs text-stone-400">Preview of the first rows, using the mapping as the page loaded.</p>
          {s.warnings.length > 0 && (
            <ul className="mt-2 list-disc pl-5 text-xs text-amber-800">{s.warnings.map((w) => <li key={w}>{w}</li>)}</ul>
          )}
        </section>
      ))}

      {result && !result.ok && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{result.message}</p>}
      <button disabled={pending} className="rounded-lg bg-stone-900 px-5 py-2 text-sm font-medium text-white hover:bg-stone-700 disabled:opacity-50">
        {pending ? "Importing…" : `Import ${total} rows`}
      </button>
    </form>
  );
}

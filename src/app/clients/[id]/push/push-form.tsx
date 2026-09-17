"use client";
import { useActionState, useState } from "react";
import { startPush } from "./actions";

type PlanView = {
  key: string; rowNumber: number | null; platform: string; channelName: string | null; format: string | null;
  date: string | null; time: string | null; timeRule: string | null; text: string; media: string[];
  existing: boolean; errors: string[]; warnings: string[];
};

export function PushForm({ clientId, calendarId, plans }: { clientId: string; calendarId: string; plans: PlanView[] }) {
  const [result, action, pending] = useActionState(startPush.bind(null, clientId, calendarId), null);
  const ready = plans.filter((p) => !p.errors.length);
  const [selected, setSelected] = useState<Set<string>>(new Set(ready.map((p) => p.key)));
  const [mode, setMode] = useState<"draft" | "schedule">("draft");
  const [open, setOpen] = useState<string | null>(null);

  const toggle = (k: string) => setSelected((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; });

  return (
    <form action={action} className="mt-4">
      <div className="max-h-[60vh] overflow-auto rounded-lg border border-stone-200">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-stone-50 text-left text-stone-500">
            <tr>
              <th className="p-2"><input type="checkbox" checked={selected.size === ready.length && ready.length > 0} onChange={(e) => setSelected(new Set(e.target.checked ? ready.map((p) => p.key) : []))} /></th>
              <th>#</th><th>Channel</th><th>When</th><th>Format</th><th>Image</th><th>Text</th><th>Checks</th>
            </tr>
          </thead>
          <tbody>
            {plans.map((p) => (
              <tr key={p.key} className={`border-t border-stone-100 align-top ${p.errors.length ? "bg-red-50/50" : ""}`}>
                <td className="p-2">
                  <input type="checkbox" name="key" value={p.key} disabled={!!p.errors.length} checked={selected.has(p.key)} onChange={() => toggle(p.key)} />
                </td>
                <td className="py-2 pr-2">{p.rowNumber}</td>
                <td className="pr-2">{p.channelName ?? <span className="text-red-600">{p.platform}: not mapped</span>}</td>
                <td className="whitespace-nowrap pr-2">
                  {p.date} {p.time}
                  {p.timeRule && <span className="block text-stone-400">{p.timeRule}</span>}
                </td>
                <td className="pr-2">{p.format}</td>
                <td className="pr-2">
                  <div className="flex gap-1">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    {p.media.slice(0, 3).map((u) => (/\.(mp4|mov)$/i.test(u) ? <span key={u}>▶</span> : <img key={u} src={u} alt="" className="h-12 w-10 rounded object-cover" />))}
                    {p.media.length > 3 && <span>+{p.media.length - 3}</span>}
                  </div>
                </td>
                <td className="max-w-md pr-2">
                  <button type="button" onClick={() => setOpen(open === p.key ? null : p.key)} className="text-left">
                    <span className={`whitespace-pre-wrap ${open === p.key ? "" : "line-clamp-2"}`}>{p.text}</span>
                    <span className="text-stone-400"> ({p.text.length} chars)</span>
                  </button>
                </td>
                <td className="pr-2">
                  {p.existing && <p className="text-blue-700">In Buffer. Will update.</p>}
                  {p.errors.map((e) => <p key={e} className="text-red-700">✕ {e}</p>)}
                  {p.warnings.map((w) => <p key={w} className="text-amber-800">! {w}</p>)}
                  {!p.errors.length && !p.warnings.length && <p className="text-green-700">✓ Ready</p>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <fieldset className="mt-4 flex flex-wrap items-center gap-4 text-sm">
        <label className="flex items-center gap-1">
          <input type="radio" name="mode" value="draft" checked={mode === "draft"} onChange={() => setMode("draft")} />
          Drafts (nothing publishes)
        </label>
        <label className="flex items-center gap-1">
          <input type="radio" name="mode" value="schedule" checked={mode === "schedule"} onChange={() => setMode("schedule")} />
          Schedule (posts WILL publish at their times)
        </label>
        {mode === "schedule" && (
          <input name="confirm" placeholder="Type SCHEDULE to confirm" className="rounded border border-red-300 px-2 py-1" />
        )}
      </fieldset>
      <div className="mt-3 flex items-center gap-3">
        <button disabled={pending || !selected.size} className={`rounded-lg px-4 py-2 text-sm font-medium text-white disabled:opacity-40 ${mode === "schedule" ? "bg-red-600" : "bg-stone-900"}`}>
          {pending ? "Starting…" : `Send ${selected.size} post${selected.size === 1 ? "" : "s"} to Buffer ${mode === "draft" ? "as drafts" : "and SCHEDULE"}`}
        </button>
        <span className="text-xs text-stone-500">{plans.length - ready.length} blocked</span>
        {result && <span className={`text-sm ${result.ok ? "text-green-700" : "text-red-700"}`}>{result.message}</span>}
      </div>
    </form>
  );
}

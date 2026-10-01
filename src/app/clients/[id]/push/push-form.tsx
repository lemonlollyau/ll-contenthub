"use client";
import { useActionState, useState } from "react";
import { startPush } from "./actions";
import { QuickFix } from "./quick-fix";

type PlanView = {
  key: string; itemId: string; rowNumber: number | null; platform: string; channelName: string | null; format: string | null;
  date: string | null; time: string | null; timeRule: string | null; text: string; media: string[];
  existing: boolean; errors: string[]; warnings: string[]; compliance: string | null;
};

export function PushForm({ clientId, calendarId, plans, provider }: { clientId: string; calendarId: string; plans: PlanView[]; provider: string }) {
  const [result, action, pending] = useActionState(startPush.bind(null, clientId, calendarId), null);
  const ready = plans.filter((p) => !p.errors.length);
  const unsent = ready.filter((p) => !p.existing);
  // Default to sending what hasn't gone yet; already-sent posts are only
  // re-sent on purpose (which updates them rather than duplicating).
  const [selected, setSelected] = useState<Set<string>>(new Set(unsent.map((p) => p.key)));
  const [view, setView] = useState<"todo" | "sent" | "all">("todo");
  const visible = plans.filter((p) => (view === "todo" ? !p.existing : view === "sent" ? p.existing : true));
  const counts = { todo: plans.filter((p) => !p.existing).length, sent: plans.filter((p) => p.existing).length, all: plans.length };
  const [mode, setMode] = useState<"draft" | "schedule">("draft");
  const [open, setOpen] = useState<string | null>(null);
  const [read, setRead] = useState<Set<string>>(new Set());
  const [openNote, setOpenNote] = useState<string | null>(null);
  const withNotes = plans.filter((p) => p.compliance?.trim());
  const toggleRead = (k: string) => setRead((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; });

  const toggle = (k: string) => setSelected((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; });

  return (
    <form action={action} className="mt-4">
      <div className="mb-2 flex flex-wrap items-center gap-1 text-sm">
        {(["todo", "sent", "all"] as const).map((v) => (
          <button
            key={v}
            type="button"
            onClick={() => setView(v)}
            className={`rounded px-2 py-0.5 ${view === v ? "bg-amber-100 text-amber-900" : "text-stone-600 hover:bg-stone-100"}`}
          >
            {v === "todo" ? "Not sent yet" : v === "sent" ? "Already sent" : "All"} ({counts[v]})
          </button>
        ))}
        {view === "sent" && <span className="ml-2 text-xs text-stone-500">Sending these again updates the existing drafts.</span>}
      </div>
      <div className="max-h-[60vh] overflow-auto rounded-lg border border-stone-200">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-stone-50 text-left text-stone-500">
            <tr>
              <th className="p-2">
                <input
                  type="checkbox"
                  checked={visible.some((p) => selected.has(p.key)) && visible.filter((p) => !p.errors.length).every((p) => selected.has(p.key))}
                  onChange={(e) => {
                    const keys = visible.filter((p) => !p.errors.length).map((p) => p.key);
                    setSelected((prev) => {
                      const next = new Set(prev);
                      keys.forEach((k) => (e.target.checked ? next.add(k) : next.delete(k)));
                      return next;
                    });
                  }}
                />
              </th>
              <th>#</th><th>Channel</th><th colSpan={2}>When &amp; format</th><th>Image</th><th>Text</th>
              <th className="whitespace-nowrap">
                Compliance
                {withNotes.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setRead(read.size === withNotes.length ? new Set() : new Set(withNotes.map((p) => p.key)))}
                    className="ml-1 font-normal text-amber-700 underline"
                  >
                    {read.size === withNotes.length ? "untick all" : "tick all"}
                  </button>
                )}
              </th>
              <th>Checks</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((p) => (
              <tr key={p.key} className={`border-t border-stone-100 align-top ${p.errors.length ? "bg-red-50/50" : ""}`}>
                <td className="p-2">
                  <input type="checkbox" name="key" value={p.key} disabled={!!p.errors.length} checked={selected.has(p.key)} onChange={() => toggle(p.key)} />
                </td>
                <td className="py-2 pr-2">{p.rowNumber}</td>
                <td className="pr-2">{p.channelName ?? <span className="text-red-600">{p.platform}: not mapped</span>}</td>
                <td className="pr-2 align-top" colSpan={2}>
                  <QuickFix
                    clientId={clientId}
                    itemId={p.itemId}
                    format={p.format}
                    date={p.date}
                    time={p.time}
                    timeRule={p.timeRule}
                  />
                </td>
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
                <td className="pr-2 align-top">
                  {p.compliance?.trim() ? (
                    <div className="w-40">
                      <label className="flex cursor-pointer items-start gap-1">
                        <input type="checkbox" checked={read.has(p.key)} onChange={() => toggleRead(p.key)} className="mt-0.5" />
                        <span className={read.has(p.key) ? "text-stone-400 line-through" : "text-amber-800"}>Read the note</span>
                      </label>
                      <button type="button" onClick={() => setOpenNote(openNote === p.key ? null : p.key)} className="text-left text-stone-500 underline">
                        {openNote === p.key ? "hide" : "show"}
                      </button>
                      {openNote === p.key && <p className="mt-1 whitespace-pre-wrap text-amber-900">{p.compliance}</p>}
                    </div>
                  ) : (
                    <span className="text-stone-300">—</span>
                  )}
                </td>
                <td className="pr-2">
                  {p.existing && <p className="text-blue-700">Already in {provider}. Will update.</p>}
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
          {pending ? "Starting…" : `Send ${selected.size} post${selected.size === 1 ? "" : "s"} to ${provider} ${mode === "draft" ? "as drafts" : "and SCHEDULE"}`}
        </button>
        <span className="text-xs text-stone-500">
          {plans.length - ready.length} blocked
          {withNotes.length > 0 && ` · ${withNotes.length - read.size} compliance note${withNotes.length - read.size === 1 ? "" : "s"} unread`}
        </span>
        {result && <span className={`text-sm ${result.ok ? "text-green-700" : "text-red-700"}`}>{result.message}</span>}
      </div>
    </form>
  );
}

"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateItemField } from "../calendar-actions";

const FORMATS = ["feed", "carousel", "reel", "story", "square", "text"] as const;

/** Edit the post text without leaving the preview (placeholders, typos, length). */
export function EditText({ clientId, itemId, text, chars }: { clientId: string; itemId: string; text: string; chars: number }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(text);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();

  function save() {
    start(async () => {
      try {
        setError(null);
        await updateItemField(clientId, itemId, "caption", draft);
        setEditing(false);
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Couldn't save");
      }
    });
  }

  if (!editing) {
    return (
      <div>
        <p className="line-clamp-2 whitespace-pre-wrap">{text}</p>
        <p className="text-stone-400">
          ({chars} chars){" "}
          <button type="button" onClick={() => setEditing(true)} className="text-amber-700 underline">edit</button>
        </p>
      </div>
    );
  }
  return (
    <div>
      <textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        rows={10}
        className="w-full rounded border border-amber-400 p-1 text-xs"
        autoFocus
      />
      <div className="mt-1 flex items-center gap-2">
        <button type="button" disabled={pending} onClick={save} className="rounded bg-stone-900 px-2 py-0.5 text-white disabled:opacity-50">
          {pending ? "Saving…" : "Save caption"}
        </button>
        <button type="button" onClick={() => { setDraft(text); setEditing(false); }} className="text-stone-500">cancel</button>
        <span className="text-stone-400">{draft.length} chars</span>
      </div>
      <p className="mt-1 text-stone-400">This edits the calendar, so the change sticks everywhere. Buffer gets it on the next send.</p>
      {error && <p className="text-red-700">{error}</p>}
    </div>
  );
}

/**
 * Edits the few fields that usually block a push (format, date, time) without
 * leaving the preview. Saving re-runs every check, so the row updates in place.
 */
export function QuickFix({
  clientId, itemId, format, date, time, timeRule,
}: {
  clientId: string;
  itemId: string;
  format: string | null;
  date: string | null;
  time: string | null;
  timeRule: string | null;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();

  function save(field: string, value: string) {
    start(async () => {
      try {
        setError(null);
        await updateItemField(clientId, itemId, field, value);
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Couldn't save");
      }
    });
  }

  const field = "rounded border border-stone-300 bg-white px-1 py-0.5 text-xs disabled:opacity-50";
  return (
    <div className={pending ? "opacity-50" : ""}>
      <div className="flex flex-col gap-1">
        <input type="date" defaultValue={date ?? ""} disabled={pending} onChange={(e) => save("post_date", e.target.value)} className={field} />
        <input
          type="time"
          defaultValue={time ?? ""}
          disabled={pending}
          onChange={(e) => e.target.value && save("post_time", e.target.value)}
          className={field}
          title={timeRule ? `Suggested from your rules: ${timeRule}` : undefined}
        />
        {!time && timeRule && <span className="text-stone-400">{timeRule}</span>}
        <select defaultValue={format ?? "feed"} disabled={pending} onChange={(e) => save("format", e.target.value)} className={field}>
          {FORMATS.map((f) => (
            <option key={f} value={f}>{f}</option>
          ))}
        </select>
      </div>
      {error && <p className="mt-1 text-red-700">{error}</p>}
    </div>
  );
}

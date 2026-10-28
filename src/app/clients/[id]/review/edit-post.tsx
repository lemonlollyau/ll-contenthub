"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateItemField } from "../calendar-actions";
import { inputClass } from "@/components/ui/form";

const FORMATS = ["feed", "carousel", "reel", "story", "square", "text"] as const;

type Fields = {
  hook: string;
  caption: string;
  cta: string;
  hashtags: string;
  first_comment: string;
  post_date: string;
  post_time: string;
  format: string;
  channels: string;
  asset_brief: string;
};

/** Everything about a post, editable in one place. */
export function EditPost({ clientId, itemId, initial }: { clientId: string; itemId: string; initial: Fields }) {
  const [draft, setDraft] = useState(initial);
  const [saved, setSaved] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();

  const changed = (Object.keys(draft) as (keyof Fields)[]).filter((k) => draft[k] !== initial[k]);

  function save() {
    start(async () => {
      try {
        setError(null);
        for (const field of changed) await updateItemField(clientId, itemId, field, draft[field]);
        setSaved(`Saved ${changed.length} change${changed.length === 1 ? "" : "s"}.`);
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Couldn't save");
      }
    });
  }

  const set = (k: keyof Fields) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    setDraft({ ...draft, [k]: e.target.value });
    setSaved(null);
  };
  const field = `${inputClass} py-1 text-xs`;

  return (
    <div className="mt-3 space-y-2 rounded-xl border border-stone-200 bg-stone-50 p-3 text-xs">
      <div className="grid gap-2 sm:grid-cols-4">
        <label className="block">
          <span className="text-stone-500">Date</span>
          <input type="date" value={draft.post_date} onChange={set("post_date")} className={field} />
        </label>
        <label className="block">
          <span className="text-stone-500">Time</span>
          <input type="time" value={draft.post_time} onChange={set("post_time")} className={field} />
        </label>
        <label className="block">
          <span className="text-stone-500">Format</span>
          <select value={draft.format} onChange={set("format")} className={field}>
            {FORMATS.map((f) => <option key={f} value={f}>{f}</option>)}
          </select>
        </label>
        <label className="block">
          <span className="text-stone-500">Platforms</span>
          <input value={draft.channels} onChange={set("channels")} placeholder="instagram, facebook" className={field} />
        </label>
      </div>
      <label className="block">
        <span className="text-stone-500">Hook</span>
        <input value={draft.hook} onChange={set("hook")} className={field} />
      </label>
      <label className="block">
        <span className="text-stone-500">Caption</span>
        <textarea value={draft.caption} onChange={set("caption")} rows={10} className={field} />
      </label>
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="block">
          <span className="text-stone-500">CTA</span>
          <input value={draft.cta} onChange={set("cta")} className={field} />
        </label>
        <label className="block">
          <span className="text-stone-500">Hashtags</span>
          <input value={draft.hashtags} onChange={set("hashtags")} className={field} />
        </label>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="block">
          <span className="text-stone-500">First comment</span>
          <input value={draft.first_comment} onChange={set("first_comment")} className={field} />
        </label>
        <label className="block">
          <span className="text-stone-500">Asset brief</span>
          <input value={draft.asset_brief} onChange={set("asset_brief")} className={field} />
        </label>
      </div>
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={save}
          disabled={pending || !changed.length}
          className="rounded-lg bg-stone-900 px-3 py-1 text-white disabled:opacity-40"
        >
          {pending ? "Saving…" : changed.length ? `Save ${changed.length} change${changed.length === 1 ? "" : "s"}` : "No changes"}
        </button>
        {saved && <span className="text-green-700">{saved}</span>}
        {error && <span className="text-red-700">{error}</span>}
      </div>
    </div>
  );
}

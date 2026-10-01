"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateItemField } from "../calendar-actions";

const FORMATS = ["feed", "carousel", "reel", "story", "square", "text"] as const;

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

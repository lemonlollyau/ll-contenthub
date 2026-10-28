"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { calendarSummary, deleteCalendar } from "./calendar-actions";

/**
 * Clears a month so it can be re-imported fresh. Deliberately two steps, and
 * it says out loud when posts have already been sent to a scheduler.
 */
export function DeleteCalendar({ clientId, calendarId, month }: { clientId: string; calendarId: string; month: string }) {
  const [summary, setSummary] = useState<{ items: number; pushed: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();

  function ask() {
    start(async () => {
      try {
        setSummary(await calendarSummary(clientId, calendarId));
      } catch (e) {
        setError(e instanceof Error ? e.message : "Couldn't check the calendar");
      }
    });
  }

  function confirm() {
    start(async () => {
      try {
        await deleteCalendar(clientId, calendarId);
        setSummary(null);
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Couldn't delete");
      }
    });
  }

  if (!summary) {
    return (
      <>
        <button type="button" onClick={ask} disabled={pending} className="text-stone-400 hover:text-red-700">
          Delete this calendar
        </button>
        {error && <span className="text-red-700">{error}</span>}
      </>
    );
  }

  return (
    <span className="inline-flex flex-wrap items-center gap-2 rounded-lg border border-red-300 bg-red-50 px-2 py-1">
      <span className="text-red-800">
        Delete {month}: {summary.items} post{summary.items === 1 ? "" : "s"}, their imagery choices and the uploaded file.
        {summary.pushed > 0 && ` ${summary.pushed} already sent to a scheduler will stay there.`}
      </span>
      <button type="button" onClick={confirm} disabled={pending} className="rounded bg-red-600 px-2 py-0.5 text-white disabled:opacity-50">
        {pending ? "Deleting…" : "Delete"}
      </button>
      <button type="button" onClick={() => setSummary(null)} className="text-stone-500">Cancel</button>
      {error && <span className="text-red-700">{error}</span>}
    </span>
  );
}

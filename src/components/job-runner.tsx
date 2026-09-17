"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

export type JobView = {
  id: string;
  status: string;
  total: number;
  done: number;
  message: string | null;
  error: string | null;
};

const active = (s: string) => s === "queued" || s === "running";

/**
 * Drives a batch job from the browser: calls /step repeatedly and shows a
 * progress bar. A stopped job can be resumed from where it left off.
 */
export function JobRunner({ initial, label }: { initial: JobView; label: string }) {
  const [job, setJob] = useState(initial);
  const jobRef = useRef(initial);
  const running = useRef(false);
  const router = useRouter();

  function update(next: JobView) {
    jobRef.current = next;
    setJob(next);
  }

  async function loop() {
    if (running.current) return;
    running.current = true;
    try {
      while (active(jobRef.current.status)) {
        const res = await fetch(`/api/jobs/${jobRef.current.id}/step`, { method: "POST" });
        const body = await res.json().catch(() => ({}));
        if (!active(jobRef.current.status)) break; // cancelled meanwhile
        update(res.ok ? body : { ...jobRef.current, status: "failed", error: body.error ?? "Something went wrong." });
      }
      if (jobRef.current.status === "done") router.refresh();
    } catch {
      update({ ...jobRef.current, status: "failed", error: "Lost connection. Check your internet and press Resume." });
    } finally {
      running.current = false;
    }
  }

  useEffect(() => {
    if (active(initial.status)) void loop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function resume() {
    await fetch(`/api/jobs/${job.id}/resume`, { method: "POST" });
    update({ ...jobRef.current, status: "running", error: null });
    void loop();
  }

  async function cancel() {
    update({ ...jobRef.current, status: "cancelled" });
    await fetch(`/api/jobs/${job.id}/cancel`, { method: "POST" });
    router.refresh();
  }

  const pct = job.total > 0 ? Math.min(100, Math.round((job.done / job.total) * 100)) : null;
  const statusText =
    job.status === "done" ? "Done"
    : job.status === "failed" ? "Stopped"
    : job.status === "cancelled" ? "Cancelled"
    : pct !== null ? `${pct}%`
    : "Starting…";

  return (
    <div className="rounded-xl border border-stone-200 bg-white p-4">
      <div className="flex items-center justify-between text-sm">
        <span className="font-medium">{label}</span>
        <span className="text-stone-500">{statusText}</span>
      </div>
      <div className="mt-2 h-2 overflow-hidden rounded-full bg-stone-100">
        <div
          className={`h-full transition-all ${job.status === "failed" ? "bg-red-400" : "bg-amber-500"} ${pct === null && active(job.status) ? "animate-pulse" : ""}`}
          style={{ width: `${job.status === "done" ? 100 : pct ?? (active(job.status) ? 33 : 0)}%` }}
        />
      </div>
      {job.message && <p className="mt-2 text-sm text-stone-600">{job.message}</p>}
      {job.error && <p className="mt-2 rounded-lg bg-red-50 p-2 text-sm text-red-700">{job.error}</p>}
      <div className="mt-3 flex gap-2">
        {job.status === "failed" && (
          <button onClick={resume} className="rounded-md bg-stone-900 px-3 py-1 text-sm text-white">
            Resume
          </button>
        )}
        {active(job.status) && (
          <button onClick={cancel} className="rounded-md border border-stone-200 px-3 py-1 text-sm">
            Cancel
          </button>
        )}
      </div>
    </div>
  );
}

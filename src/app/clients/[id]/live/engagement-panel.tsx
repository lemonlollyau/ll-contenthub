"use client";
import { useState, useTransition } from "react";
import type { EngagementPlan } from "@/lib/types";
import { planEngagement } from "./actions";

/** A short, human to-do for being present around a post once it's live. */
export function EngagementPanel({ clientId, itemId, plan: initial }: { clientId: string; itemId: string; plan: EngagementPlan | null }) {
  const [plan, setPlan] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function generate() {
    start(async () => {
      const r = await planEngagement(clientId, itemId);
      if (r.ok && r.plan) {
        setPlan(r.plan);
        setError(null);
      } else setError(r.message);
    });
  }

  if (!plan) {
    return (
      <div>
        <button type="button" onClick={generate} disabled={pending} className="rounded border border-stone-300 px-2 py-0.5 text-xs hover:bg-stone-100 disabled:opacity-50">
          {pending ? "Thinking…" : "Plan 15 minutes of engagement"}
        </button>
        {error && <p className="mt-1 text-xs text-red-700">{error}</p>}
      </div>
    );
  }

  return (
    <details className="text-xs">
      <summary className="cursor-pointer text-amber-700">Engagement plan</summary>
      <div className="mt-1 space-y-1">
        <p><b>Browse:</b> {plan.hashtags.join(" ")}</p>
        <p><b>Reply to:</b> {plan.accounts.join(" · ")}</p>
        <ul className="list-disc pl-4">
          {plan.openers.map((o) => <li key={o}>{o}</li>)}
        </ul>
        {plan.note && <p className="text-amber-800">{plan.note}</p>}
        <button type="button" onClick={generate} disabled={pending} className="text-stone-400 underline">
          {pending ? "Thinking…" : "regenerate"}
        </button>
        {error && <p className="text-red-700">{error}</p>}
      </div>
    </details>
  );
}

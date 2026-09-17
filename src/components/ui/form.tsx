"use client";
import { useActionState } from "react";
import type { ActionResult } from "@/app/clients/actions";

export const inputClass =
  "w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm focus:border-amber-500 focus:outline-none focus:ring-2 focus:ring-amber-200";

export function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-sm font-medium text-stone-700">{label}</span>
      <div className="mt-1">{children}</div>
      {hint && <span className="mt-1 block text-xs text-stone-500">{hint}</span>}
    </label>
  );
}

export function Result({ result }: { result: ActionResult }) {
  if (!result) return null;
  return (
    <p className={`rounded-lg p-2 text-sm ${result.ok ? "bg-green-50 text-green-800" : "bg-red-50 text-red-700"}`}>
      {result.message}
    </p>
  );
}

/** A form bound to a server action that returns an ActionResult. */
export function ActionForm({
  action,
  submitLabel,
  children,
  className,
}: {
  action: (prev: ActionResult, formData: FormData) => Promise<ActionResult>;
  submitLabel: string;
  children: React.ReactNode;
  className?: string;
}) {
  const [result, formAction, pending] = useActionState(action, null);
  return (
    <form action={formAction} className={className ?? "space-y-4"}>
      {children}
      <div className="flex items-center gap-3">
        <button disabled={pending} className="rounded-lg bg-stone-900 px-4 py-2 text-sm font-medium text-white hover:bg-stone-700 disabled:opacity-50">
          {pending ? "Saving…" : submitLabel}
        </button>
        <Result result={result} />
      </div>
    </form>
  );
}

/** A button that runs a server action and shows the result inline. */
export function ActionButton({ action, label }: { action: () => Promise<ActionResult>; label: string }) {
  const [result, formAction, pending] = useActionState(async () => action(), null);
  return (
    <form action={formAction} className="flex items-center gap-3">
      <button disabled={pending} className="rounded-lg border border-stone-300 bg-white px-3 py-1.5 text-sm hover:bg-stone-100 disabled:opacity-50">
        {pending ? "Checking…" : label}
      </button>
      <Result result={result} />
    </form>
  );
}

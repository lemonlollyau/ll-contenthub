"use client";
import { useState, useTransition } from "react";
import { updateItemField } from "./calendar-actions";

/** Click-to-edit table cell that saves on blur. */
export function EditableCell({
  clientId, itemId, field, value, multiline, placeholder, locked, display,
}: {
  clientId: string;
  itemId: string;
  field: string;
  value: string;
  multiline?: boolean;
  placeholder?: string;
  locked?: string;
  display?: React.ReactNode;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function save() {
    setEditing(false);
    if (draft === value) return;
    start(async () => {
      try {
        setError(null);
        await updateItemField(clientId, itemId, field, draft);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Couldn't save");
        setDraft(value);
      }
    });
  }

  if (editing) {
    const common = {
      autoFocus: true,
      value: draft,
      onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setDraft(e.target.value),
      onBlur: save,
      onKeyDown: (e: React.KeyboardEvent) => {
        if (e.key === "Escape") { setDraft(value); setEditing(false); }
        if (e.key === "Enter" && !multiline) save();
      },
      className: "w-full rounded border border-amber-400 bg-white p-1 text-xs",
    };
    return multiline ? <textarea rows={8} {...common} /> : <input {...common} />;
  }
  return (
    <div
      onClick={() => (locked ? setError(locked) : setEditing(true))}
      title={locked ?? "Click to edit"}
      className={`min-h-5 cursor-text whitespace-pre-wrap rounded px-1 hover:bg-amber-50 ${pending ? "opacity-50" : ""}`}
    >
      {display ?? (value || <span className="text-stone-300">{placeholder ?? "—"}</span>)}
      {error && <p className="mt-1 text-red-600">{error}</p>}
    </div>
  );
}

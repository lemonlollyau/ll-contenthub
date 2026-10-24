"use client";
import { useState, useTransition } from "react";
import { toggleBoost } from "./calendar-actions";

/** Flags a post for paid amplification. Nothing is spent here: it's a shortlist. */
export function BoostToggle({ clientId, itemId, boost }: { clientId: string; itemId: string; boost: boolean }) {
  const [on, setOn] = useState(boost);
  const [pending, start] = useTransition();
  return (
    <label className={`flex cursor-pointer items-center gap-1 ${pending ? "opacity-50" : ""}`} title="Shortlist this post for paid promotion">
      <input
        type="checkbox"
        checked={on}
        onChange={() => {
          const next = !on;
          setOn(next);
          start(async () => {
            try {
              await toggleBoost(clientId, itemId, next);
            } catch {
              setOn(!next);
            }
          });
        }}
      />
      <span className={on ? "text-amber-700" : "text-stone-400"}>Boost</span>
    </label>
  );
}

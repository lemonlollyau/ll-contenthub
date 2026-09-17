"use client";
import { useState } from "react";
import { inputClass } from "@/components/ui/form";
import type { PillarTimes } from "@/lib/types";

export function PillarRows({ defaults, pillars }: { defaults: PillarTimes; pillars: ({ pillar: string } & PillarTimes)[] }) {
  const [rows, setRows] = useState(pillars.length ? pillars : []);
  const cell = `${inputClass} w-24`;
  return (
    <div className="overflow-x-auto">
      <table className="text-sm">
        <thead>
          <tr className="text-left text-stone-500">
            <th className="pb-2 pr-2 font-medium">Pillar</th>
            <th className="pb-2 pr-2 font-medium">Weekday</th>
            <th className="pb-2 pr-2 font-medium">Weekend</th>
            <th className="pb-2 pr-2 font-medium">Evening / PM</th>
            <th />
          </tr>
        </thead>
        <tbody>
          <tr>
            <td className="py-1 pr-2 text-stone-600">Any other pillar</td>
            <td className="py-1 pr-2"><input name="d_weekday" defaultValue={defaults.weekday} className={cell} /></td>
            <td className="py-1 pr-2"><input name="d_weekend" defaultValue={defaults.weekend} className={cell} /></td>
            <td className="py-1 pr-2"><input name="d_evening" defaultValue={defaults.evening} className={cell} /></td>
            <td />
          </tr>
          {rows.map((r, i) => (
            <tr key={i}>
              <td className="py-1 pr-2"><input name="pillar" defaultValue={r.pillar} placeholder="e.g. Education" className={inputClass} /></td>
              <td className="py-1 pr-2"><input name="p_weekday" defaultValue={r.weekday} className={cell} /></td>
              <td className="py-1 pr-2"><input name="p_weekend" defaultValue={r.weekend} className={cell} /></td>
              <td className="py-1 pr-2"><input name="p_evening" defaultValue={r.evening} className={cell} /></td>
              <td>
                <button type="button" onClick={() => setRows(rows.filter((_, j) => j !== i))} className="text-stone-400 hover:text-red-600">
                  Remove
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <button
        type="button"
        onClick={() => setRows([...rows, { pillar: "", ...defaults }])}
        className="mt-2 text-sm text-amber-700 hover:underline"
      >
        + Add pillar
      </button>
    </div>
  );
}

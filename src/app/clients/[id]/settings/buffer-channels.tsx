"use client";
import { useState, useTransition } from "react";
import type { BufferApiChannel } from "@/lib/buffer";
import type { BufferChannel } from "@/lib/types";
import { fetchBufferChannels, saveBufferChannels, type ActionResult } from "../../actions";
import { Result, inputClass } from "@/components/ui/form";

const PLATFORMS = ["instagram", "facebook", "linkedin", "tiktok", "pinterest", "threads", "googlebusiness", "twitter", "youtube"];

/** Test the Buffer key, list its channels, and map calendar platforms to them. */
export function BufferChannels({ clientId, saved }: { clientId: string; saved: BufferChannel[] }) {
  const [channels, setChannels] = useState<(BufferApiChannel & { orgName: string })[] | null>(null);
  const [map, setMap] = useState<Record<string, string>>(Object.fromEntries(saved.map((c) => [c.platform, c.channelId])));
  const [result, setResult] = useState<ActionResult>(null);
  const [pending, start] = useTransition();

  function load() {
    start(async () => {
      const r = await fetchBufferChannels(clientId);
      if (!r.ok) return setResult({ ok: false, message: r.message });
      const all = r.orgs.flatMap((o) => o.channels.map((c) => ({ ...c, orgName: o.name })));
      setChannels(all);
      setResult({ ok: true, message: `Connected. Found ${all.length} channel(s) in ${r.orgs.map((o) => o.name).join(", ")}.` });
      // Pre-fill obvious matches for unmapped platforms.
      setMap((m) => {
        const next = { ...m };
        for (const p of PLATFORMS) {
          const options = all.filter((c) => c.service === p);
          if (!next[p] && options.length === 1) next[p] = options[0].id;
        }
        return next;
      });
    });
  }

  function save() {
    const list: BufferChannel[] = Object.entries(map)
      .filter(([, id]) => id)
      .map(([platform, id]) => {
        const c = channels?.find((x) => x.id === id);
        const prev = saved.find((s) => s.channelId === id);
        return { platform, channelId: id, channelName: c ? `${c.displayName ?? c.name} (${c.service})` : prev?.channelName ?? id };
      });
    start(async () => setResult(await saveBufferChannels(clientId, list)));
  }

  const warnings = (channels ?? []).filter((c) => Object.values(map).includes(c.id) && (c.isDisconnected || c.isLocked || c.isQueuePaused));

  return (
    <div className="space-y-3 text-sm">
      <div className="flex items-center gap-3">
        <button onClick={load} disabled={pending} className="rounded-lg border border-stone-300 bg-white px-3 py-1.5 hover:bg-stone-100 disabled:opacity-50">
          {pending && !channels ? "Connecting…" : "Test Buffer & load channels"}
        </button>
        <Result result={result} />
      </div>
      {!channels && saved.length > 0 && (
        <ul className="list-disc pl-5 text-stone-600">
          {saved.map((c) => <li key={c.channelId}>{c.platform} → {c.channelName}</li>)}
        </ul>
      )}
      {channels && (
        <>
          <div className="grid gap-2">
            {PLATFORMS.filter((p) => channels.some((c) => c.service === p) || map[p]).map((p) => (
              <label key={p} className="flex items-center gap-3">
                <span className="w-32 capitalize">{p} →</span>
                <select value={map[p] ?? ""} onChange={(e) => setMap({ ...map, [p]: e.target.value })} className={inputClass}>
                  <option value="">Not used</option>
                  {channels.filter((c) => c.service === p).map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.displayName ?? c.name} · {c.orgName}{c.timezone ? ` · ${c.timezone}` : ""}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>
          {warnings.map((c) => (
            <p key={c.id} className="rounded bg-amber-50 p-2 text-amber-800">
              {c.displayName ?? c.name}: {c.isDisconnected ? "disconnected in Buffer, so reconnect it there. " : ""}{c.isLocked ? "locked (plan limit). " : ""}{c.isQueuePaused ? "queue is paused." : ""}
            </p>
          ))}
          <button onClick={save} disabled={pending} className="rounded-lg bg-stone-900 px-4 py-2 text-white disabled:opacity-50">Save channel mapping</button>
        </>
      )}
    </div>
  );
}

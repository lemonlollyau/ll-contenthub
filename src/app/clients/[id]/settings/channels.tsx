"use client";
import Link from "next/link";
import { useState, useTransition } from "react";
import type { ChannelMapping } from "@/lib/types";
import { fetchAllChannels, saveChannels, type ActionResult, type ConnectionChannels } from "../../actions";
import { Result, inputClass } from "@/components/ui/form";

const PLATFORMS = ["instagram", "facebook", "linkedin", "tiktok", "pinterest", "threads", "googlebusiness", "twitter", "youtube"];

/**
 * Maps each platform to a channel in whichever connection holds it, so one
 * client can publish through several accounts and both providers at once.
 */
export function Channels({ clientId, saved }: { clientId: string; saved: ChannelMapping[] }) {
  const [sources, setSources] = useState<ConnectionChannels[] | null>(null);
  const [map, setMap] = useState<Record<string, string>>(
    Object.fromEntries(saved.map((c) => [c.platform, `${c.connectionId}|${c.channelId}`])),
  );
  const [result, setResult] = useState<ActionResult>(null);
  const [pending, start] = useTransition();

  function load() {
    start(async () => {
      const all = await fetchAllChannels();
      setSources(all);
      const failed = all.filter((a) => a.error);
      setResult(
        failed.length
          ? { ok: false, message: `${failed.map((f) => `${f.connectionName}: ${f.error}`).join(" · ")}` }
          : { ok: true, message: `Loaded ${all.reduce((n, a) => n + a.channels.length, 0)} channel(s) from ${all.length} connection(s).` },
      );
      // Fill in any platform that only exists in one place.
      setMap((m) => {
        const next = { ...m };
        for (const p of PLATFORMS) {
          const options = all.flatMap((a) => a.channels.filter((c) => c.platform === p).map((c) => `${a.connectionId}|${c.channelId}`));
          if (!next[p] && options.length === 1) next[p] = options[0];
        }
        return next;
      });
    });
  }

  function save() {
    const list: ChannelMapping[] = Object.entries(map)
      .filter(([, v]) => v)
      .map(([platform, value]) => {
        const [connectionId, channelId] = value.split("|");
        const source = sources?.find((s) => s.connectionId === connectionId);
        const channel = source?.channels.find((c) => c.channelId === channelId);
        const prev = saved.find((s) => s.channelId === channelId);
        return {
          platform,
          channelId,
          connectionId,
          channelName: channel ? `${channel.channelName}${source ? ` (${source.connectionName})` : ""}` : prev?.channelName ?? channelId,
        };
      });
    start(async () => setResult(await saveChannels(clientId, list)));
  }

  const options = (platform: string) =>
    (sources ?? []).flatMap((s) =>
      s.channels
        .filter((c) => c.platform === platform)
        .map((c) => ({ value: `${s.connectionId}|${c.channelId}`, label: `${c.channelName} — ${s.connectionName}${c.note ? ` (${c.note})` : ""}` })),
    );

  return (
    <div className="space-y-3 text-sm">
      <div className="flex flex-wrap items-center gap-3">
        <button onClick={load} disabled={pending} className="rounded-lg border border-stone-300 bg-white px-3 py-1.5 hover:bg-stone-100 disabled:opacity-50">
          {pending && !sources ? "Loading…" : "Load channels from all connections"}
        </button>
        <Link href="/connections" className="text-amber-700 underline">Manage connections</Link>
        <Result result={result} />
      </div>

      {!sources && saved.length > 0 && (
        <ul className="list-disc pl-5 text-stone-600">
          {saved.map((c) => <li key={c.channelId}>{c.platform} → {c.channelName}</li>)}
        </ul>
      )}
      {!sources && saved.length === 0 && <p className="text-stone-500">No channels mapped yet.</p>}

      {sources && (
        <>
          <div className="grid gap-2">
            {PLATFORMS.filter((p) => options(p).length || map[p]).map((p) => (
              <label key={p} className="flex items-center gap-3">
                <span className="w-32 capitalize">{p} →</span>
                <select value={map[p] ?? ""} onChange={(e) => setMap({ ...map, [p]: e.target.value })} className={inputClass}>
                  <option value="">Not used</option>
                  {options(p).map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </label>
            ))}
          </div>
          <button onClick={save} disabled={pending} className="rounded-lg bg-stone-900 px-4 py-2 text-white disabled:opacity-50">
            Save channels
          </button>
        </>
      )}
    </div>
  );
}

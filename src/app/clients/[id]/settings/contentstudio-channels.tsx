"use client";
import { useState, useTransition } from "react";
import type { ChannelMapping } from "@/lib/types";
import { fetchContentStudio, saveContentStudioChannels, type ActionResult } from "../../actions";
import { Result, inputClass } from "@/components/ui/form";

const PLATFORMS = ["instagram", "facebook", "linkedin", "tiktok", "pinterest", "threads", "googlebusiness", "twitter", "youtube"];

type Workspace = { id: string; name: string; timezone?: string; channels: ChannelMapping[] };

/** Test the ContentStudio key, pick the workspace, and map calendar platforms to its accounts. */
export function ContentStudioChannels({
  clientId, saved, savedWorkspaceId, savedWorkspaceTz, clientTz,
}: {
  clientId: string;
  saved: ChannelMapping[];
  savedWorkspaceId: string | null;
  savedWorkspaceTz: string | null;
  clientTz: string;
}) {
  const [workspaces, setWorkspaces] = useState<Workspace[] | null>(null);
  const [workspaceId, setWorkspaceId] = useState(savedWorkspaceId ?? "");
  const [map, setMap] = useState<Record<string, string>>(Object.fromEntries(saved.map((c) => [c.platform, c.channelId])));
  const [result, setResult] = useState<ActionResult>(null);
  const [pending, start] = useTransition();

  const workspace = workspaces?.find((w) => w.id === workspaceId);

  function load() {
    start(async () => {
      const r = await fetchContentStudio(clientId);
      if (!r.ok) return setResult({ ok: false, message: r.message });
      setWorkspaces(r.workspaces);
      const chosen = r.workspaces.find((w) => w.id === workspaceId) ?? (r.workspaces.length === 1 ? r.workspaces[0] : undefined);
      if (chosen) setWorkspaceId(chosen.id);
      setResult({
        ok: true,
        message: `Connected. Found ${r.workspaces.length} workspace(s): ${r.workspaces.map((w) => w.name).join(", ")}.`,
      });
      if (chosen) prefill(chosen);
    });
  }

  function prefill(w: Workspace) {
    setMap((m) => {
      const next = { ...m };
      for (const p of PLATFORMS) {
        const options = w.channels.filter((c) => c.platform === p);
        if (!next[p] && options.length === 1) next[p] = options[0].channelId;
      }
      return next;
    });
  }

  function save() {
    if (!workspace && !savedWorkspaceId) return setResult({ ok: false, message: "Load the workspaces first." });
    const list: ChannelMapping[] = Object.entries(map)
      .filter(([, id]) => id)
      .map(([platform, id]) => {
        const c = workspace?.channels.find((x) => x.channelId === id);
        const prev = saved.find((s) => s.channelId === id);
        return { platform, channelId: id, channelName: c?.channelName ?? prev?.channelName ?? id };
      });
    start(async () =>
      setResult(await saveContentStudioChannels(clientId, workspaceId || savedWorkspaceId!, workspace?.timezone ?? savedWorkspaceTz, list)),
    );
  }

  const tz = workspace?.timezone ?? savedWorkspaceTz;
  const tzMismatch = tz && tz !== clientTz;

  return (
    <div className="space-y-3 text-sm">
      <div className="flex items-center gap-3">
        <button onClick={load} disabled={pending} className="rounded-lg border border-stone-300 bg-white px-3 py-1.5 hover:bg-stone-100 disabled:opacity-50">
          {pending && !workspaces ? "Connecting…" : "Test ContentStudio & load channels"}
        </button>
        <Result result={result} />
      </div>

      {!workspaces && saved.length > 0 && (
        <ul className="list-disc pl-5 text-stone-600">
          {saved.map((c) => <li key={c.channelId}>{c.platform} → {c.channelName}</li>)}
        </ul>
      )}

      {workspaces && (
        <>
          <label className="flex items-center gap-3">
            <span className="w-32">Workspace</span>
            <select
              value={workspaceId}
              onChange={(e) => {
                setWorkspaceId(e.target.value);
                const w = workspaces.find((x) => x.id === e.target.value);
                if (w) prefill(w);
              }}
              className={inputClass}
            >
              <option value="">Choose…</option>
              {workspaces.map((w) => (
                <option key={w.id} value={w.id}>{w.name}{w.timezone ? ` · ${w.timezone}` : ""}</option>
              ))}
            </select>
          </label>

          {workspace && (
            <div className="grid gap-2">
              {PLATFORMS.filter((p) => workspace.channels.some((c) => c.platform === p) || map[p]).map((p) => (
                <label key={p} className="flex items-center gap-3">
                  <span className="w-32 capitalize">{p} →</span>
                  <select value={map[p] ?? ""} onChange={(e) => setMap({ ...map, [p]: e.target.value })} className={inputClass}>
                    <option value="">Not used</option>
                    {workspace.channels.filter((c) => c.platform === p).map((c) => (
                      <option key={c.channelId} value={c.channelId}>{c.channelName}</option>
                    ))}
                  </select>
                </label>
              ))}
              {workspace.channels.length === 0 && (
                <p className="rounded bg-amber-50 p-2 text-amber-800">
                  That workspace has no connected social accounts. Connect them in ContentStudio first.
                </p>
              )}
            </div>
          )}

          {tzMismatch && (
            <p className="rounded bg-amber-50 p-2 text-amber-800">
              This ContentStudio workspace is set to {tz}, but the client is {clientTz}. Posting times are converted, so
              they&apos;ll still land at the right local moment, but the times shown in ContentStudio will be {tz}.
            </p>
          )}

          <button onClick={save} disabled={pending} className="rounded-lg bg-stone-900 px-4 py-2 text-white disabled:opacity-50">
            Save workspace &amp; channels
          </button>
        </>
      )}
    </div>
  );
}

"use client";
import { useState, useTransition } from "react";
import type { ContentItem } from "@/lib/types";
import type { Crop } from "@/lib/render";
import { approveItem, swapAssets, unapproveItem } from "./actions";
import { LibraryPicker } from "./library-picker";
import { CropTool } from "./crop-tool";

export type MatchView = {
  id: string;
  asset_id: string | null;
  position: number;
  confidence: number | null;
  reason: string | null;
  method: string;
  state: string;
  crop: Crop | null;
  asset: { id: string; name: string; kind: string; width: number | null; height: number | null; ai_description: string | null } | null;
  thumb: string | null;
  renderedUrl: string | null;
  renderWarnings: string[];
};

const aspect = (format: string | null) => (format === "story" || format === "reel" ? 9 / 16 : format === "square" ? 1 : 4 / 5);

export function ReviewCard({ clientId, item, matches, folders }: { clientId: string; item: ContentItem; matches: MatchView[]; folders: string[] }) {
  const [picking, setPicking] = useState(false);
  const [cropping, setCropping] = useState<MatchView | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const withAsset = matches.filter((m) => m.asset_id);
  const decided = matches.some((m) => m.state === "approved" || m.state === "swapped");
  const noneFound = matches.length > 0 && withAsset.length === 0;
  const conf = withAsset.length ? Math.min(...withAsset.map((m) => Number(m.confidence ?? 1))) : null;
  const reason = matches[0]?.reason;

  const run = (fn: () => Promise<unknown>) =>
    start(async () => {
      setError(null);
      try { await fn(); } catch (e) { setError(e instanceof Error ? e.message : "Something went wrong"); }
    });

  return (
    <div className={`rounded-2xl border bg-white p-4 ${decided ? "border-green-200" : noneFound ? "border-red-200" : "border-stone-200"}`}>
      <div className="flex flex-col gap-4 md:flex-row">
        <div className="flex shrink-0 gap-2 overflow-x-auto md:w-[420px]">
          {withAsset.length === 0 && (
            <div className="flex h-40 w-32 items-center justify-center rounded-lg bg-stone-100 p-2 text-center text-xs text-stone-500">
              {matches.length ? "No suitable asset" : "Not matched yet"}
            </div>
          )}
          {withAsset.map((m) => (
            <div key={m.id} className="w-32 shrink-0">
              <div className="relative overflow-hidden rounded-lg bg-stone-100" style={{ aspectRatio: aspect(item.format) }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {(m.renderedUrl ?? m.thumb) && <img src={m.renderedUrl && m.asset?.kind !== "video" ? m.renderedUrl : m.thumb!} alt={m.asset?.ai_description ?? ""} className="h-full w-full object-cover" />}
                {m.asset?.kind === "video" && <span className="absolute left-1 top-1 rounded bg-black/60 px-1 text-[10px] text-white">▶ video</span>}
                {withAsset.length > 1 && <span className="absolute right-1 top-1 rounded bg-white/80 px-1 text-[10px]">{m.position + 1}</span>}
              </div>
              <p className="mt-1 truncate text-[11px] text-stone-500" title={m.asset?.name}>{m.asset?.name}</p>
              {m.renderWarnings.map((w) => <p key={w} className="text-[10px] text-amber-700">{w}</p>)}
              {decided && m.asset?.kind === "image" && (
                <button onClick={() => setCropping(m)} className="text-[11px] text-amber-700 hover:underline">
                  {m.crop ? "Edit crop" : "Adjust crop"}
                </button>
              )}
            </div>
          ))}
        </div>

        <div className="min-w-0 flex-1 text-sm">
          <div className="flex flex-wrap items-center gap-2 text-xs text-stone-500">
            <span className="font-semibold text-stone-800">#{item.row_number}</span>
            <span>{item.post_date}</span>
            <span>{item.channels.join(" + ")}</span>
            <span className="rounded bg-stone-100 px-1.5">{item.format ?? "feed"}</span>
            {item.pillar && <span>{item.pillar}</span>}
            {conf !== null && (
              <span className={`rounded px-1.5 font-medium ${conf >= 0.8 ? "bg-green-100 text-green-800" : conf >= 0.5 ? "bg-amber-100 text-amber-800" : "bg-red-100 text-red-700"}`}>
                {Math.round(conf * 100)}%
              </span>
            )}
            {decided && <span className="rounded bg-green-600 px-1.5 text-white">approved</span>}
          </div>
          {item.hook && <p className="mt-1 font-medium">{item.hook}</p>}
          <p className={`mt-1 whitespace-pre-wrap text-stone-600 ${expanded ? "" : "line-clamp-3"}`} onClick={() => setExpanded(!expanded)}>
            {item.caption}
          </p>
          {item.asset_brief && <p className="mt-1 text-xs text-stone-500"><b>Brief:</b> {item.asset_brief}{item.asset_group ? ` · folder: ${item.asset_group}` : ""}</p>}
          {reason && <p className="mt-2 text-xs italic text-stone-600">↳ {reason}</p>}
          {error && <p className="mt-2 rounded bg-red-50 p-2 text-xs text-red-700">{error}</p>}
          <div className={`mt-3 flex flex-wrap gap-2 ${pending ? "opacity-50" : ""}`}>
            {!decided && withAsset.length > 0 && (
              <button onClick={() => run(() => approveItem(clientId, item.id))} className="rounded-lg bg-green-600 px-3 py-1 text-white hover:bg-green-700">
                Approve
              </button>
            )}
            <button onClick={() => setPicking(true)} className="rounded-lg border border-stone-300 px-3 py-1 hover:bg-stone-100">
              {withAsset.length ? "Swap" : "Choose image"}
            </button>
            {decided && matches.some((m) => m.state === "approved" && m.method !== "manual") && (
              <button onClick={() => run(() => unapproveItem(clientId, item.id))} className="px-2 py-1 text-stone-500 hover:underline">Undo</button>
            )}
            {!noneFound && (
              <button onClick={() => run(() => swapAssets(clientId, item.id, []))} className="px-2 py-1 text-stone-500 hover:underline">No image</button>
            )}
          </div>
        </div>
      </div>
      {picking && (
        <LibraryPicker
          clientId={clientId}
          folders={folders}
          multiple={item.format === "carousel"}
          initial={withAsset.map((m) => ({ id: m.asset_id!, name: m.asset?.name ?? "", thumb: m.thumb }))}
          defaultFolder={folders.find((f) => item.asset_group && f.toLowerCase().endsWith(item.asset_group.toLowerCase())) ?? ""}
          onClose={() => setPicking(false)}
          onPick={(ids) => { setPicking(false); run(() => swapAssets(clientId, item.id, ids)); }}
        />
      )}
      {cropping && cropping.asset && (
        <CropTool clientId={clientId} match={cropping} aspect={aspect(item.format)} onClose={() => setCropping(null)} />
      )}
    </div>
  );
}

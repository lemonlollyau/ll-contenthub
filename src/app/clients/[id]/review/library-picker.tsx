"use client";
import { useEffect, useState, useTransition } from "react";
import { searchLibrary, type PickerAsset } from "./actions";
import { inputClass } from "@/components/ui/form";

type Picked = { id: string; name: string; thumb: string | null };

/** Modal for choosing images from the client's Drive library. Carousels keep an ordered selection. */
export function LibraryPicker({
  clientId, folders, multiple, initial, defaultFolder, onClose, onPick,
}: {
  clientId: string;
  folders: string[];
  multiple: boolean;
  initial: Picked[];
  defaultFolder: string;
  onClose: () => void;
  onPick: (ids: string[]) => void;
}) {
  const [q, setQ] = useState("");
  const [folder, setFolder] = useState(defaultFolder);
  const [page, setPage] = useState(0);
  const [results, setResults] = useState<PickerAsset[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [selected, setSelected] = useState<Picked[]>(multiple ? initial : []);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  useEffect(() => {
    const t = setTimeout(() => {
      start(async () => {
        try {
          const r = await searchLibrary(clientId, q, folder, page);
          setResults(r.assets);
          setHasMore(r.hasMore);
          setError(null);
        } catch (e) {
          setError(e instanceof Error ? e.message : "Search failed");
        }
      });
    }, 250);
    return () => clearTimeout(t);
  }, [clientId, q, folder, page]);

  function toggle(a: PickerAsset) {
    if (!multiple) return onPick([a.id]);
    setSelected((s) => (s.some((x) => x.id === a.id) ? s.filter((x) => x.id !== a.id) : [...s, { id: a.id, name: a.name, thumb: a.thumb }]));
  }
  function move(i: number, d: -1 | 1) {
    setSelected((s) => {
      const n = [...s];
      const j = i + d;
      if (j < 0 || j >= n.length) return s;
      [n[i], n[j]] = [n[j], n[i]];
      return n;
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="flex max-h-[90vh] w-full max-w-5xl flex-col rounded-2xl bg-white p-5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2">
          <h3 className="font-semibold">{multiple ? "Choose carousel images (in order)" : "Choose an image"}</h3>
          <button onClick={onClose} className="ml-auto text-stone-500 hover:text-stone-900">Close</button>
        </div>
        <div className="mt-3 flex gap-2">
          <input value={q} onChange={(e) => { setQ(e.target.value); setPage(0); }} placeholder="Search descriptions, tags, file names…" className={inputClass} autoFocus />
          <select value={folder} onChange={(e) => { setFolder(e.target.value); setPage(0); }} className={`${inputClass} max-w-xs`}>
            <option value="">All folders</option>
            {folders.map((f) => <option key={f} value={f}>{f || "(top folder)"}</option>)}
          </select>
        </div>
        {multiple && (
          <div className="mt-3 flex min-h-20 gap-2 overflow-x-auto rounded-lg bg-stone-50 p-2">
            {selected.length === 0 && <p className="self-center text-sm text-stone-400">Click images below to add them.</p>}
            {selected.map((s, i) => (
              <div key={s.id} className="w-20 shrink-0 text-center text-[10px]">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {s.thumb ? <img src={s.thumb} alt="" className="h-16 w-20 rounded object-cover" /> : <div className="h-16 rounded bg-stone-200" />}
                <div className="flex justify-center gap-1">
                  <button onClick={() => move(i, -1)}>◀</button>
                  <span>{i + 1}</span>
                  <button onClick={() => move(i, 1)}>▶</button>
                  <button onClick={() => setSelected(selected.filter((x) => x.id !== s.id))} className="text-red-600">✕</button>
                </div>
              </div>
            ))}
          </div>
        )}
        {error && <p className="mt-2 text-sm text-red-700">{error}</p>}
        <div className={`mt-3 grid flex-1 grid-cols-3 gap-2 overflow-y-auto sm:grid-cols-4 md:grid-cols-6 ${pending ? "opacity-60" : ""}`}>
          {results.map((a) => {
            const idx = selected.findIndex((s) => s.id === a.id);
            return (
              <button key={a.id} onClick={() => toggle(a)} className={`rounded-lg border-2 p-1 text-left ${idx >= 0 ? "border-amber-500" : "border-transparent hover:border-stone-300"}`} title={a.ai_description ?? a.name}>
                <div className="relative aspect-square overflow-hidden rounded bg-stone-100">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  {a.thumb ? <img src={a.thumb} alt="" className="h-full w-full object-cover" /> : <span className="p-1 text-[10px] text-stone-400">not tagged</span>}
                  {a.kind === "video" && <span className="absolute left-1 top-1 rounded bg-black/60 px-1 text-[10px] text-white">▶</span>}
                  {idx >= 0 && <span className="absolute right-1 top-1 rounded-full bg-amber-500 px-1.5 text-[10px] text-white">{idx + 1}</span>}
                </div>
                <p className="mt-0.5 truncate text-[10px] text-stone-500">{a.name}</p>
              </button>
            );
          })}
          {!pending && results.length === 0 && <p className="col-span-full py-8 text-center text-sm text-stone-400">No matching images.</p>}
        </div>
        <div className="mt-3 flex items-center gap-2 text-sm">
          {page > 0 && <button onClick={() => setPage(page - 1)} className="rounded border px-2 py-1">Previous</button>}
          {hasMore && <button onClick={() => setPage(page + 1)} className="rounded border px-2 py-1">More</button>}
          {multiple && (
            <button disabled={!selected.length} onClick={() => onPick(selected.map((s) => s.id))} className="ml-auto rounded-lg bg-stone-900 px-4 py-1.5 text-white disabled:opacity-40">
              Use {selected.length} image{selected.length === 1 ? "" : "s"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

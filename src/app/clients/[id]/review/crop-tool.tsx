"use client";
import { useEffect, useRef, useState, useTransition } from "react";
import type { Crop } from "@/lib/render";
import { cropSource, saveCrop } from "./actions";
import type { MatchView } from "./review-card";

/**
 * Drag a fixed-ratio box over the image to set the crop. Coordinates are
 * converted from the preview's size to the original image's pixels.
 */
export function CropTool({ clientId, match, aspect, onClose }: { clientId: string; match: MatchView; aspect: number; onClose: () => void }) {
  const [src, setSrc] = useState<{ url: string | null; width: number | null; height: number | null } | null>(null);
  const [box, setBox] = useState({ x: 0, y: 0, w: 0 }); // preview px; height = w / aspect
  const [shown, setShown] = useState({ w: 0, h: 0 });
  const [message, setMessage] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const drag = useRef<{ mode: "move" | "resize"; sx: number; sy: number; box: typeof box } | null>(null);

  useEffect(() => {
    cropSource(clientId, match.asset!.id).then(setSrc).catch(() => setMessage("Couldn't load the preview."));
  }, [clientId, match]);

  function onLoad(e: React.SyntheticEvent<HTMLImageElement>) {
    const w = e.currentTarget.clientWidth;
    const h = e.currentTarget.clientHeight;
    setShown({ w, h });
    const scale = src?.width ? w / src.width : 1;
    if (match.crop) {
      setBox({ x: match.crop.left * scale, y: match.crop.top * scale, w: match.crop.width * scale });
    } else {
      const bw = Math.min(w, h * aspect);
      setBox({ x: (w - bw) / 2, y: (h - bw / aspect) / 2, w: bw });
    }
  }

  function clamp(b: typeof box) {
    const w = Math.max(40, Math.min(b.w, shown.w, shown.h * aspect));
    const h = w / aspect;
    return { w, x: Math.max(0, Math.min(b.x, shown.w - w)), y: Math.max(0, Math.min(b.y, shown.h - h)) };
  }

  function onPointerMove(e: React.PointerEvent) {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.sx;
    const dy = e.clientY - d.sy;
    setBox(clamp(d.mode === "move" ? { ...d.box, x: d.box.x + dx, y: d.box.y + dy } : { ...d.box, w: d.box.w + dx }));
  }

  function save(reset: boolean) {
    const scale = src?.width && shown.w ? src.width / shown.w : 1;
    const crop: Crop | null = reset
      ? null
      : { left: box.x * scale, top: box.y * scale, width: box.w * scale, height: (box.w / aspect) * scale };
    start(async () => {
      const r = await saveCrop(clientId, match.id, crop);
      setMessage(r.message);
      if (r.ok) setTimeout(onClose, 600);
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="max-w-3xl rounded-2xl bg-white p-5" onClick={(e) => e.stopPropagation()}>
        <h3 className="font-semibold">Adjust crop: {match.asset?.name}</h3>
        <p className="text-xs text-stone-500">Drag the box to move it; drag the corner handle to resize.</p>
        {!src?.url ? (
          <p className="py-10 text-center text-sm text-stone-500">{message ?? "Loading…"}</p>
        ) : !src.width ? (
          <p className="py-10 text-center text-sm text-stone-500">This image&apos;s size is unknown. Re-sync the library first.</p>
        ) : (
          <div className="relative mt-3 select-none" onPointerMove={onPointerMove} onPointerUp={() => (drag.current = null)} onPointerLeave={() => (drag.current = null)}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={src.url} alt="" onLoad={onLoad} className="max-h-[60vh] max-w-full" draggable={false} />
            {shown.w > 0 && (
              <div
                className="absolute cursor-move border-2 border-amber-400 shadow-[0_0_0_9999px_rgba(0,0,0,0.45)]"
                style={{ left: box.x, top: box.y, width: box.w, height: box.w / aspect }}
                onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); drag.current = { mode: "move", sx: e.clientX, sy: e.clientY, box }; }}
              >
                <div
                  className="absolute -bottom-2 -right-2 h-4 w-4 cursor-nwse-resize rounded-full bg-amber-400"
                  onPointerDown={(e) => { e.stopPropagation(); e.currentTarget.setPointerCapture(e.pointerId); drag.current = { mode: "resize", sx: e.clientX, sy: e.clientY, box }; }}
                />
              </div>
            )}
          </div>
        )}
        {message && <p className="mt-2 text-sm text-stone-700">{message}</p>}
        <div className="mt-4 flex gap-2">
          <button disabled={pending || !shown.w} onClick={() => save(false)} className="rounded-lg bg-stone-900 px-4 py-1.5 text-sm text-white disabled:opacity-40">
            {pending ? "Saving…" : "Save crop"}
          </button>
          <button disabled={pending} onClick={() => save(true)} className="rounded-lg border px-3 py-1.5 text-sm">Use smart crop</button>
          <button onClick={onClose} className="ml-auto text-sm text-stone-500">Cancel</button>
        </div>
      </div>
    </div>
  );
}

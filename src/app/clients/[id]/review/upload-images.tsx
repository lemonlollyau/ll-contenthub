"use client";
import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createBrowserAuthClient } from "@/lib/supabase/browser";
import type { CustomMedia } from "@/lib/types";
import { attachUploads, createUploadTickets, removeUpload } from "./upload-actions";

/**
 * Pictures that didn't come from Drive. The file goes straight from the
 * browser into storage with a one-off signed URL, so large phone photos
 * aren't limited by the server's request size.
 */
export function UploadImages({
  clientId, itemId, media, onChange,
}: {
  clientId: string;
  itemId: string;
  media: CustomMedia[];
  onChange?: (media: CustomMedia[]) => void;
}) {
  const [items, setItems] = useState(media);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const input = useRef<HTMLInputElement>(null);
  const router = useRouter();

  async function upload(files: FileList) {
    const list = Array.from(files);
    if (!list.length) return;
    setError(null);
    setStatus(`Uploading ${list.length} file${list.length === 1 ? "" : "s"}…`);
    try {
      const tickets = await createUploadTickets(clientId, list.map((f) => f.name));
      const supabase = createBrowserAuthClient();
      const done: { path: string; name: string }[] = [];
      for (const [i, file] of list.entries()) {
        const ticket = tickets[i];
        const { error: upErr } = await supabase.storage.from("imports").uploadToSignedUrl(ticket.path, ticket.token, file);
        if (upErr) throw new Error(`${file.name}: ${upErr.message}`);
        done.push({ path: ticket.path, name: file.name });
        setStatus(`Uploaded ${i + 1} of ${list.length}…`);
      }
      setStatus("Preparing…");
      start(async () => {
        const r = await attachUploads(clientId, itemId, done, false);
        setStatus(null);
        if (!r.ok) return setError(r.message);
        setItems(r.media ?? []);
        onChange?.(r.media ?? []);
        router.refresh();
      });
    } catch (e) {
      setStatus(null);
      setError(e instanceof Error ? e.message : "Upload failed");
    }
  }

  function remove(url: string) {
    start(async () => {
      const r = await removeUpload(clientId, itemId, url);
      if (!r.ok) return setError(r.message);
      setItems(r.media ?? []);
      onChange?.(r.media ?? []);
      router.refresh();
    });
  }

  return (
    <div className="text-xs">
      <input
        ref={input}
        type="file"
        accept="image/*,video/mp4,video/quicktime,.heic,.heif"
        multiple
        hidden
        onChange={(e) => e.target.files && upload(e.target.files)}
      />
      <button
        type="button"
        onClick={() => input.current?.click()}
        disabled={pending}
        className="rounded-lg border border-stone-300 px-2 py-1 hover:bg-stone-100 disabled:opacity-50"
      >
        Upload from computer
      </button>
      {status && <span className="ml-2 text-stone-500">{status}</span>}
      {error && <p className="mt-1 rounded bg-red-50 p-1 text-red-700">{error}</p>}
      {items.length > 0 && (
        <div className="mt-2">
          <p className="text-stone-500">Using your uploads instead of the matched imagery:</p>
          <div className="mt-1 flex flex-wrap gap-2">
            {items.map((m, i) => (
              <div key={m.url} className="w-20">
                <div className="relative">
                  {m.kind === "video" ? (
                    <div className="flex h-20 items-center justify-center rounded bg-stone-800 text-white">▶</div>
                  ) : (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={m.url} alt="" className="h-20 w-20 rounded object-cover" />
                  )}
                  <span className="absolute left-0 top-0 rounded bg-white/80 px-1">{i + 1}</span>
                </div>
                <button type="button" onClick={() => remove(m.url)} className="text-red-600 hover:underline">
                  remove
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

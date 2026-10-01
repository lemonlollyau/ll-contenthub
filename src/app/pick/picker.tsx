"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type Post = {
  id: string;
  row: number | null;
  date: string | null;
  time: string | null;
  channels: string[];
  format: string | null;
  pillar: string | null;
  hook: string | null;
  caption: string | null;
  assetBrief: string | null;
  moment: string | null;
  inBuffer: string[];
};
type Asset = { id: string; name: string; folder: string; thumb: string | null; description: string | null };
type Pick = { id: string; postId: string | null; label: string; note: string; thumb: string | null; kind: "drive" | "upload" };
type Folder = { path: string; count: number };
type Local = { key: string; file: File; url: string };

const ALL = "*";

type ClientData = { posts: Post[]; folders: Folder[]; picks: Pick[]; hasDrive: boolean };
const fetchClient = (id: string) => getJson<ClientData>(`/api/pick/client?clientId=${id}`);

async function getJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const body = await res.json().catch(() => ({}));
  if (res.status === 401) throw new Error("Your sign-in has expired. Reload the page to sign in again.");
  if (!res.ok) throw new Error(body.error || `Something went wrong (${res.status}).`);
  return body as T;
}

/** Shrinks a camera-roll photo to 2400px JPEG in the browser (keeps uploads under Vercel's 4.5 MB limit). */
async function shrink(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" }).catch(async () => {
    const img = new Image();
    img.src = URL.createObjectURL(file);
    await img.decode();
    return img;
  });
  const w = "naturalWidth" in bitmap ? bitmap.naturalWidth : bitmap.width;
  const h = "naturalHeight" in bitmap ? bitmap.naturalHeight : bitmap.height;
  const scale = Math.min(1, 2400 / Math.max(w, h));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(w * scale);
  canvas.height = Math.round(h * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Couldn't read that photo."))), "image/jpeg", 0.88));
}

const fmtDate = (d: string | null) =>
  d ? new Date(`${d}T12:00:00`).toLocaleDateString("en-AU", { weekday: "short", day: "numeric", month: "short" }) : "No date";

function briefWords(brief: string) {
  const stop = new Set("a an the of and or with for in on at to from photo image shot pic product our your use show showing".split(" "));
  return brief.toLowerCase().replace(/[^a-z0-9\s-]/g, " ").split(/\s+/).filter((w) => w.length > 2 && !stop.has(w)).slice(0, 2).join(" ");
}

export function Picker({ clients, initialClientId }: { clients: { id: string; name: string }[]; initialClientId: string }) {
  const [clientId, setClientId] = useState(initialClientId);
  const [posts, setPosts] = useState<Post[]>([]);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [picks, setPicks] = useState<Pick[]>([]);
  const [hasDrive, setHasDrive] = useState(true);
  const [postId, setPostId] = useState<string>("");
  const [tab, setTab] = useState<"drive" | "camera">("drive");
  const [folder, setFolder] = useState(ALL);
  const [q, setQ] = useState("");
  const [assets, setAssets] = useState<Asset[]>([]);
  const [loadingAssets, setLoadingAssets] = useState(false);
  const [chosen, setChosen] = useState<Map<string, Asset>>(new Map());
  const [locals, setLocals] = useState<Local[]>([]);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);
  const [preview, setPreview] = useState<Asset | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const applyClient = useCallback((data: ClientData) => {
    setPosts(data.posts);
    setFolders(data.folders);
    setPicks(data.picks);
    setHasDrive(data.hasDrive);
    const today = new Date().toISOString().slice(0, 10);
    setPostId(data.posts.find((p) => p.date && p.date >= today && !p.inBuffer.length)?.id ?? "");
  }, []);
  const showError = useCallback((err: unknown) => setMessage({ text: (err as Error).message, ok: false }), []);

  const loadClient = useCallback((id: string) => {
    if (id) fetchClient(id).then(applyClient, showError);
  }, [applyClient, showError]);

  useEffect(() => {
    let live = true;
    if (initialClientId) fetchClient(initialClientId).then((d) => live && applyClient(d), (e) => live && showError(e));
    return () => { live = false; };
  }, [initialClientId, applyClient, showError]);

  function changeClient(id: string) {
    // Remembered for next time (read by the server when the page loads).
    document.cookie = `pick_client=${id}; path=/pick; max-age=31536000; samesite=lax; secure`;
    setClientId(id);
    setChosen(new Map());
    setFolder(ALL);
    setQ("");
    setMessage(null);
    setPosts([]);
    setPicks([]);
    loadClient(id);
  }

  // Search the library as you type / change folder.
  useEffect(() => {
    if (!clientId || tab !== "drive") return;
    const t = setTimeout(async () => {
      setLoadingAssets(true);
      try {
        const data = await getJson<{ assets: Asset[] }>(`/api/pick/library?clientId=${clientId}&folder=${encodeURIComponent(folder)}&q=${encodeURIComponent(q)}`);
        setAssets(data.assets);
      } catch (err) {
        setMessage({ text: (err as Error).message, ok: false });
      } finally {
        setLoadingAssets(false);
      }
    }, 300);
    return () => clearTimeout(t);
  }, [clientId, folder, q, tab]);

  const post = posts.find((p) => p.id === postId) ?? null;
  const count = chosen.size + locals.length;
  const picksByPost = useMemo(() => {
    const groups = new Map<string, Pick[]>();
    for (const p of picks) {
      const key = p.postId ?? "";
      groups.set(key, [...(groups.get(key) ?? []), p]);
    }
    return groups;
  }, [picks]);

  function toggle(a: Asset) {
    setChosen((prev) => {
      const next = new Map(prev);
      if (next.has(a.id)) next.delete(a.id);
      else next.set(a.id, a);
      return next;
    });
  }

  function addLocal(files: FileList | null) {
    if (!files) return;
    setLocals((prev) => [...prev, ...[...files].filter((f) => f.type.startsWith("image/") || /\.(heic|heif)$/i.test(f.name)).map((file) => ({ key: crypto.randomUUID(), file, url: URL.createObjectURL(file) }))]);
  }

  async function send() {
    if (!count || busy) return;
    setMessage(null);
    try {
      if (chosen.size) {
        setBusy("Sending…");
        await getJson("/api/pick/picks", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ clientId, postId: postId || null, assetIds: [...chosen.keys()], note }),
        });
      }
      for (const [i, l] of locals.entries()) {
        setBusy(`Uploading ${i + 1} of ${locals.length}…`);
        const form = new FormData();
        form.set("clientId", clientId);
        form.set("postId", postId);
        form.set("label", l.file.name);
        form.set("note", note);
        form.set("file", await shrink(l.file), "photo.jpg");
        await getJson("/api/pick/upload", { method: "POST", body: form });
      }
      setMessage({ text: `✓ ${count} photo${count === 1 ? "" : "s"} sent to Studio${post ? ` for ${fmtDate(post.date)}` : ""}.`, ok: true });
      setChosen(new Map());
      locals.forEach((l) => URL.revokeObjectURL(l.url));
      setLocals([]);
      setNote("");
      loadClient(clientId);
    } catch (err) {
      setMessage({ text: (err as Error).message, ok: false });
    } finally {
      setBusy("");
    }
  }

  async function unpick(id: string) {
    setPicks((prev) => prev.filter((p) => p.id !== id));
    await getJson(`/api/pick/picks?clientId=${clientId}&id=${id}`, { method: "DELETE" }).catch((err) => setMessage({ text: err.message, ok: false }));
  }

  return (
    <div className="mx-auto min-h-dvh max-w-xl bg-stone-50 pb-[calc(6rem+env(safe-area-inset-bottom))]">
      <header className="sticky top-0 z-10 border-b border-stone-200 bg-white/95 px-4 pb-3 pt-[calc(0.75rem+env(safe-area-inset-top))] backdrop-blur">
        <div className="flex items-center gap-3">
          <span className="text-lg font-semibold"><span className="text-amber-600">Pick</span> photos</span>
          <select
            value={clientId}
            onChange={(e) => changeClient(e.target.value)}
            className="ml-auto max-w-[60%] rounded-lg border border-stone-300 bg-white px-3 py-2 text-base font-medium"
            aria-label="Client"
          >
            {clients.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>
      </header>

      <main className="space-y-5 px-4 pt-4">
        {/* Post */}
        <section>
          <label className="text-sm font-semibold text-stone-600" htmlFor="post">For which post?</label>
          <select id="post" value={postId} onChange={(e) => setPostId(e.target.value)} className="mt-1 w-full rounded-lg border border-stone-300 bg-white px-3 py-2.5 text-base">
            <option value="">No particular post. I&apos;ll choose later.</option>
            {posts.map((p) => (
              <option key={p.id} value={p.id}>
                {fmtDate(p.date)} · {p.pillar || p.format || "post"} — {(p.hook || p.caption || "Untitled").slice(0, 50)}{p.inBuffer.length ? " ✓" : ""}
              </option>
            ))}
          </select>
          {post && (
            <div className="mt-2 rounded-xl border border-stone-200 bg-white p-3 text-sm">
              <p className="text-xs text-stone-500">{[post.channels.join(", "), post.format, post.time].filter(Boolean).join(" · ")}</p>
              {post.hook && <p className="mt-1 font-semibold">{post.hook}</p>}
              {post.moment && <p className="mt-1 text-stone-600"><b className="text-stone-500">Offer:</b> {post.moment}</p>}
              {post.assetBrief && (
                <p className="mt-1 text-stone-600">
                  <b className="text-stone-500">Image brief:</b> {post.assetBrief}{" "}
                  <button type="button" onClick={() => { setTab("drive"); setFolder(ALL); setQ(briefWords(post.assetBrief!)); }} className="text-amber-700 underline">
                    Find photos
                  </button>
                </p>
              )}
            </div>
          )}
        </section>

        {/* Source */}
        <section>
          <div className="grid grid-cols-2 rounded-xl bg-stone-200 p-1 text-sm font-semibold">
            {(["drive", "camera"] as const).map((t) => (
              <button key={t} type="button" onClick={() => setTab(t)} className={`rounded-lg py-2 ${tab === t ? "bg-white shadow-sm" : "text-stone-600"}`}>
                {t === "drive" ? "Client Drive" : "Camera roll"}
              </button>
            ))}
          </div>

          {tab === "drive" ? (
            <div className="mt-3">
              {!hasDrive && <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">This client has no Drive folder set up in Content Hub yet.</p>}
              <input
                type="search"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search (e.g. balm, flatlay, summer)"
                className="w-full rounded-lg border border-stone-300 bg-white px-3 py-2.5 text-base"
              />
              <div className="-mx-4 mt-2 flex gap-2 overflow-x-auto px-4 pb-1">
                {[{ path: ALL, count: 0 }, ...folders].map((f) => (
                  <button
                    key={f.path}
                    type="button"
                    onClick={() => setFolder(f.path)}
                    className={`shrink-0 rounded-full border px-3 py-1.5 text-sm ${folder === f.path ? "border-stone-900 bg-stone-900 text-white" : "border-stone-300 bg-white"}`}
                  >
                    {f.path === ALL ? "Newest" : `${f.path.split("/").pop() || "Top folder"} · ${f.count}`}
                  </button>
                ))}
              </div>
              {folder !== ALL && folder.includes("/") && <p className="mt-1 text-xs text-stone-500">{folder}</p>}
              <div className="mt-3 grid grid-cols-3 gap-1.5">
                {assets.map((a) => {
                  const on = chosen.has(a.id);
                  return (
                    <button
                      key={a.id}
                      type="button"
                      onClick={() => toggle(a)}
                      onContextMenu={(e) => { e.preventDefault(); setPreview(a); }}
                      className={`relative aspect-square overflow-hidden rounded-lg bg-stone-200 ${on ? "ring-4 ring-amber-400" : ""}`}
                      aria-pressed={on}
                      aria-label={a.name}
                    >
                      {a.thumb ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={a.thumb} alt={a.description ?? a.name} loading="lazy" className="h-full w-full object-cover" />
                      ) : (
                        <span className="p-1 text-xs text-stone-500">{a.name}</span>
                      )}
                      {on && <span className="absolute right-1 top-1 grid h-6 w-6 place-items-center rounded-full bg-amber-400 text-sm font-bold">✓</span>}
                    </button>
                  );
                })}
              </div>
              <p className="mt-2 text-center text-xs text-stone-500">
                {loadingAssets ? "Loading…" : assets.length ? "Tap to select · press and hold to see it bigger" : q ? `Nothing for “${q}”.` : "No photos synced yet. Run Sync from Drive in Content Hub → Library."}
              </p>
            </div>
          ) : (
            <div className="mt-3">
              <input ref={fileInput} type="file" accept="image/*" multiple hidden onChange={(e) => { addLocal(e.target.files); e.target.value = ""; }} />
              <button type="button" onClick={() => fileInput.current?.click()} className="w-full rounded-xl border-2 border-dashed border-stone-300 bg-white py-8 text-base font-semibold text-stone-700">
                Choose from camera roll
              </button>
              {locals.length > 0 && (
                <div className="mt-3 grid grid-cols-3 gap-1.5">
                  {locals.map((l) => (
                    <div key={l.key} className="relative aspect-square overflow-hidden rounded-lg bg-stone-200 ring-4 ring-amber-400">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={l.url} alt={l.file.name} className="h-full w-full object-cover" />
                      <button type="button" onClick={() => setLocals((prev) => prev.filter((x) => x.key !== l.key))} className="absolute right-1 top-1 grid h-6 w-6 place-items-center rounded-full bg-black/60 text-xs text-white" aria-label="Remove">✕</button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </section>

        {count > 0 && (
          <section>
            <label className="text-sm font-semibold text-stone-600" htmlFor="note">Note for later (optional)</label>
            <input id="note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} placeholder="e.g. first one is the cover" className="mt-1 w-full rounded-lg border border-stone-300 bg-white px-3 py-2.5 text-base" />
          </section>
        )}

        {message && <p className={`rounded-lg p-3 text-sm ${message.ok ? "bg-green-50 text-green-800" : "bg-red-50 text-red-700"}`}>{message.text}</p>}

        {/* Waiting in Studio */}
        {picks.length > 0 && (
          <section>
            <h2 className="text-sm font-semibold text-stone-600">Waiting in Studio ({picks.length})</h2>
            <p className="text-xs text-stone-500">These show up in the Chrome extension, ready to design.</p>
            <div className="mt-2 space-y-3">
              {[...picksByPost.entries()].map(([pid, list]) => {
                const p = posts.find((x) => x.id === pid);
                return (
                  <div key={pid || "none"} className="rounded-xl border border-stone-200 bg-white p-2">
                    <p className="px-1 text-xs font-medium text-stone-600">{p ? `${fmtDate(p.date)} · ${(p.hook || p.pillar || "post").slice(0, 50)}` : pid ? "A post no longer in the list" : "No particular post"}</p>
                    <div className="mt-1.5 flex gap-1.5 overflow-x-auto">
                      {list.map((k) => (
                        <div key={k.id} className="relative h-16 w-16 shrink-0 overflow-hidden rounded-md bg-stone-200" title={k.note || k.label}>
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          {k.thumb && <img src={k.thumb} alt={k.label} className="h-full w-full object-cover" />}
                          <button type="button" onClick={() => unpick(k.id)} className="absolute right-0.5 top-0.5 grid h-5 w-5 place-items-center rounded-full bg-black/60 text-[10px] text-white" aria-label="Remove">✕</button>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        )}
      </main>

      <footer className="fixed inset-x-0 bottom-0 z-10 border-t border-stone-200 bg-white/95 px-4 pb-[calc(0.75rem+env(safe-area-inset-bottom))] pt-3 backdrop-blur">
        <div className="mx-auto flex max-w-xl items-center gap-3">
          {count > 0 && (
            <button type="button" onClick={() => { setChosen(new Map()); setLocals([]); }} className="text-sm text-stone-500 underline">
              Clear
            </button>
          )}
          <button
            type="button"
            onClick={send}
            disabled={!count || !!busy}
            className="flex-1 rounded-xl bg-amber-400 py-3.5 text-base font-semibold text-stone-900 disabled:opacity-40"
          >
            {busy || (count ? `Send ${count} photo${count === 1 ? "" : "s"} to Studio` : "Select photos")}
          </button>
        </div>
      </footer>

      {preview && (
        <div className="fixed inset-0 z-20 grid place-items-center bg-black/80 p-4" onClick={() => setPreview(null)}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {preview.thumb && <img src={preview.thumb} alt={preview.name} className="max-h-[75vh] max-w-full rounded-lg" />}
          <p className="mt-2 text-center text-sm text-white">{preview.name}<br /><span className="text-stone-300">{preview.description}</span></p>
        </div>
      )}
    </div>
  );
}

"use client";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { JobRunner, type JobView } from "@/components/job-runner";
import { startAnalysis, startDriveIndex } from "@/app/clients/actions";
import { approveItem, searchLibrary, swapAssets, unapproveItem, type PickerAsset } from "@/app/clients/[id]/review/actions";
import type { PostPhoto, PostSummary } from "@/lib/studio";
import { choosePhoneClient, matchUpcoming, removePhonePick } from "./actions";

type PhonePick = { id: string; label: string; thumb: string | null };
type Post = PostSummary & { photos: PostPhoto[]; phonePicks: PhonePick[] };
export type BoardJob = JobView & { kind: string };
type Folder = { path: string; count: number };

const JOB_LABEL: Record<string, string> = {
  drive_index: "Syncing photos from Drive",
  ai_analyse: "Tagging new photos with AI",
  match: "Finding photos for posts",
};

const fmtDate = (d: string | null) =>
  d ? new Date(`${d}T12:00:00`).toLocaleDateString("en-AU", { weekday: "short", day: "numeric", month: "short" }) : "No date";

function weekOf(d: string) {
  const date = new Date(`${d}T12:00:00`);
  date.setDate(date.getDate() - ((date.getDay() + 6) % 7));
  return date.toISOString().slice(0, 10);
}

function briefWords(brief: string | null) {
  if (!brief) return "";
  const stop = new Set("a an the of and or with for in on at to from photo image shot pic product our your use show showing".split(" "));
  return brief.toLowerCase().replace(/[^a-z0-9\s-]/g, " ").split(/\s+/).filter((w) => w.length > 2 && !stop.has(w)).slice(0, 2).join(" ");
}

type Status = "approved" | "check" | "missing" | "none";
function statusOf(p: Post): Status {
  if (!p.photos.length) return "missing";
  if (p.photos.every((x) => !x.assetId)) return "none";
  return p.photos.some((x) => x.state === "suggested") ? "check" : "approved";
}

/** Shrinks a camera-roll photo to 2400px JPEG in the browser (keeps uploads under Vercel's 4.5 MB limit). */
async function shrink(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  const scale = Math.min(1, 2400 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Couldn't read that photo."))), "image/jpeg", 0.88));
}

export function Board(props: {
  clients: { id: string; name: string }[];
  clientId: string;
  hasDrive: boolean;
  posts: Post[];
  folders: Folder[];
  stats: { total: number; tagged: number };
  jobs: BoardJob[];
}) {
  const { clients, clientId, posts, folders, stats, jobs, hasDrive } = props;
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [filter, setFilter] = useState<"todo" | "all">("todo");
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);
  const [choosing, setChoosing] = useState<Post | null>(null);

  const counts = useMemo(() => {
    const c = { approved: 0, check: 0, missing: 0, none: 0 };
    for (const p of posts) c[statusOf(p)] += 1;
    return c;
  }, [posts]);
  const todo = counts.check + counts.missing;
  const shown = filter === "todo" ? posts.filter((p) => ["check", "missing"].includes(statusOf(p))) : posts;

  const run = (fn: () => Promise<unknown>, done?: string) =>
    startTransition(async () => {
      try {
        const res = (await fn()) as { ok?: boolean; message?: string } | undefined;
        if (res?.message) setMessage({ text: res.message, ok: res.ok !== false });
        else if (done) setMessage({ text: done, ok: true });
        router.refresh();
      } catch (err) {
        setMessage({ text: (err as Error).message, ok: false });
      }
    });

  // A "Week of …" heading above the first post of each week.
  const headings = new Map<string, string>();
  shown.forEach((p, i) => {
    const week = p.date ? weekOf(p.date) : "none";
    const prev = shown[i - 1];
    if (!prev || (prev.date ? weekOf(prev.date) : "none") !== week) headings.set(p.id, p.date ? `Week of ${fmtDate(week)}` : "No date");
  });

  return (
    <div className="mx-auto min-h-dvh max-w-xl bg-stone-50 pb-[calc(2rem+env(safe-area-inset-bottom))]">
      <header className="sticky top-0 z-10 border-b border-stone-200 bg-white/95 px-4 pb-3 pt-[calc(0.75rem+env(safe-area-inset-top))] backdrop-blur">
        <div className="flex items-center gap-3">
          <span className="text-lg font-semibold"><span className="text-amber-600">lemon</span>lolly</span>
          <select
            value={clientId}
            onChange={(e) => run(() => choosePhoneClient(e.target.value))}
            className="ml-auto max-w-[65%] rounded-lg border border-stone-300 bg-white px-3 py-2 text-base font-medium"
            aria-label="Client"
          >
            {clients.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>
        <div className="mt-3 flex items-center gap-2">
          <div className="grid flex-1 grid-cols-2 rounded-xl bg-stone-200 p-1 text-sm font-semibold">
            <button type="button" onClick={() => setFilter("todo")} className={`rounded-lg py-1.5 ${filter === "todo" ? "bg-white shadow-sm" : "text-stone-600"}`}>
              To check · {todo}
            </button>
            <button type="button" onClick={() => setFilter("all")} className={`rounded-lg py-1.5 ${filter === "all" ? "bg-white shadow-sm" : "text-stone-600"}`}>
              All · {posts.length}
            </button>
          </div>
          <button
            type="button"
            disabled={pending || !hasDrive}
            onClick={() => run(() => startDriveIndex(clientId), "Syncing from Drive…")}
            className="rounded-xl border border-stone-300 bg-white px-3 py-2 text-sm font-semibold disabled:opacity-40"
          >
            Sync Drive
          </button>
        </div>
      </header>

      <main className="space-y-3 px-4 pt-3">
        {jobs.map((j) => (
          <JobRunner key={j.id} initial={j} label={JOB_LABEL[j.kind] ?? j.kind} />
        ))}

        {!hasDrive && <Banner>This client has no Drive folder yet. Add it in Content Hub → Settings on your laptop.</Banner>}
        {hasDrive && stats.total === 0 && !jobs.length && <Banner>No photos synced yet. Tap <b>Sync Drive</b>.</Banner>}
        {stats.total > stats.tagged && !jobs.some((j) => j.kind !== "match") && (
          <Banner>
            {stats.total - stats.tagged} photo{stats.total - stats.tagged === 1 ? "" : "s"} still need tagging before they can be suggested.{" "}
            <button type="button" className="font-semibold underline" onClick={() => run(() => startAnalysis(clientId), "Tagging…")}>Tag now</button>
          </Banner>
        )}
        {counts.missing > 0 && stats.tagged > 0 && !jobs.some((j) => j.kind === "match") && (
          <button
            type="button"
            disabled={pending}
            onClick={() => run(() => matchUpcoming(clientId))}
            className="w-full rounded-xl border border-amber-300 bg-amber-50 py-3 text-sm font-semibold text-amber-900 disabled:opacity-50"
          >
            ✨ Suggest photos for {counts.missing} post{counts.missing === 1 ? "" : "s"} without one
          </button>
        )}

        {message && <p className={`rounded-lg p-3 text-sm ${message.ok ? "bg-green-50 text-green-800" : "bg-red-50 text-red-700"}`}>{message.text}</p>}

        {!shown.length && (
          <p className="py-16 text-center text-stone-500">
            {filter === "todo" ? "All caught up ✓ Every upcoming post has an approved photo." : "No upcoming posts. Import this month's calendar in Content Hub."}
          </p>
        )}

        {shown.map((p) => {
          const heading = headings.get(p.id);
          return (
            <div key={p.id}>
              {heading && <h2 className="pb-1 pt-3 text-xs font-semibold uppercase tracking-wide text-stone-500">{heading}</h2>}
              <PostCard
                post={p}
                busy={pending}
                onApprove={() => run(() => approveItem(clientId, p.id), "Approved ✓")}
                onUnapprove={() => run(() => unapproveItem(clientId, p.id))}
                onChoose={() => setChoosing(p)}
                onRemovePick={(id) => run(() => removePhonePick(clientId, id))}
              />
            </div>
          );
        })}
      </main>

      {choosing && (
        <ChooseSheet
          clientId={clientId}
          post={choosing}
          folders={folders}
          onClose={() => setChoosing(null)}
          onSaved={(text) => {
            setChoosing(null);
            setMessage({ text, ok: true });
            router.refresh();
          }}
        />
      )}
    </div>
  );
}

function Banner({ children }: { children: React.ReactNode }) {
  return <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">{children}</p>;
}

function PostCard({ post: p, busy, onApprove, onUnapprove, onChoose, onRemovePick }: {
  post: Post;
  busy: boolean;
  onApprove: () => void;
  onUnapprove: () => void;
  onChoose: () => void;
  onRemovePick: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const status = statusOf(p);
  const real = p.photos.filter((x) => x.assetId);
  const suggested = p.photos.find((x) => x.state === "suggested" && x.assetId);
  const carousel = p.format === "carousel";
  const badge = {
    approved: ["✓ Approved", "bg-green-100 text-green-800"],
    check: ["Check photo", "bg-amber-100 text-amber-900"],
    missing: ["No photo", "bg-red-100 text-red-700"],
    none: ["No photo needed", "bg-stone-200 text-stone-600"],
  }[status];

  return (
    <article className="overflow-hidden rounded-2xl border border-stone-200 bg-white">
      <div className="px-4 pt-3">
        <div className="flex items-center gap-2 text-xs text-stone-500">
          <span className="font-semibold text-stone-800">{fmtDate(p.date)}{p.time ? ` · ${p.time}` : ""}</span>
          <span className="truncate">{[p.channels.join(", "), p.format, p.pillar].filter(Boolean).join(" · ")}</span>
          <span className={`ml-auto shrink-0 rounded-full px-2 py-0.5 font-semibold ${badge[1]}`}>{badge[0]}</span>
        </div>
        {p.hook && <p className="mt-1.5 font-semibold leading-snug">{p.hook}</p>}
        {p.caption && (
          <button type="button" onClick={() => setOpen(!open)} className={`mt-1 block w-full whitespace-pre-line text-left text-sm text-stone-600 ${open ? "" : "line-clamp-3"}`}>
            {p.caption}
          </button>
        )}
        {p.assetBrief && <p className="mt-1.5 text-sm text-stone-600"><b className="text-stone-500">Image brief:</b> {p.assetBrief}</p>}
      </div>

      <div className="mt-3">
        {real.length === 0 ? (
          <button type="button" onClick={onChoose} className="mx-4 grid aspect-[4/3] w-[calc(100%-2rem)] place-items-center rounded-xl border-2 border-dashed border-stone-300 text-sm font-semibold text-stone-500">
            {status === "none" ? "Marked as no photo needed · tap to choose one" : "＋ Choose a photo"}
          </button>
        ) : carousel || real.length > 1 ? (
          <div className="flex snap-x gap-2 overflow-x-auto px-4">
            {real.map((x, i) => (
              <Photo key={x.matchId} photo={x} className="aspect-[4/5] w-[70%] shrink-0 snap-start rounded-xl" index={i + 1} />
            ))}
          </div>
        ) : (
          <Photo photo={real[0]} className="mx-auto aspect-[4/5] w-full" />
        )}
        {suggested && (
          <p className="px-4 pt-2 text-xs text-stone-500">
            AI suggestion{suggested.confidence !== null ? ` · ${Math.round(suggested.confidence * 100)}% match` : ""}{suggested.reason ? ` — ${suggested.reason}` : ""}
          </p>
        )}
      </div>

      {p.phonePicks.length > 0 && (
        <div className="mx-4 mt-2 flex items-center gap-2 rounded-lg bg-stone-100 p-2 text-xs text-stone-600">
          <span>📱 For Studio:</span>
          {p.phonePicks.map((k) => (
            <span key={k.id} className="relative h-10 w-10 shrink-0 overflow-hidden rounded bg-stone-200">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {k.thumb && <img src={k.thumb} alt={k.label} className="h-full w-full object-cover" />}
              <button type="button" onClick={() => onRemovePick(k.id)} className="absolute right-0 top-0 grid h-4 w-4 place-items-center rounded-full bg-black/60 text-[9px] text-white" aria-label="Remove">✕</button>
            </span>
          ))}
        </div>
      )}

      <div className="flex gap-2 p-3">
        {status === "check" && (
          <button type="button" disabled={busy} onClick={onApprove} className="flex-1 rounded-xl bg-amber-400 py-3 text-base font-semibold text-stone-900 disabled:opacity-50">
            ✓ Looks good
          </button>
        )}
        <button
          type="button"
          onClick={onChoose}
          className={`rounded-xl border border-stone-300 bg-white py-3 text-base font-semibold ${status === "check" ? "px-5" : "flex-1"}`}
        >
          {real.length ? (carousel ? "Change photos" : "Change photo") : "Choose photo"}
        </button>
        {status === "approved" && p.photos.some((x) => x.state === "approved") && (
          <button type="button" disabled={busy} onClick={onUnapprove} className="px-2 text-sm text-stone-500 underline">Undo</button>
        )}
      </div>
    </article>
  );
}

function Photo({ photo, className, index }: { photo: PostPhoto; className: string; index?: number }) {
  return (
    <div className={`relative overflow-hidden bg-stone-200 ${className}`}>
      {photo.thumb ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={photo.thumb} alt={photo.name} loading="lazy" className="h-full w-full object-cover" />
      ) : (
        <span className="grid h-full place-items-center p-2 text-xs text-stone-500">{photo.name}</span>
      )}
      {index !== undefined && <span className="absolute left-2 top-2 rounded-full bg-black/60 px-2 text-xs font-semibold text-white">{index}</span>}
      {photo.kind === "video" && <span className="absolute right-2 top-2 rounded bg-black/60 px-1.5 text-xs text-white">▶ video</span>}
    </div>
  );
}

function ChooseSheet({ clientId, post, folders, onClose, onSaved }: {
  clientId: string;
  post: Post;
  folders: Folder[];
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const multi = post.format === "carousel";
  const [q, setQ] = useState(briefWords(post.assetBrief));
  const [folder, setFolder] = useState("");
  const [assets, setAssets] = useState<PickerAsset[]>([]);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState("");
  const [chosen, setChosen] = useState<string[]>(post.photos.filter((x) => x.assetId).map((x) => x.assetId!));
  const fileInput = useRef<HTMLInputElement>(null);
  const searchTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  function apply(res: { assets: PickerAsset[]; hasMore: boolean }, nextPage: number) {
    setAssets((prev) => (nextPage === 0 ? res.assets : [...prev, ...res.assets]));
    setHasMore(res.hasMore);
    setPage(nextPage);
    setLoading(false);
  }
  const fail = (err: unknown) => {
    setError((err as Error).message);
    setLoading(false);
  };

  function load(nextQ: string, nextFolder: string, nextPage: number) {
    setLoading(true);
    setError("");
    searchLibrary(clientId, nextQ, nextFolder, nextPage).then((res) => apply(res, nextPage), fail);
  }

  // First search, with the post's brief, when the sheet opens.
  const firstQ = useRef(q);
  useEffect(() => {
    let live = true;
    searchLibrary(clientId, firstQ.current, "", 0).then(
      (res) => live && apply(res, 0),
      (err) => live && fail(err),
    );
    return () => { live = false; };
  }, [clientId]);

  function search(nextQ: string, nextFolder: string) {
    clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => load(nextQ, nextFolder, 0), 300);
  }

  async function save(ids: string[]) {
    setSaving("Saving…");
    try {
      await swapAssets(clientId, post.id, ids);
      onSaved(ids.length ? `Photo${ids.length > 1 ? "s" : ""} attached to ${fmtDate(post.date)} ✓` : "Marked as no photo needed.");
    } catch (err) {
      setError((err as Error).message);
      setSaving("");
    }
  }

  function tap(a: PickerAsset) {
    if (!multi) return save([a.id]);
    setChosen((prev) => (prev.includes(a.id) ? prev.filter((x) => x !== a.id) : [...prev, a.id]));
  }

  async function upload(files: FileList | null) {
    if (!files?.length) return;
    try {
      for (const [i, f] of [...files].entries()) {
        setSaving(`Uploading ${i + 1} of ${files.length}…`);
        const form = new FormData();
        form.set("clientId", clientId);
        form.set("postId", post.id);
        form.set("label", f.name);
        form.set("file", await shrink(f), "photo.jpg");
        const res = await fetch("/api/pick/upload", { method: "POST", body: form });
        if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Upload failed.");
      }
      onSaved(`${files.length} phone photo${files.length === 1 ? "" : "s"} sent to Studio for this post.`);
    } catch (err) {
      setError((err as Error).message);
      setSaving("");
    }
  }

  return (
    <div className="fixed inset-0 z-30 flex flex-col bg-stone-50">
      <div className="border-b border-stone-200 bg-white px-4 pb-3 pt-[calc(0.75rem+env(safe-area-inset-top))]">
        <div className="flex items-center gap-3">
          <button type="button" onClick={onClose} className="text-2xl leading-none text-stone-500" aria-label="Close">✕</button>
          <div className="min-w-0 flex-1">
            <p className="truncate font-semibold">{post.hook || "Choose a photo"}</p>
            <p className="text-xs text-stone-500">{fmtDate(post.date)} · {multi ? "tap photos in order for the carousel" : "tap a photo to attach it"}</p>
          </div>
        </div>
        {post.assetBrief && <p className="mt-2 text-sm text-stone-600"><b className="text-stone-500">Brief:</b> {post.assetBrief}</p>}
        <input
          type="search"
          value={q}
          onChange={(e) => { setQ(e.target.value); search(e.target.value, folder); }}
          placeholder="Search photos"
          className="mt-2 w-full rounded-lg border border-stone-300 bg-white px-3 py-2.5 text-base"
        />
        <div className="-mx-4 mt-2 flex gap-2 overflow-x-auto px-4">
          {[{ path: "", count: 0 }, ...folders].map((f) => (
            <button
              key={f.path || "all"}
              type="button"
              onClick={() => { setFolder(f.path); load(q, f.path, 0); }}
              className={`shrink-0 rounded-full border px-3 py-1.5 text-sm ${folder === f.path ? "border-stone-900 bg-stone-900 text-white" : "border-stone-300 bg-white"}`}
            >
              {f.path === "" ? "All folders" : `${f.path.split("/").pop() || "Top folder"} · ${f.count}`}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-3">
        {error && <p className="mb-2 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
        <div className="grid grid-cols-3 gap-1.5">
          {assets.map((a) => {
            const n = chosen.indexOf(a.id);
            return (
              <button
                key={a.id}
                type="button"
                onClick={() => tap(a)}
                disabled={!!saving}
                className={`relative aspect-square overflow-hidden rounded-lg bg-stone-200 ${n >= 0 ? "ring-4 ring-amber-400" : ""}`}
                aria-pressed={n >= 0}
                aria-label={a.name}
              >
                {a.thumb ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={a.thumb} alt={a.ai_description ?? a.name} loading="lazy" className="h-full w-full object-cover" />
                ) : (
                  <span className="p-1 text-xs text-stone-500">{a.name}</span>
                )}
                {n >= 0 && <span className="absolute right-1 top-1 grid h-6 w-6 place-items-center rounded-full bg-amber-400 text-sm font-bold">{multi ? n + 1 : "✓"}</span>}
                {a.kind === "video" && <span className="absolute bottom-1 left-1 rounded bg-black/60 px-1 text-[10px] text-white">▶</span>}
              </button>
            );
          })}
        </div>
        <p className="py-4 text-center text-sm text-stone-500">
          {loading ? "Loading…" : !assets.length ? (q ? `Nothing for “${q}”. Try another word or clear the search.` : "No photos here yet. Tap Sync Drive on the main screen.") : null}
        </p>
        {hasMore && !loading && (
          <button type="button" onClick={() => load(q, folder, page + 1)} className="mb-4 w-full rounded-xl border border-stone-300 bg-white py-3 text-sm font-semibold">
            Show more
          </button>
        )}
      </div>

      <div className="border-t border-stone-200 bg-white px-4 pb-[calc(0.75rem+env(safe-area-inset-bottom))] pt-3">
        <input ref={fileInput} type="file" accept="image/*" multiple hidden onChange={(e) => { upload(e.target.files); e.target.value = ""; }} />
        <div className="flex items-center gap-3 text-sm">
          <button type="button" onClick={() => fileInput.current?.click()} disabled={!!saving} className="text-stone-600 underline">From camera roll</button>
          <button type="button" onClick={() => save([])} disabled={!!saving} className="text-stone-600 underline">No photo needed</button>
        </div>
        {(multi || saving) && (
          <button
            type="button"
            onClick={() => save(chosen)}
            disabled={!!saving || (multi && !chosen.length)}
            className="mt-3 w-full rounded-xl bg-amber-400 py-3.5 text-base font-semibold text-stone-900 disabled:opacity-50"
          >
            {saving || `Attach ${chosen.length} photo${chosen.length === 1 ? "" : "s"}`}
          </button>
        )}
      </div>
    </div>
  );
}

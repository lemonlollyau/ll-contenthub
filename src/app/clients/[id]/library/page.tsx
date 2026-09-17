import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { getClient } from "@/lib/clients";
import { db } from "@/lib/db";
import { signedThumbs } from "@/lib/thumbs";
import type { Asset } from "@/lib/types";
import { JobRunner, type JobView } from "@/components/job-runner";
import { inputClass } from "@/components/ui/form";
import { startAnalysis, startDriveIndex } from "../../actions";

const PAGE_SIZE = 60;

export default async function LibraryPage({ params, searchParams }: PageProps<"/clients/[id]/library">) {
  await requireUser();
  const { id } = await params;
  const sp = await searchParams;
  const q = typeof sp.q === "string" ? sp.q.trim() : "";
  const folder = typeof sp.folder === "string" ? sp.folder : "";
  const kind = typeof sp.kind === "string" ? sp.kind : "";
  const page = Math.max(1, Number(sp.page ?? 1) || 1);
  const client = await getClient(id);

  let query = db()
    .from("assets")
    .select("*", { count: "exact" })
    .eq("client_id", id)
    .is("removed_at", null)
    .order("folder_path")
    .order("name")
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);
  if (folder) query = query.eq("folder_path", folder);
  if (kind === "image" || kind === "video") query = query.eq("kind", kind);
  if (q) {
    for (const word of q.toLowerCase().split(/\s+/)) query = query.ilike("search_text", `%${word}%`);
  }

  const [assetsRes, foldersRes, jobsRes, pendingRes] = await Promise.all([
    query,
    db().from("assets").select("folder_path").eq("client_id", id).is("removed_at", null),
    db().from("jobs").select("*").eq("client_id", id).in("kind", ["drive_index", "ai_analyse"]).order("created_at", { ascending: false }).limit(4),
    db().from("assets_needing_analysis").select("id", { count: "exact", head: true }).eq("client_id", id),
  ]);
  const assets = (assetsRes.data ?? []) as Asset[];
  const folders = [...new Set((foldersRes.data ?? []).map((r) => r.folder_path as string))].sort();
  const thumbs = await signedThumbs(assets.map((a) => a.thumbnail_path));
  const jobs = (jobsRes.data ?? []) as (JobView & { kind: string; created_at: string })[];
  const activeJobs = jobs.filter((j) => j.status === "queued" || j.status === "running" || j.status === "failed");
  const lastIndex = jobs.find((j) => j.kind === "drive_index" && j.status === "done");
  const total = assetsRes.count ?? 0;
  const pages = Math.ceil(total / PAGE_SIZE);
  const qs = (p: Record<string, string | number>) =>
    "?" + new URLSearchParams({ ...(q && { q }), ...(folder && { folder }), ...(kind && { kind }), ...Object.fromEntries(Object.entries(p).map(([k, v]) => [k, String(v)])) });

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3">
        {!client.drive_folder_id ? (
          <p className="text-sm text-stone-600">
            Add the Drive folder in <Link href={`/clients/${id}/settings`} className="underline">Settings</Link> first.
          </p>
        ) : (
          <form action={startDriveIndex.bind(null, id)}>
            <button className="rounded-lg bg-stone-900 px-4 py-2 text-sm font-medium text-white hover:bg-stone-700">Sync from Drive</button>
          </form>
        )}
        {(pendingRes.count ?? 0) > 0 && (
          <form action={startAnalysis.bind(null, id)}>
            <button className="rounded-lg border border-stone-300 bg-white px-4 py-2 text-sm hover:bg-stone-100">
              Tag {pendingRes.count} new/changed files with AI
            </button>
          </form>
        )}
        {lastIndex && <span className="text-xs text-stone-500">Last synced {new Date(lastIndex.created_at).toLocaleString("en-AU")}</span>}
      </div>

      {activeJobs.length > 0 && (
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          {activeJobs.map((j) => (
            <JobRunner key={j.id} initial={j} label={j.kind === "drive_index" ? "Reading Drive folder" : "Tagging images with AI"} />
          ))}
        </div>
      )}

      <form className="mt-6 flex flex-wrap gap-2">
        <input name="q" defaultValue={q} placeholder="Search names, descriptions, tags…" className={`${inputClass} max-w-xs`} />
        <select name="folder" defaultValue={folder} className={`${inputClass} max-w-xs`}>
          <option value="">All folders</option>
          {folders.map((f) => (
            <option key={f} value={f}>{f || "(top folder)"}</option>
          ))}
        </select>
        <select name="kind" defaultValue={kind} className={`${inputClass} w-32`}>
          <option value="">All types</option>
          <option value="image">Images</option>
          <option value="video">Videos</option>
        </select>
        <button className="rounded-lg border border-stone-300 bg-white px-3 text-sm">Filter</button>
      </form>

      <p className="mt-4 text-sm text-stone-500">{total} files</p>
      <div className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
        {assets.map((a) => (
          <details key={a.id} className="group rounded-xl border border-stone-200 bg-white p-2 text-xs open:col-span-2 open:row-span-2">
            <summary className="cursor-pointer list-none">
              <div className="relative aspect-square overflow-hidden rounded-lg bg-stone-100">
                {a.thumbnail_path && thumbs[a.thumbnail_path] ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={thumbs[a.thumbnail_path]} alt={a.ai_description ?? a.name} className="h-full w-full object-cover group-open:object-contain" loading="lazy" />
                ) : (
                  <div className="flex h-full items-center justify-center text-stone-400">{a.kind === "video" ? "Video" : "Not tagged yet"}</div>
                )}
                {a.kind === "video" && <span className="absolute left-1 top-1 rounded bg-black/60 px-1 text-white">▶ video</span>}
              </div>
              <p className="mt-1 truncate font-medium" title={a.name}>{a.name}</p>
              <p className="truncate text-stone-500">{a.folder_path || "(top folder)"}</p>
            </summary>
            <div className="mt-2 space-y-1 text-stone-600">
              {a.ai_description && <p>{a.ai_description}</p>}
              <p>
                {a.width && a.height ? `${a.width}×${a.height}` : ""} {a.ai_tags?.orientation ?? ""}
                {a.duration_ms ? ` · ${Math.round(a.duration_ms / 1000)}s` : ""}
              </p>
              {a.ai_tags?.keywords && (
                <div className="flex flex-wrap gap-1">
                  {a.ai_tags.keywords.map((k) => (
                    <Link key={k} href={`?q=${encodeURIComponent(k)}`} className="rounded bg-amber-50 px-1.5 py-0.5 text-amber-800 hover:bg-amber-100">
                      {k}
                    </Link>
                  ))}
                </div>
              )}
              <a href={`https://drive.google.com/file/d/${a.drive_file_id}/view`} target="_blank" rel="noreferrer" className="text-amber-700 underline">
                Open in Drive
              </a>
            </div>
          </details>
        ))}
      </div>
      {pages > 1 && (
        <div className="mt-6 flex gap-2 text-sm">
          {page > 1 && <Link href={qs({ page: page - 1 })} className="rounded border px-3 py-1">Previous</Link>}
          <span className="px-2 py-1 text-stone-500">Page {page} of {pages}</span>
          {page < pages && <Link href={qs({ page: page + 1 })} className="rounded border px-3 py-1">Next</Link>}
        </div>
      )}
    </div>
  );
}

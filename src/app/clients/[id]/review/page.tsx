import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { signedThumbs } from "@/lib/thumbs";
import type { Calendar, ContentItem } from "@/lib/types";
import { JobRunner, type JobView } from "@/components/job-runner";
import { startMatching, startRender } from "../calendar-actions";
import { approveAbove } from "./actions";
import { ReviewCard, type MatchView } from "./review-card";

export default async function ReviewPage({ params, searchParams }: PageProps<"/clients/[id]/review">) {
  await requireUser();
  const { id } = await params;
  const sp = await searchParams;
  const calendars = ((await db().from("calendars").select("*").eq("client_id", id).not("imported_at", "is", null).order("month", { ascending: false })).data ?? []) as Calendar[];
  const calendar = calendars.find((c) => c.id === sp.calendar) ?? calendars[0];
  if (!calendar) return <p className="text-stone-500">Import a calendar first.</p>;
  const show = typeof sp.show === "string" ? sp.show : "todo";

  const [itemsRes, jobsRes, foldersRes, taggedRes, pendingRes] = await Promise.all([
    db().from("content_items").select("*").eq("calendar_id", calendar.id).eq("type", "social").order("post_date").order("row_number"),
    db().from("jobs").select("*").eq("client_id", id).in("kind", ["match", "render"]).order("created_at", { ascending: false }).limit(4),
    db().from("assets").select("folder_path").eq("client_id", id).is("removed_at", null),
    db().from("assets").select("id", { count: "exact", head: true }).eq("client_id", id).is("removed_at", null).not("ai_description", "is", null),
    db().from("assets_needing_analysis").select("id", { count: "exact", head: true }).eq("client_id", id),
  ]);
  const items = (itemsRes.data ?? []) as ContentItem[];
  const matchesRes = await db()
    .from("asset_matches")
    .select("id, content_item_id, asset_id, position, confidence, reason, method, state, crop, assets!asset_matches_asset_id_fkey(id, name, kind, width, height, thumbnail_path, ai_description)")
    .in("content_item_id", items.map((i) => i.id))
    .order("position");
  const rendersRes = await db().from("rendered_assets").select("content_item_id, asset_id, public_url, warnings").in("content_item_id", items.map((i) => i.id));
  const matches = (matchesRes.data ?? []) as unknown as (Omit<MatchView, "thumb" | "renderedUrl" | "renderWarnings"> & {
    content_item_id: string;
    assets: (MatchView["asset"] & { thumbnail_path: string | null }) | null;
  })[];
  const thumbs = await signedThumbs(matches.map((m) => m.assets?.thumbnail_path ?? null));
  const renders = new Map((rendersRes.data ?? []).map((r) => [`${r.content_item_id}|${r.asset_id}`, r]));

  const byItem = new Map<string, MatchView[]>();
  for (const m of matches) {
    const r = m.asset_id ? renders.get(`${m.content_item_id}|${m.asset_id}`) : undefined;
    const list = byItem.get(m.content_item_id) ?? [];
    list.push({
      id: m.id, asset_id: m.asset_id, position: m.position, confidence: m.confidence, reason: m.reason, method: m.method, state: m.state, crop: m.crop,
      asset: m.assets, thumb: m.assets?.thumbnail_path ? thumbs[m.assets.thumbnail_path] ?? null : null,
      renderedUrl: r?.public_url ?? null, renderWarnings: (r?.warnings as string[]) ?? [],
    });
    byItem.set(m.content_item_id, list);
  }

  const decided = (i: ContentItem) => (byItem.get(i.id) ?? []).some((m) => m.state === "approved" || m.state === "swapped");
  const confidenceOf = (i: ContentItem) => {
    const ms = byItem.get(i.id) ?? [];
    if (!ms.length) return -2; // not matched yet
    if (ms.every((m) => !m.asset_id)) return -1; // no suitable asset
    return Math.min(...ms.map((m) => Number(m.confidence ?? 0)));
  };
  const counts = { todo: items.filter((i) => !decided(i)).length, done: items.filter(decided).length, all: items.length };
  const visible = items
    .filter((i) => (show === "todo" ? !decided(i) : show === "done" ? decided(i) : true))
    .sort((a, b) => confidenceOf(a) - confidenceOf(b));
  const folders = [...new Set((foldersRes.data ?? []).map((r) => r.folder_path as string))].sort();
  const jobs = ((jobsRes.data ?? []) as (JobView & { kind: string; params: { calendarId?: string } })[]).filter(
    (j) => j.params?.calendarId === calendar.id && ["queued", "running", "failed"].includes(j.status),
  );

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3">
        {calendars.map((c) => (
          <Link key={c.id} href={`?calendar=${c.id}`} className={`rounded-full px-3 py-1 text-sm ${c.id === calendar.id ? "bg-stone-900 text-white" : "border border-stone-300 bg-white"}`}>
            {new Date(`${c.month}T00:00:00Z`).toLocaleDateString("en-AU", { month: "short", year: "numeric", timeZone: "UTC" })}
          </Link>
        ))}
        <span className="mx-1 text-stone-300">|</span>
        {(["todo", "done", "all"] as const).map((s) => (
          <Link key={s} href={`?calendar=${calendar.id}&show=${s}`} className={`rounded px-2 py-0.5 text-sm ${show === s ? "bg-amber-100 text-amber-900" : "text-stone-600"}`}>
            {s === "todo" ? "To review" : s === "done" ? "Approved" : "All"} ({counts[s]})
          </Link>
        ))}
        <div className="ml-auto flex flex-wrap items-center gap-2 text-sm">
          <form action={approveAbove.bind(null, id, calendar.id)} className="flex items-center gap-1">
            <span>Approve all ≥</span>
            <input name="threshold" type="number" min={0} max={100} defaultValue={80} className="w-16 rounded border border-stone-300 px-2 py-1" />
            <span>%</span>
            <button className="rounded-lg bg-green-600 px-3 py-1.5 text-white hover:bg-green-700">Approve</button>
          </form>
          <form action={startMatching.bind(null, id, calendar.id)}>
            <button className="rounded-lg border border-stone-300 bg-white px-3 py-1.5 hover:bg-stone-100" title="Re-run matching for posts you haven't decided yet">
              Re-match undecided
            </button>
          </form>
          <form action={startRender.bind(null, id, calendar.id)}>
            <button className="rounded-lg bg-stone-900 px-3 py-1.5 text-white hover:bg-stone-700">Prepare approved images →</button>
          </form>
        </div>
      </div>

      <p className={`mt-3 rounded-lg p-2 text-sm ${taggedRes.count ? "text-stone-600" : "border-2 border-amber-300 bg-amber-50 text-amber-900"}`}>
        Library: <b>{taggedRes.count ?? 0}</b> tagged images and videos available for matching.
        {(pendingRes.count ?? 0) > 0 && <> {pendingRes.count} more aren&apos;t tagged yet. </>}
        {(!taggedRes.count || (pendingRes.count ?? 0) > 0) && (
          <Link href={`/clients/${id}/library`} className="ml-1 underline">Go to the Library to sync and tag them →</Link>
        )}
      </p>

      {jobs.length > 0 && (
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          {jobs.map((j) => <JobRunner key={j.id} initial={j} label={j.kind === "match" ? "Matching imagery" : "Preparing images"} />)}
        </div>
      )}

      <div className="mt-6 grid gap-3">
        {visible.map((item) => (
          <ReviewCard key={item.id} clientId={id} item={item} matches={byItem.get(item.id) ?? []} folders={folders} />
        ))}
        {visible.length === 0 && <p className="py-10 text-center text-stone-500">Nothing here.</p>}
      </div>
    </div>
  );
}

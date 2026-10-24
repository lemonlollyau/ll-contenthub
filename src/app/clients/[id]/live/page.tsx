import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { getClient } from "@/lib/clients";
import { db } from "@/lib/db";
import { loadConnections, providersUsed } from "@/lib/push/provider";
import type { ContentItem } from "@/lib/types";
import { JobRunner, type JobView } from "@/components/job-runner";
import { BoostToggle } from "../boost-toggle";
import { startRefresh } from "./actions";
import { EngagementPanel } from "./engagement-panel";

const METRIC_ORDER = ["reach", "impressions", "views", "reactions", "likes", "comments", "shares", "saves", "clicks", "engagementRate"];
const fmt = (n: number, name: string) => (name === "engagementRate" ? `${(n * 100).toFixed(1)}%` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));

export default async function LivePage({ params }: PageProps<"/clients/[id]/live">) {
  await requireUser();
  const { id } = await params;
  const client = await getClient(id);
  const connections = await loadConnections();
  const used = providersUsed(client, connections);
  const label = used.join(" & ") || "your scheduler";
  const hasBuffer = used.includes("Buffer");
  const hasCs = used.includes("ContentStudio");

  const [itemsRes, jobsRes] = await Promise.all([
    db().from("content_items").select("*").eq("client_id", id).eq("type", "social").order("post_date", { ascending: false }).limit(200),
    db().from("jobs").select("*").eq("client_id", id).eq("kind", "refresh").order("created_at", { ascending: false }).limit(1),
  ]);
  const all = (itemsRes.data ?? []) as ContentItem[];
  const sent = all.filter((i) => Object.keys(i.external_posts ?? {}).length);
  const live = sent.filter((i) => Object.keys(i.published_urls ?? {}).length);
  const job = ((jobsRes.data ?? []) as JobView[]).filter((j) => ["queued", "running", "failed"].includes(j.status))[0];
  const boosted = all.filter((i) => i.boost).length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <p className="text-stone-600">
          {sent.length} post(s) sent to {label}, {live.length} confirmed live.
        </p>
        <form action={startRefresh.bind(null, id)}>
          <button className="rounded-lg bg-stone-900 px-3 py-1.5 text-white hover:bg-stone-700">Check for live links &amp; numbers</button>
        </form>
        {boosted > 0 && (
          <a href={`/api/clients/${id}/boost-csv`} className="text-amber-700 underline">
            Download boost shortlist ({boosted})
          </a>
        )}
      </div>

      {hasBuffer && (
        <p className="text-xs text-stone-500">Buffer refreshes its numbers from each network about once a day, so a post from this morning may show nothing yet.</p>
      )}
      {hasCs && (
        <p className="text-xs text-stone-500">ContentStudio gives us the live link; their per-post numbers need the network&apos;s own post id, which isn&apos;t in their API yet, so those stay blank.</p>
      )}

      {job && <JobRunner initial={job} label="Checking posts" />}

      <div className="overflow-x-auto rounded-xl border border-stone-200 bg-white">
        <table className="min-w-[900px] text-xs">
          <thead className="bg-stone-50 text-left text-stone-500">
            <tr>
              {["#", "Date", "Post", "Live", "Numbers", "Paid", "Engagement"].map((h) => (
                <th key={h} className="px-2 py-2 font-medium">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sent.map((item) => {
              const urls = Object.entries(item.published_urls ?? {});
              return (
                <tr key={item.id} className="border-t border-stone-100 align-top">
                  <td className="px-2 py-2 text-stone-500">{item.row_number}</td>
                  <td className="px-2 py-2 whitespace-nowrap">{item.post_date}</td>
                  <td className="max-w-sm px-2 py-2">
                    <p className="font-medium">{item.hook}</p>
                    <p className="line-clamp-2 text-stone-500">{item.caption}</p>
                  </td>
                  <td className="px-2 py-2">
                    {urls.length === 0 ? (
                      <span className="text-stone-400">not yet</span>
                    ) : (
                      urls.map(([platform, url]) => (
                        <a key={platform} href={url} target="_blank" rel="noreferrer" className="block text-amber-700 underline">
                          {platform}
                        </a>
                      ))
                    )}
                  </td>
                  <td className="px-2 py-2">
                    {Object.entries(item.metrics ?? {}).map(([platform, m]) => (
                      <p key={platform}>
                        <span className="text-stone-400">{platform}:</span>{" "}
                        {METRIC_ORDER.filter((k) => typeof m[k] === "number")
                          .map((k) => `${k} ${fmt(m[k] as number, k)}`)
                          .join(" · ") || "no numbers yet"}
                      </p>
                    ))}
                    {!Object.keys(item.metrics ?? {}).length && <span className="text-stone-400">—</span>}
                  </td>
                  <td className="px-2 py-2">
                    <BoostToggle clientId={id} itemId={item.id} boost={item.boost} />
                  </td>
                  <td className="max-w-xs px-2 py-2">
                    <EngagementPanel clientId={id} itemId={item.id} plan={item.engagement_plan} />
                  </td>
                </tr>
              );
            })}
            {sent.length === 0 && (
              <tr>
                <td colSpan={7} className="px-2 py-8 text-center text-stone-500">
                  Nothing sent yet. <Link href={`/clients/${id}/push`} className="underline">Push some posts</Link> and they&apos;ll appear here.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

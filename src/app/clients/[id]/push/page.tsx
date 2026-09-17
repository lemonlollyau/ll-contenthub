import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { getClient } from "@/lib/clients";
import { db } from "@/lib/db";
import { planPosts } from "@/lib/push/prepare";
import type { Calendar } from "@/lib/types";
import { JobRunner, type JobView } from "@/components/job-runner";
import { PushForm } from "./push-form";

export default async function PushPage({ params, searchParams }: PageProps<"/clients/[id]/push">) {
  await requireUser();
  const { id } = await params;
  const sp = await searchParams;
  const client = await getClient(id);
  const calendars = ((await db().from("calendars").select("*").eq("client_id", id).not("imported_at", "is", null).order("month", { ascending: false })).data ?? []) as Calendar[];
  const calendar = calendars.find((c) => c.id === sp.calendar) ?? calendars[0];
  if (!calendar) return <p className="text-stone-500">Import a calendar first.</p>;

  const [plans, jobsRes, logsRes] = await Promise.all([
    planPosts(client, calendar.id),
    db().from("jobs").select("*").eq("client_id", id).in("kind", ["buffer_push", "render"]).order("created_at", { ascending: false }).limit(3),
    db().from("push_logs").select("*").eq("client_id", id).order("created_at", { ascending: false }).limit(15),
  ]);
  const jobs = ((jobsRes.data ?? []) as (JobView & { kind: string; params: { calendarId?: string } })[]).filter(
    (j) => j.params?.calendarId === calendar.id && ["queued", "running", "failed"].includes(j.status),
  );
  const platforms = [...new Set(plans.map((p) => p.platform))];
  const missing = plans.filter((p) => p.errors.some((e) => /image/i.test(e)));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-2">
        {calendars.map((c) => (
          <Link key={c.id} href={`?calendar=${c.id}`} className={`rounded-full px-3 py-1 text-sm ${c.id === calendar.id ? "bg-stone-900 text-white" : "border border-stone-300 bg-white"}`}>
            {new Date(`${c.month}T00:00:00Z`).toLocaleDateString("en-AU", { month: "short", year: "numeric", timeZone: "UTC" })}
          </Link>
        ))}
      </div>

      {jobs.map((j) => <JobRunner key={j.id} initial={j} label={j.kind === "render" ? "Preparing images" : "Sending to Buffer"} />)}

      {missing.length > 0 && (
        <section className="rounded-2xl border-2 border-red-200 bg-red-50 p-4">
          <h2 className="font-semibold text-red-800">Missing images ({missing.length})</h2>
          <p className="text-sm text-red-700">These can&apos;t be sent until an image is approved and prepared.</p>
          <ul className="mt-2 flex flex-wrap gap-2 text-sm">
            {missing.map((p) => (
              <li key={p.key}>
                <Link href={`/clients/${id}/review?calendar=${calendar.id}&show=all`} className="rounded bg-white px-2 py-0.5 text-red-800 underline">
                  #{p.rowNumber} {p.platform}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="rounded-2xl border border-stone-200 bg-white p-5">
        <h2 className="text-lg font-semibold">Send to Buffer</h2>
        <p className="text-sm text-stone-500">
          Times are converted from {client.timezone} to UTC. Posts already in Buffer are updated, not duplicated.
        </p>
        <PushForm
          clientId={id}
          calendarId={calendar.id}
          plans={plans.map((p) => ({
            key: p.key, rowNumber: p.rowNumber, platform: p.platform, channelName: p.channel?.channelName ?? null,
            format: p.format, date: p.date, time: p.time, timeRule: p.timeRule, text: p.text, media: p.media.map((m) => m.url),
            existing: !!p.existingPostId, errors: p.errors, warnings: p.warnings,
          }))}
        />
      </section>

      <section className="rounded-2xl border border-stone-200 bg-white p-5">
        <h2 className="text-lg font-semibold">CSV fallback (Buffer bulk upload)</h2>
        <p className="text-sm text-stone-500">
          One file per channel, max 100 posts each. Upload in Buffer: Publish → channel → ⚙ → General → Bulk Upload → <b>Save as Drafts</b>.
          Instagram posts without an image use the placeholder image{client.placeholder_image_url ? "" : " (none set in Settings!)"}.
        </p>
        <ul className="mt-3 space-y-2 text-sm">
          {platforms.map((pf) => {
            const rows = plans.filter((p) => p.platform === pf);
            const parts = Math.max(1, Math.ceil(rows.length / 100));
            const manual = rows.filter((p) => p.csvOnly);
            return (
              <li key={pf}>
                <span className="font-medium capitalize">{pf}</span> ({rows.length} posts):{" "}
                {Array.from({ length: parts }, (_, i) => (
                  <a key={i} href={`/api/clients/${id}/buffer-csv?calendar=${calendar.id}&platform=${pf}&part=${i + 1}`} className="mr-2 text-amber-700 underline">
                    Download{parts > 1 ? ` part ${i + 1}` : ""}
                  </a>
                ))}
                {manual.length > 0 && (
                  <span className="text-amber-800">
                    · Set up by hand after upload (bulk upload only does single images): {manual.map((m) => `#${m.rowNumber} ${m.csvOnly}`).join(", ")}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      </section>

      <section className="rounded-2xl border border-stone-200 bg-white p-5">
        <h2 className="text-lg font-semibold">Recent pushes</h2>
        <table className="mt-2 w-full text-xs">
          <tbody>
            {(logsRes.data ?? []).map((l) => (
              <tr key={l.id} className="border-t border-stone-100">
                <td className="py-1 pr-2 text-stone-500">{new Date(l.created_at).toLocaleString("en-AU")}</td>
                <td className="pr-2">{l.target} {l.action}</td>
                <td className={l.ok ? "text-green-700" : "text-red-700"}>{l.ok ? `OK ${l.response?.id ?? ""} (${l.response?.status ?? ""})` : l.error}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}

import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { AppShell } from "@/components/app-shell";

export default async function LogsPage({ searchParams }: PageProps<"/logs">) {
  const user = await requireUser();
  const sp = await searchParams;
  const onlyErrors = sp.errors === "1";
  let q = db().from("api_calls").select("*, clients(name)").order("created_at", { ascending: false }).limit(300);
  if (onlyErrors) q = q.eq("ok", false);
  const { data } = await q;
  return (
    <AppShell user={user}>
      <h1 className="text-2xl font-semibold">Activity log</h1>
      <p className="mt-1 text-sm text-stone-500">
        Every call to Google Drive, Claude and Buffer.{" "}
        <a href={onlyErrors ? "/logs" : "/logs?errors=1"} className="text-amber-700 underline">{onlyErrors ? "Show everything" : "Show only problems"}</a>
      </p>
      <div className="mt-4 overflow-x-auto rounded-xl border border-stone-200 bg-white">
        <table className="w-full text-xs">
          <thead className="bg-stone-50 text-left text-stone-500">
            <tr><th className="p-2">When</th><th>Client</th><th>Service</th><th>Action</th><th>Result</th><th>Time</th></tr>
          </thead>
          <tbody>
            {(data ?? []).map((r) => (
              <tr key={r.id} className="border-t border-stone-100 align-top">
                <td className="whitespace-nowrap p-2 text-stone-500">{new Date(r.created_at).toLocaleString("en-AU")}</td>
                <td className="pr-2">{(r.clients as { name: string } | null)?.name ?? "—"}</td>
                <td className="pr-2">{r.service}</td>
                <td className="pr-2">{r.operation}</td>
                <td className={`pr-2 ${r.ok ? "text-green-700" : "text-red-700"}`}>{r.ok ? "OK" : r.error}</td>
                <td className="pr-2 text-stone-400">{r.duration_ms != null ? `${r.duration_ms} ms` : ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </AppShell>
  );
}

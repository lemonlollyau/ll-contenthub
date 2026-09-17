import { type NextRequest } from "next/server";
import { requireUser } from "@/lib/auth";
import { getClient } from "@/lib/clients";
import { db } from "@/lib/db";
import { chunk, csvImageOk, csvPostingTime, toBufferCsv, type CsvRow } from "@/lib/push/csv";
import { planPosts } from "@/lib/push/prepare";

export async function GET(req: NextRequest, ctx: RouteContext<"/api/clients/[id]/buffer-csv">) {
  const user = await requireUser();
  const { id } = await ctx.params;
  const calendarId = req.nextUrl.searchParams.get("calendar") ?? "";
  const platform = req.nextUrl.searchParams.get("platform") ?? "";
  const part = Math.max(1, Number(req.nextUrl.searchParams.get("part") ?? 1));
  const client = await getClient(id);
  const cal = await db().from("calendars").select("month").eq("id", calendarId).eq("client_id", id).single();
  if (!cal.data) return new Response("Calendar not found", { status: 404 });

  const plans = (await planPosts(client, calendarId)).filter((p) => p.platform === platform && p.date && p.time);
  const rows: CsvRow[] = plans.map((p) => {
    const image = p.media.find((m) => m.kind === "image" && csvImageOk(m.url))?.url ?? "";
    return {
      text: p.text,
      imageUrl: image || (platform === "instagram" ? client.placeholder_image_url ?? "" : ""),
      postingTime: csvPostingTime(p.date!, p.time!),
    };
  });
  const pages = chunk(rows);
  const csv = toBufferCsv(pages[part - 1] ?? []);

  await db().from("push_logs").insert({
    client_id: id, target: "buffer_csv", action: "export", ok: true, created_by: user.email,
    request: { calendarId, platform, part }, response: { rows: pages[part - 1]?.length ?? 0 },
  });

  const month = new Date(`${cal.data.month}T00:00:00Z`).toLocaleDateString("en-AU", { month: "long", year: "numeric", timeZone: "UTC" }).replace(" ", "-");
  const name = `${client.name.replace(/\W+/g, "-")}-${month}-Buffer-${platform}${pages.length > 1 ? `-part${part}` : ""}.csv`;
  return new Response(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${name}"`,
      "cache-control": "no-store",
    },
  });
}

import { type NextRequest } from "next/server";
import { requireUser } from "@/lib/auth";
import { assembleText } from "@/lib/caption";
import { getClient } from "@/lib/clients";
import { db, must } from "@/lib/db";
import type { ContentItem } from "@/lib/types";

const HEADERS = ["Post #", "Date", "Platform", "Format", "Pillar", "Live URL", "Budget (AUD)", "Notes", "Text"] as const;
const quote = (v: string) => `"${String(v ?? "").replace(/"/g, '""')}"`;

/** The shortlist of posts to put paid budget behind, for Meta Ads Manager. */
export async function GET(req: NextRequest, ctx: RouteContext<"/api/clients/[id]/boost-csv">) {
  const user = await requireUser();
  const { id } = await ctx.params;
  const calendarId = req.nextUrl.searchParams.get("calendar");
  const client = await getClient(id);

  let q = db().from("content_items").select("*").eq("client_id", id).eq("boost", true).eq("type", "social").order("post_date");
  if (calendarId) q = q.eq("calendar_id", calendarId);
  const items = must(await q, "load boosted posts") as ContentItem[];

  const rows = items.map((i) =>
    [
      String(i.row_number ?? ""),
      i.post_date ?? "",
      i.channels.join(" + "),
      i.format ?? "",
      i.pillar ?? "",
      Object.values(i.published_urls ?? {}).join(" "),
      i.boost_budget != null ? String(i.boost_budget) : "",
      i.boost_notes ?? "",
      assembleText(i),
    ].map(quote).join(","),
  );
  const csv = "﻿" + [HEADERS.map(quote).join(","), ...rows].join("\r\n") + "\r\n";

  await db().from("push_logs").insert({
    client_id: id, target: "export", action: "boost_csv", ok: true, created_by: user.email,
    response: { rows: rows.length },
  });

  return new Response(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${client.name.replace(/\W+/g, "-")}-boost-shortlist.csv"`,
      "cache-control": "no-store",
    },
  });
}

import { NextResponse, type NextRequest } from "next/server";
import { getClient } from "@/lib/clients";
import { db, must } from "@/lib/db";
import { extRoute, todayIn } from "@/lib/ext-auth";
import { isCaptionLocked } from "@/lib/flags";
import type { ContentItem } from "@/lib/types";

/** A client's upcoming social posts from the calendar (from 3 days ago onwards, plus undated). */
export const GET = extRoute(async (req: NextRequest) => {
  const client = await getClient(req.nextUrl.searchParams.get("clientId") ?? "");
  const from = new Date(Date.parse(todayIn(client.timezone)) - 3 * 86400_000).toISOString().slice(0, 10);
  const items = must(
    await db()
      .from("content_items")
      .select("*")
      .eq("client_id", client.id)
      .eq("type", "social")
      .or(`post_date.gte.${from},post_date.is.null`)
      .order("post_date", { nullsFirst: false })
      .order("row_number")
      .limit(150),
    "load posts",
  ) as ContentItem[];
  return NextResponse.json({
    posts: items.map((i) => ({
      id: i.id,
      row: i.row_number,
      date: i.post_date,
      time: i.post_time?.slice(0, 5) ?? null,
      channels: i.channels,
      format: i.format,
      pillar: i.pillar,
      hook: i.hook,
      caption: i.caption,
      captionLocked: isCaptionLocked(i),
      cta: i.cta,
      hashtags: i.hashtags,
      firstComment: i.first_comment,
      assetBrief: i.asset_brief,
      moment: i.moment_offer,
      status: i.status,
      inBuffer: Object.keys(i.buffer_posts ?? {}),
      customMedia: i.custom_media ?? [],
    })),
  });
});

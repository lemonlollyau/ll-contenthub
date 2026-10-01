import { NextResponse, type NextRequest } from "next/server";
import { getClient } from "@/lib/clients";
import { extRoute } from "@/lib/ext-auth";
import { upcomingPosts } from "@/lib/studio";

/** A client's upcoming social posts from the calendar (from 3 days ago onwards, plus undated). */
export const GET = extRoute(async (req: NextRequest) => {
  const client = await getClient(req.nextUrl.searchParams.get("clientId") ?? "");
  return NextResponse.json({ posts: await upcomingPosts(client) });
});

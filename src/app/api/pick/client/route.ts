import { NextResponse, type NextRequest } from "next/server";
import { getClient } from "@/lib/clients";
import { pickRoute } from "@/lib/pick-auth";
import { libraryFolders, openPicks, upcomingPosts } from "@/lib/studio";

/** Everything the Pick page needs when a client is chosen. */
export const GET = pickRoute(async (req: NextRequest) => {
  const client = await getClient(req.nextUrl.searchParams.get("clientId") ?? "");
  const [posts, folders, picks] = await Promise.all([upcomingPosts(client), libraryFolders(client.id), openPicks(client.id)]);
  return NextResponse.json({ posts, folders, picks, hasDrive: !!client.drive_folder_id });
});

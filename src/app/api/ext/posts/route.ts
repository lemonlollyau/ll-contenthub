import { NextResponse, type NextRequest } from "next/server";
import { getClient } from "@/lib/clients";
import { extRoute } from "@/lib/ext-auth";
import { postPhotos, upcomingPosts } from "@/lib/studio";

/**
 * A client's upcoming social posts from the calendar (from 3 days ago onwards,
 * plus undated), each with the Drive photos approved for it (on the phone or
 * the review board) so the extension can drop them straight into its tray.
 */
export const GET = extRoute(async (req: NextRequest) => {
  const client = await getClient(req.nextUrl.searchParams.get("clientId") ?? "");
  const posts = await upcomingPosts(client);
  const photos = await postPhotos(posts.map((p) => p.id), false);
  return NextResponse.json({
    posts: posts.map((p) => ({
      ...p,
      photos: (photos[p.id] ?? [])
        .filter((x) => x.driveFileId && (x.state === "approved" || x.state === "swapped"))
        .map((x) => ({ driveFileId: x.driveFileId, name: x.name, thumb: x.thumb })),
    })),
  });
});

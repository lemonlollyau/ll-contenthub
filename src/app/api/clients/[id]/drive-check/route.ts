import { NextResponse, type NextRequest } from "next/server";
import { requireUser } from "@/lib/auth";
import { getClient } from "@/lib/clients";
import { db } from "@/lib/db";
import { assetKind, FOLDER_MIME, listFolderPage } from "@/lib/google-drive";
import { errorMessage } from "@/lib/log";

export const maxDuration = 60;

const MAX_FILES = 5000; // a sanity stop for very large folders

/**
 * Compares the client's Drive folder with what's already indexed, so the UI can
 * nudge: "Drive has N files you haven't synced". Read-only and cheap enough to
 * run on page load; it only lists metadata, it doesn't download anything.
 */
export async function GET(_req: NextRequest, ctx: RouteContext<"/api/clients/[id]/drive-check">) {
  await requireUser();
  const { id } = await ctx.params;
  const client = await getClient(id);
  if (!client.drive_folder_id) return NextResponse.json({ ok: false, message: "No Drive folder set." });

  try {
    const known = new Map(
      ((await db().from("assets").select("drive_file_id, md5").eq("client_id", id).is("removed_at", null)).data ?? []).map(
        (a) => [a.drive_file_id as string, a.md5 as string | null],
      ),
    );

    const queue = [client.drive_folder_id];
    const seen = new Set(queue);
    let total = 0;
    let added = 0;
    let changed = 0;
    let found = 0;

    while (queue.length && found < MAX_FILES) {
      const folderId = queue.shift()!;
      let pageToken: string | undefined;
      do {
        const page = await listFolderPage(folderId, pageToken, id);
        for (const f of page.files) {
          const isFolder = f.mimeType === FOLDER_MIME || f.shortcutDetails?.targetMimeType === FOLDER_MIME;
          if (isFolder) {
            const target = f.shortcutDetails?.targetId ?? f.id;
            if (!seen.has(target)) {
              seen.add(target);
              queue.push(target);
            }
            continue;
          }
          if (!assetKind(f) || f.shortcutDetails) continue;
          found += 1;
          total += 1;
          if (!known.has(f.id)) added += 1;
          else {
            const stamp = f.md5Checksum ?? f.modifiedTime ?? null;
            if (stamp && known.get(f.id) !== stamp) changed += 1;
          }
        }
        pageToken = page.nextPageToken;
      } while (pageToken && found < MAX_FILES);
    }

    const removed = Math.max(0, known.size - (total - added));
    const last = (await db().from("jobs").select("created_at").eq("client_id", id).eq("kind", "drive_index").eq("status", "done").order("created_at", { ascending: false }).limit(1)).data?.[0];
    return NextResponse.json({ ok: true, total, added, changed, removed, inLibrary: known.size, lastSync: last?.created_at ?? null });
  } catch (err) {
    return NextResponse.json({ ok: false, message: errorMessage(err) });
  }
}

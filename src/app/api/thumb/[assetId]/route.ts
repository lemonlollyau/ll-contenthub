import { NextResponse, type NextRequest } from "next/server";
import { getUser } from "@/lib/auth";
import { config } from "@/lib/config";
import { db } from "@/lib/db";
import { downloadThumbnail, getFile } from "@/lib/google-drive";
import { thumbnail } from "@/lib/images";
import { signedThumbs } from "@/lib/thumbs";

export const maxDuration = 30;

/**
 * A library photo's preview. Photos get a thumbnail when Claude tags them, but
 * tagging thousands takes a while, so untagged photos get one straight from
 * Drive's own preview (which also turns HEIC into something phones can show).
 * It's saved, so each photo only does this once.
 */
export async function GET(_req: NextRequest, ctx: RouteContext<"/api/thumb/[assetId]">) {
  if (!(await getUser())) return new NextResponse("Please sign in again.", { status: 401 });
  const { assetId } = await ctx.params;
  const { data: asset } = await db().from("assets").select("id, client_id, drive_file_id, thumbnail_path").eq("id", assetId).maybeSingle();
  if (!asset) return new NextResponse("Not found", { status: 404 });

  if (asset.thumbnail_path) {
    const url = (await signedThumbs([asset.thumbnail_path]))[asset.thumbnail_path];
    if (url) return NextResponse.redirect(url, { status: 302 });
  }

  try {
    const meta = await getFile(asset.drive_file_id, asset.client_id);
    const source = meta.thumbnailLink ? await downloadThumbnail(meta.thumbnailLink) : null;
    if (!source) return new NextResponse("Drive has no preview for this file yet.", { status: 404 });
    const webp = await thumbnail(source);
    const path = `${asset.client_id}/${asset.id}.webp`;
    const up = await db().storage.from(config.storage.thumbsBucket).upload(path, webp, { contentType: "image/webp", upsert: true });
    if (!up.error) await db().from("assets").update({ thumbnail_path: path }).eq("id", asset.id);
    return new NextResponse(new Uint8Array(webp), { headers: { "content-type": "image/webp", "cache-control": "private, max-age=86400" } });
  } catch {
    return new NextResponse("Couldn't load a preview from Drive.", { status: 502 });
  }
}

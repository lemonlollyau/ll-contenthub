import { type NextRequest } from "next/server";
import { extRoute } from "@/lib/ext-auth";
import { downloadFile, getFile } from "@/lib/google-drive";
import { decodable, pipeline } from "@/lib/images";

export const maxDuration = 60;

/**
 * Fetches a Drive image through the read-only service account and returns an
 * upright JPEG (long edge 2160px) the extension can draw on. Works for any file
 * in a folder shared with the service account, synced to the library or not.
 */
export const GET = extRoute(async (req: NextRequest, ctx: RouteContext<"/api/ext/drive/[fileId]">) => {
  const { fileId } = await ctx.params;
  const clientId = req.nextUrl.searchParams.get("clientId") || undefined;
  const file = await getFile(fileId, clientId).catch(() => {
    throw new Error("Content Hub can't open that Drive file. Check it's in a folder shared with the service account.");
  });
  if (!/^image\//.test(file.mimeType)) throw new Error(`"${file.name}" isn't an image.`);
  const source = await decodable(await downloadFile(fileId, clientId), file.mimeType, file.name);
  const jpeg = await pipeline(source)
    .resize(2160, 2160, { fit: "inside", withoutEnlargement: true })
    .flatten({ background: "#ffffff" })
    .jpeg({ quality: 86, mozjpeg: true })
    .toBuffer();
  return new Response(new Uint8Array(jpeg), {
    headers: { "content-type": "image/jpeg", "x-file-name": encodeURIComponent(file.name), "cache-control": "private, max-age=300" },
  });
});

import { randomUUID } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { getClient } from "@/lib/clients";
import { config } from "@/lib/config";
import { extRoute } from "@/lib/ext-auth";
import { todayIn } from "@/lib/studio";
import { pipeline } from "@/lib/images";
import { publicUrl } from "@/lib/render";
import { db } from "@/lib/db";

export const maxDuration = 60;

// Vercel caps request bodies at 4.5 MB; the extension exports well under that.
const MAX_BYTES = 4_400_000;

/**
 * Stores one finished slide from the extension in the public "rendered"
 * bucket so Buffer can fetch it. Re-encoded server-side, which also strips
 * any metadata (including location).
 */
export const POST = extRoute(async (req: NextRequest) => {
  const form = await req.formData();
  const client = await getClient(String(form.get("clientId") ?? ""));
  const file = form.get("file");
  if (!(file instanceof Blob)) throw new Error("No image was sent.");
  if (file.size > MAX_BYTES) throw new Error("That image is over 4.4 MB. Export it smaller and try again.");

  const data = await pipeline(Buffer.from(await file.arrayBuffer()))
    .flatten({ background: "#ffffff" })
    .jpeg({ quality: 90, mozjpeg: true, progressive: true })
    .toBuffer();
  const path = `${client.slug}/studio/${todayIn(client.timezone).slice(0, 7)}/${randomUUID()}.jpg`;
  const up = await db().storage.from(config.storage.renderedBucket).upload(path, data, { contentType: "image/jpeg", cacheControl: "3600" });
  if (up.error) throw new Error(`Couldn't store the image: ${up.error.message}`);
  return NextResponse.json({ url: publicUrl(path), bytes: data.length });
});

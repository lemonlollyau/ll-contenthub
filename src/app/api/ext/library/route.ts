import { NextResponse, type NextRequest } from "next/server";
import { getClient } from "@/lib/clients";
import { db, must } from "@/lib/db";
import { extRoute } from "@/lib/ext-auth";
import { signedThumbs } from "@/lib/thumbs";
import type { Asset } from "@/lib/types";

/** Searches a client's synced Drive library (images only). */
export const GET = extRoute(async (req: NextRequest) => {
  const client = await getClient(req.nextUrl.searchParams.get("clientId") ?? "");
  const q = (req.nextUrl.searchParams.get("q") ?? "").trim().toLowerCase();
  let query = db()
    .from("assets")
    .select("id, drive_file_id, folder_path, name, width, height, thumbnail_path, ai_description")
    .eq("client_id", client.id)
    .eq("kind", "image")
    .is("removed_at", null);
  for (const word of q.split(/\s+/).filter(Boolean).slice(0, 5)) {
    query = query.ilike("search_text", `%${word.replace(/[%_]/g, "")}%`);
  }
  const assets = must(await query.order("drive_modified_at", { ascending: false }).limit(60), "search the library") as Pick<
    Asset, "id" | "drive_file_id" | "folder_path" | "name" | "width" | "height" | "thumbnail_path" | "ai_description"
  >[];
  const thumbs = await signedThumbs(assets.map((a) => a.thumbnail_path));
  return NextResponse.json({
    assets: assets.map((a) => ({
      id: a.id,
      driveFileId: a.drive_file_id,
      name: a.name,
      folder: a.folder_path,
      width: a.width,
      height: a.height,
      description: a.ai_description,
      thumb: a.thumbnail_path ? thumbs[a.thumbnail_path] ?? null : null,
    })),
  });
});

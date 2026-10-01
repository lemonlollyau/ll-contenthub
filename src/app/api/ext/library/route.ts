import { NextResponse, type NextRequest } from "next/server";
import { getClient } from "@/lib/clients";
import { extRoute } from "@/lib/ext-auth";
import { searchLibrary } from "@/lib/studio";

/** Searches a client's synced Drive library (images only). */
export const GET = extRoute(async (req: NextRequest) => {
  const client = await getClient(req.nextUrl.searchParams.get("clientId") ?? "");
  return NextResponse.json({ assets: await searchLibrary(client.id, { q: req.nextUrl.searchParams.get("q") ?? "", driveFallback: false }) });
});

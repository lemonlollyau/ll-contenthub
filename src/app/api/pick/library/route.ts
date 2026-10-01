import { NextResponse, type NextRequest } from "next/server";
import { getClient } from "@/lib/clients";
import { pickRoute } from "@/lib/pick-auth";
import { searchLibrary } from "@/lib/studio";

export const GET = pickRoute(async (req: NextRequest) => {
  const sp = req.nextUrl.searchParams;
  const client = await getClient(sp.get("clientId") ?? "");
  const assets = await searchLibrary(client.id, { q: sp.get("q") ?? "", folder: sp.get("folder") ?? "*", limit: 120 });
  return NextResponse.json({ assets });
});

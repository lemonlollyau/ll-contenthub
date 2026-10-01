import { NextResponse, type NextRequest } from "next/server";
import { getClient } from "@/lib/clients";
import { extRoute } from "@/lib/ext-auth";
import { openPicks } from "@/lib/studio";

/** Photos picked on the phone that haven't been pulled into the extension yet. */
export const GET = extRoute(async (req: NextRequest) => {
  const client = await getClient(req.nextUrl.searchParams.get("clientId") ?? "");
  return NextResponse.json({ picks: await openPicks(client.id) });
});

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { extRoute } from "@/lib/ext-auth";
import { markPicksUsed } from "@/lib/studio";

const Body = z.object({ clientId: z.string().uuid(), ids: z.array(z.string().uuid()).max(200) });

/** The extension has pulled these picks into its tray, so they leave the phone inbox. */
export const POST = extRoute(async (req: NextRequest) => {
  const body = Body.parse(await req.json());
  await markPicksUsed(body.clientId, body.ids);
  return NextResponse.json({ ok: true });
});

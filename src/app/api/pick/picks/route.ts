import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { pickRoute } from "@/lib/pick-auth";
import { pickAssets, removePick } from "@/lib/studio";

const Body = z.object({
  clientId: z.string().uuid(),
  postId: z.string().uuid().nullable(),
  assetIds: z.array(z.string().uuid()).min(1).max(30),
  note: z.string().max(500).optional(),
});

/** Sends library photos to the Studio inbox for a post. */
export const POST = pickRoute(async (req: NextRequest, user) => {
  const body = Body.parse(await req.json());
  const count = await pickAssets(body.clientId, body.postId, body.assetIds, user.email, body.note ?? "");
  return NextResponse.json({ count });
});

export const DELETE = pickRoute(async (req: NextRequest) => {
  const sp = req.nextUrl.searchParams;
  await removePick(sp.get("clientId") ?? "", sp.get("id") ?? "");
  return NextResponse.json({ ok: true });
});

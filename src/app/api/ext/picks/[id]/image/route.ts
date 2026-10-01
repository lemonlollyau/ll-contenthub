import { type NextRequest } from "next/server";
import { extRoute } from "@/lib/ext-auth";
import { pickImage } from "@/lib/studio";

/** The bytes of a camera-roll photo picked on the phone. */
export const GET = extRoute(async (req: NextRequest, ctx: RouteContext<"/api/ext/picks/[id]/image">) => {
  const { id } = await ctx.params;
  const data = await pickImage(req.nextUrl.searchParams.get("clientId") ?? "", id);
  return new Response(new Uint8Array(data), { headers: { "content-type": "image/jpeg", "cache-control": "private, max-age=300" } });
});

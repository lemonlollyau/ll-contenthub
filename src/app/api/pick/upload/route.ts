import { NextResponse, type NextRequest } from "next/server";
import { getClient } from "@/lib/clients";
import { pickRoute } from "@/lib/pick-auth";
import { pickUpload } from "@/lib/studio";

export const maxDuration = 60;

/** One camera-roll photo from the phone (already shrunk in the browser to stay under Vercel's 4.5 MB limit). */
export const POST = pickRoute(async (req: NextRequest, user) => {
  const form = await req.formData();
  const client = await getClient(String(form.get("clientId") ?? ""));
  const file = form.get("file");
  if (!(file instanceof Blob)) throw new Error("No photo was sent.");
  if (file.size > 4_400_000) throw new Error("That photo is too big to send. Try again; it should shrink automatically.");
  const postId = String(form.get("postId") ?? "") || null;
  await pickUpload(client, postId, file, String(form.get("label") ?? ""), user.email, String(form.get("note") ?? ""));
  return NextResponse.json({ ok: true });
});

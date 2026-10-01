"use server";
import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { getClient } from "@/lib/clients";
import { db, must } from "@/lib/db";
import { createJob } from "@/lib/jobs";
import { initialMatchStateForItems } from "@/lib/matching/match-job";
import { removePick, upcomingPosts } from "@/lib/studio";

// Phone page actions. Approving and swapping photos reuse the review board's
// actions (src/app/clients/[id]/review/actions.ts) so both stay identical.

export type PhoneResult = { ok: boolean; message: string };

export async function choosePhoneClient(clientId: string) {
  await requireUser();
  (await cookies()).set("pick_client", clientId, { path: "/pick", maxAge: 60 * 60 * 24 * 365, sameSite: "lax", secure: true, httpOnly: true });
  revalidatePath("/pick");
}

/** Auto-match photos for upcoming posts that don't have any yet. */
export async function matchUpcoming(clientId: string): Promise<PhoneResult> {
  await requireUser();
  const client = await getClient(clientId);
  const tagged = await db().from("assets").select("id", { count: "exact", head: true })
    .eq("client_id", clientId).is("removed_at", null).not("ai_description", "is", null);
  if (!tagged.count) return { ok: false, message: "No tagged photos yet. Tap Sync Drive first and wait for tagging to finish." };

  const posts = (await upcomingPosts(client)).filter((p) => !(p.format === "text" && !p.channels.includes("instagram")));
  const ids = posts.map((p) => p.id);
  const withPhotos = new Set(
    (must(await db().from("asset_matches").select("content_item_id").in("content_item_id", ids.length ? ids : ["00000000-0000-0000-0000-000000000000"]), "check posts") as {
      content_item_id: string;
    }[]).map((r) => r.content_item_id),
  );
  const queue = ids.filter((id) => !withPhotos.has(id));
  if (!queue.length) return { ok: true, message: "Every upcoming post already has a photo." };
  await createJob("match", clientId, { source: "phone" }, await initialMatchStateForItems(clientId, queue));
  revalidatePath("/pick");
  return { ok: true, message: `Finding photos for ${queue.length} post${queue.length === 1 ? "" : "s"}…` };
}

export async function removePhonePick(clientId: string, pickId: string) {
  await requireUser();
  await removePick(clientId, pickId);
  revalidatePath("/pick");
}

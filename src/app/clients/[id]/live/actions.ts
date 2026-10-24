"use server";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { getClient } from "@/lib/clients";
import { db, must } from "@/lib/db";
import { generateEngagementPlan } from "@/lib/engagement";
import { createJob } from "@/lib/jobs";
import { friendlyClaudeError } from "@/lib/claude";
import { initialRefreshState } from "@/lib/push/refresh-job";
import type { ContentItem, EngagementPlan } from "@/lib/types";

export async function startRefresh(clientId: string) {
  await requireUser();
  const state = await initialRefreshState(clientId);
  await createJob("refresh", clientId, {}, state);
  revalidatePath(`/clients/${clientId}/live`);
}

export async function planEngagement(clientId: string, itemId: string): Promise<{ ok: boolean; message: string; plan?: EngagementPlan }> {
  await requireUser();
  try {
    const client = await getClient(clientId);
    const item = must(
      await db().from("content_items").select("*").eq("id", itemId).eq("client_id", clientId).single(),
      "load the post",
    ) as ContentItem;
    const plan = await generateEngagementPlan(client, item);
    revalidatePath(`/clients/${clientId}/live`);
    return { ok: true, message: "Plan ready.", plan };
  } catch (err) {
    return { ok: false, message: friendlyClaudeError(err) };
  }
}

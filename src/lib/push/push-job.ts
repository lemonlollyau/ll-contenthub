import "server-only";
import { db, must } from "../db";
import type { Job, StepResult } from "../jobs";
import { errorMessage } from "../log";
import type { Client } from "../types";
import { planPosts, type PlannedPost } from "./prepare";
import { isRateLimit, providerInfo, providerKey, publish } from "./provider";

// Sends planned posts to the client's provider (Buffer or ContentStudio) a few
// at a time. Drafts unless the person explicitly chose to schedule for this
// push. Re-pushing edits the post we created last time instead of duplicating it.

type PushState = { queue: string[]; sent: number; updated: number; failed: number; errors: string[]; provider?: string };
export type PushParams = { calendarId: string; saveToDraft: boolean; by: string };

const PER_STEP = 4;

export async function pushStep(job: Job): Promise<StepResult<PushState>> {
  const state = job.state as unknown as PushState;
  const params = job.params as unknown as PushParams;
  const total = state.sent + state.updated + state.failed + state.queue.length;
  if (!state.queue.length) {
    return {
      state, total, done: total, finished: true,
      message: `${params.saveToDraft ? "Drafts" : "Scheduled posts"} in ${state.provider ?? "Buffer"}: ${state.sent} new, ${state.updated} updated.` +
        (state.failed ? ` ${state.failed} failed: ${state.errors.slice(0, 3).join(" · ")}` : ""),
    };
  }

  const client = must(await db().from("clients").select("*").eq("id", job.client_id!).single(), "load client") as Client;
  const provider = providerInfo(client);
  if (!provider.ready) throw new Error(provider.missing!);
  state.provider = provider.label;
  const apiKey = providerKey(client);
  // Re-plan so any edits since the preview are respected, and re-check every rule.
  const plans = new Map((await planPosts(client, params.calendarId)).map((p) => [p.key, p]));

  const batch = state.queue.slice(0, PER_STEP);
  for (const key of batch) {
    const plan = plans.get(key);
    try {
      if (!plan) throw new Error("This post is no longer in the calendar.");
      const action = await sendPlan(client, apiKey, plan, params.saveToDraft, params.by);
      if (action === "update") state.updated += 1;
      else state.sent += 1;
    } catch (err) {
      const message = errorMessage(err);
      if (isRateLimit(err)) {
        // Stop here; everything still queued can be resumed later.
        state.queue = state.queue.slice(batch.indexOf(key));
        throw new Error(message);
      }
      state.failed += 1;
      state.errors.push(`#${plan?.rowNumber ?? "?"} ${plan?.platform ?? ""}: ${message}`);
      if (!plan) {
        await db().from("push_logs").insert({ client_id: client.id, target: provider.id, action: "create", ok: false, error: message, created_by: params.by });
      }
    }
  }
  state.queue = state.queue.slice(batch.length);
  const done = state.sent + state.updated + state.failed;
  return { state, total, done, finished: false, message: `Sending to ${provider.label}… ${done} of ${total}` };
}

/**
 * Sends one planned post to the client's provider (creating it, or replacing the
 * one we created last time), saves the returned post id straight away and logs
 * the result. Throws on any failure, after logging it. Shared by the calendar
 * push and the Chrome extension.
 */
export async function sendPlan(client: Client, apiKey: string, plan: PlannedPost, saveToDraft: boolean, by: string): Promise<"create" | "update"> {
  const target = client.push_provider;
  try {
    if (plan.errors.length) throw new Error(plan.errors.join(" "));
    const result = await publish(client, apiKey, plan, saveToDraft);

    // Save the provider's post id immediately so a retry never duplicates.
    const item = must(await db().from("content_items").select("external_posts, channels").eq("id", plan.itemId).single(), "load post") as {
      external_posts: Record<string, string>; channels: string[];
    };
    const externalPosts = { ...item.external_posts, [plan.platform]: result.id };
    const allDone = item.channels.every((c) => externalPosts[c]);
    must(
      await db().from("content_items").update({ external_posts: externalPosts, ...(allDone && { status: "pushed" }) }).eq("id", plan.itemId).select("id"),
      "save the post id",
    );
    await db().from("push_logs").insert({
      client_id: client.id, content_item_id: plan.itemId, target, action: result.action, ok: true,
      request: { ...(result.request as object), text: plan.text.slice(0, 300) },
      response: { id: result.id, status: result.status }, created_by: by,
    });
    return result.action;
  } catch (err) {
    await db().from("push_logs").insert({
      client_id: client.id, content_item_id: plan.itemId, target, action: plan.existingPostId ? "update" : "create",
      ok: false, error: errorMessage(err), created_by: by,
    });
    throw err;
  }
}

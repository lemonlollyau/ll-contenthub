import "server-only";
import { BufferError, createPost, editPost, postMetadata, type PostInput } from "../buffer";
import { decryptSecret } from "../crypto";
import { db, must } from "../db";
import type { Job, StepResult } from "../jobs";
import { errorMessage } from "../log";
import type { Client } from "../types";
import { planPosts } from "./prepare";

// Sends planned posts to Buffer a few at a time. Drafts unless the person
// explicitly chose to schedule for this push. Re-pushing edits the existing
// Buffer post (by stored id) instead of creating a duplicate.

type PushState = { queue: string[]; sent: number; updated: number; failed: number; errors: string[] };
export type PushParams = { calendarId: string; saveToDraft: boolean; by: string };

const PER_STEP = 4;

export async function pushStep(job: Job): Promise<StepResult<PushState>> {
  const state = job.state as unknown as PushState;
  const params = job.params as unknown as PushParams;
  const total = state.sent + state.updated + state.failed + state.queue.length;
  if (!state.queue.length) {
    return {
      state, total, done: total, finished: true,
      message: `${params.saveToDraft ? "Drafts" : "Scheduled posts"} in Buffer: ${state.sent} new, ${state.updated} updated.` +
        (state.failed ? ` ${state.failed} failed: ${state.errors.slice(0, 3).join(" · ")}` : ""),
    };
  }

  const client = must(await db().from("clients").select("*").eq("id", job.client_id!).single(), "load client") as Client;
  if (!client.buffer_api_key_enc) throw new Error("This client has no Buffer API key. Add one in Settings.");
  const apiKey = decryptSecret(client.buffer_api_key_enc);
  // Re-plan so any edits since the preview are respected, and re-check every rule.
  const plans = new Map((await planPosts(client, params.calendarId)).map((p) => [p.key, p]));

  const batch = state.queue.slice(0, PER_STEP);
  for (const key of batch) {
    const plan = plans.get(key);
    try {
      if (!plan) throw new Error("This post is no longer in the calendar.");
      if (plan.errors.length) throw new Error(plan.errors.join(" "));
      const input: PostInput = {
        channelId: plan.channel!.channelId,
        text: plan.text,
        dueAt: plan.dueAt!,
        assets: plan.media.map((m) =>
          m.kind === "video" ? { video: { url: m.url } } : { image: { url: m.url, ...(m.altText && { metadata: { altText: m.altText } }) } },
        ),
        metadata: postMetadata(plan.platform, plan.format, plan.firstComment),
        saveToDraft: params.saveToDraft,
      };

      let result: { id: string; status: string };
      let action: "create" | "update" = "create";
      if (plan.existingPostId) {
        try {
          result = await editPost(apiKey, plan.existingPostId, input, client.id);
          action = "update";
        } catch (err) {
          // Deleted in Buffer since the last push: create it again.
          if (err instanceof BufferError && (err.code === "NOT_FOUND" || /not found/i.test(err.message))) {
            result = await createPost(apiKey, input, client.id);
          } else throw err;
        }
      } else {
        result = await createPost(apiKey, input, client.id);
      }

      // Save the Buffer id immediately so a retry never duplicates.
      const item = must(await db().from("content_items").select("buffer_posts, channels").eq("id", plan.itemId).single(), "load post") as {
        buffer_posts: Record<string, string>; channels: string[];
      };
      const bufferPosts = { ...item.buffer_posts, [plan.platform]: result.id };
      const allDone = item.channels.every((c) => bufferPosts[c]);
      must(
        await db().from("content_items").update({ buffer_posts: bufferPosts, ...(allDone && { status: "pushed" }) }).eq("id", plan.itemId).select("id"),
        "save the Buffer post id",
      );
      await db().from("push_logs").insert({
        client_id: client.id, content_item_id: plan.itemId, target: "buffer", action, ok: true,
        request: { ...input, text: input.text.slice(0, 300) }, response: result, created_by: params.by,
      });
      if (action === "update") state.updated += 1;
      else state.sent += 1;
    } catch (err) {
      const message = errorMessage(err);
      if (err instanceof BufferError && err.code === "RATE_LIMIT_EXCEEDED") {
        // Stop here; everything still queued can be resumed later.
        state.queue = state.queue.slice(batch.indexOf(key));
        await db().from("push_logs").insert({ client_id: client.id, content_item_id: plan?.itemId ?? null, target: "buffer", action: "create", ok: false, error: message, created_by: params.by });
        throw new Error(message);
      }
      state.failed += 1;
      state.errors.push(`#${plan?.rowNumber ?? "?"} ${plan?.platform ?? ""}: ${message}`);
      await db().from("push_logs").insert({
        client_id: client.id, content_item_id: plan?.itemId ?? null, target: "buffer", action: plan?.existingPostId ? "update" : "create",
        ok: false, error: message, created_by: params.by,
      });
    }
  }
  state.queue = state.queue.slice(batch.length);
  const done = state.sent + state.updated + state.failed;
  return { state, total, done, finished: false, message: `Sending to Buffer… ${done} of ${total}` };
}

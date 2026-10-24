import "server-only";
import { db, must } from "../db";
import type { Job, StepResult } from "../jobs";
import { errorMessage } from "../log";
import type { Client, ContentItem } from "../types";
import { fetchState, isRateLimit, loadConnections, routeFor } from "./provider";

// Checks back on posts we've sent: did they publish, where are they live, and
// what are the numbers. Runs in small batches like every other long job.

type RefreshState = { queue: string[]; updated: number; live: number; failed: number; errors: string[] };
const PER_STEP = 5;

export async function initialRefreshState(clientId: string): Promise<RefreshState> {
  const items = must(
    await db().from("content_items").select("id, external_posts").eq("client_id", clientId).eq("type", "social"),
    "load sent posts",
  ) as Pick<ContentItem, "id" | "external_posts">[];
  return {
    queue: items.filter((i) => Object.keys(i.external_posts ?? {}).length).map((i) => i.id),
    updated: 0,
    live: 0,
    failed: 0,
    errors: [],
  };
}

export async function refreshStep(job: Job): Promise<StepResult<RefreshState>> {
  const state = job.state as unknown as RefreshState;
  const total = state.updated + state.failed + state.queue.length;
  if (!state.queue.length) {
    return {
      state, total, done: total, finished: true,
      message: `Checked ${state.updated} post(s); ${state.live} are live.` + (state.failed ? ` ${state.failed} couldn't be read.` : ""),
    };
  }

  const client = must(await db().from("clients").select("*").eq("id", job.client_id!).single(), "load client") as Client;
  const connections = await loadConnections();

  const ids = state.queue.slice(0, PER_STEP);
  const items = must(await db().from("content_items").select("id, row_number, external_posts, published_urls, metrics").in("id", ids), "load posts") as
    Pick<ContentItem, "id" | "row_number" | "external_posts" | "published_urls" | "metrics">[];

  for (const item of items) {
    try {
      const states = [];
      for (const [platform, postId] of Object.entries(item.external_posts ?? {})) {
        const route = routeFor(client, platform, connections);
        if (!route.connection || !route.channel) continue;
        const state = await fetchState(route.connection, route.channel, platform, postId, client.id);
        if (state) states.push(state);
      }
      const urls = { ...item.published_urls };
      const metrics = { ...item.metrics };
      let publishedAt: string | null = null;
      for (const s of states) {
        if (s.publishedUrl) urls[s.platform] = s.publishedUrl;
        if (Object.keys(s.metrics).length) metrics[s.platform] = { ...s.metrics, checked_at: new Date().toISOString() };
        if (s.publishedAt && (!publishedAt || s.publishedAt < publishedAt)) publishedAt = s.publishedAt;
      }
      const live = Object.keys(urls).length > 0;
      must(
        await db().from("content_items").update({
          published_urls: urls,
          metrics,
          metrics_at: new Date().toISOString(),
          ...(publishedAt && { published_at: publishedAt }),
        }).eq("id", item.id).select("id"),
        "save the post's live details",
      );
      state.updated += 1;
      if (live) state.live += 1;
    } catch (err) {
      if (isRateLimit(err)) {
        state.queue = state.queue.slice(state.queue.indexOf(item.id));
        throw new Error(errorMessage(err));
      }
      state.failed += 1;
      state.errors.push(`#${item.row_number ?? "?"}: ${errorMessage(err)}`);
    }
  }

  state.queue = state.queue.slice(ids.length);
  const done = state.updated + state.failed;
  return { state, total, done, finished: false, message: `Checking posts… ${done} of ${total}` };
}

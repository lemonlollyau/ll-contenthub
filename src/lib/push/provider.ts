import "server-only";
import { BufferError, createPost as bufferCreate, editPost as bufferEdit, postMetadata } from "../buffer";
import {
  ContentStudioError, createPost as csCreate, csMediaPlan, updatePost as csUpdate, type CsPostInput,
} from "../contentstudio";
import { decryptSecret } from "../crypto";
import { db, must } from "../db";
import { formatInZone } from "../tz";
import { PROVIDER_LABEL, type ChannelMapping, type Client, type PushConnection } from "../types";
import type { PlannedPost } from "./prepare";

// A client's channels can live in different places: your agency Buffer, the
// client's own Buffer, a ContentStudio workspace. Each mapped channel names the
// connection it belongs to, and this module is the only place that knows how
// the two providers differ.

export async function loadConnections(): Promise<Map<string, PushConnection>> {
  const rows = must(await db().from("push_connections").select("*").order("name"), "load connections") as PushConnection[];
  return new Map(rows.map((c) => [c.id, c]));
}

export function connectionKey(connection: PushConnection): string {
  return decryptSecret(connection.api_key_enc);
}

export type ChannelRoute = {
  platform: string;
  channel: ChannelMapping | null;
  connection: PushConnection | null;
  /** Why this platform can't be published to, in plain English. */
  problem: string | null;
};

export function routeFor(client: Client, platform: string, connections: Map<string, PushConnection>): ChannelRoute {
  const channel = (client.channels ?? []).find((c) => c.platform === platform) ?? null;
  if (!channel) {
    return { platform, channel: null, connection: null, problem: `No ${platform} channel mapped. Map it in Settings.` };
  }
  const connection = connections.get(channel.connectionId) ?? null;
  if (!connection) {
    return { platform, channel, connection: null, problem: `The connection for ${platform} has been deleted. Re-map it in Settings.` };
  }
  if (connection.provider === "contentstudio" && !connection.workspace_id) {
    return { platform, channel, connection, problem: `"${connection.name}" has no ContentStudio workspace chosen.` };
  }
  return { platform, channel, connection, problem: null };
}

/** Which services this client publishes through, for labelling screens. */
export function providersUsed(client: Client, connections: Map<string, PushConnection>): string[] {
  const names = new Set<string>();
  for (const c of client.channels ?? []) {
    const conn = connections.get(c.connectionId);
    if (conn) names.add(PROVIDER_LABEL[conn.provider]);
  }
  return [...names];
}

export function providerLabelFor(client: Client, connections: Map<string, PushConnection>): string {
  const used = providersUsed(client, connections);
  return used.length === 1 ? used[0] : used.length ? used.join(" & ") : "Buffer";
}

/** True when the error means "wait and resume", so a push job can stop cleanly. */
export function isRateLimit(err: unknown): err is BufferError | ContentStudioError {
  return (err instanceof BufferError || err instanceof ContentStudioError) && err.code === "RATE_LIMIT_EXCEEDED";
}

function isMissingPost(err: unknown): boolean {
  if (err instanceof BufferError || err instanceof ContentStudioError) {
    return err.code === "NOT_FOUND" || /not found|couldn't find/i.test(err.message);
  }
  return false;
}

export type PublishResult = { id: string; status: string; action: "create" | "update"; request: unknown };

/**
 * Creates the post in the channel's own connection, or replaces the one we
 * created there last time. A post deleted at the provider is created again
 * rather than failing the push.
 */
export async function publish(
  connection: PushConnection,
  clientTimezone: string,
  plan: PlannedPost,
  asDraft: boolean,
  clientId: string,
): Promise<PublishResult> {
  const apiKey = connectionKey(connection);
  const existing = plan.existingPostId;

  if (connection.provider === "contentstudio") {
    const media = csMediaPlan(plan.platform, plan.format, plan.media);
    // ContentStudio reads a plain date/time as the workspace's local time.
    const input: CsPostInput = {
      accountIds: [plan.channel!.channelId],
      text: plan.text,
      scheduledAt: formatInZone(new Date(plan.dueAt!), connection.workspace_tz || clientTimezone),
      images: media.images,
      video: media.video,
      postType: media.postType,
      firstComment: plan.firstComment,
      asDraft,
    };
    if (existing) {
      try {
        const r = await csUpdate(apiKey, connection.workspace_id!, existing, input, clientId);
        return { ...r, action: "update", request: input };
      } catch (err) {
        if (!isMissingPost(err)) throw err;
      }
    }
    const r = await csCreate(apiKey, connection.workspace_id!, input, clientId);
    return { ...r, action: "create", request: input };
  }

  const input = {
    channelId: plan.channel!.channelId,
    text: plan.text,
    dueAt: plan.dueAt!,
    assets: plan.media.map((m) =>
      m.kind === "video" ? { video: { url: m.url } } : { image: { url: m.url, ...(m.altText && { metadata: { altText: m.altText } }) } },
    ),
    metadata: postMetadata(plan.platform, plan.format, plan.firstComment),
    saveToDraft: asDraft,
  };
  if (existing) {
    try {
      const r = await bufferEdit(apiKey, existing, input, clientId);
      return { ...r, action: "update", request: input };
    } catch (err) {
      if (!isMissingPost(err)) throw err;
    }
  }
  const r = await bufferCreate(apiKey, input, clientId);
  return { ...r, action: "create", request: input };
}

export type PostState = {
  platform: string;
  status: string;
  publishedUrl: string | null;
  publishedAt: string | null;
  metrics: Record<string, number>;
  error: string | null;
};

/**
 * Reads back what happened to one post: did it publish, where does it live, and
 * (Buffer only for now) what are the numbers. ContentStudio's per-post
 * analytics need the network's own post id, which they don't hand back.
 */
export async function fetchState(
  connection: PushConnection,
  channel: ChannelMapping,
  platform: string,
  postId: string,
  clientId: string,
): Promise<PostState | null> {
  const apiKey = connectionKey(connection);
  if (connection.provider === "contentstudio") {
    const { getPostState } = await import("../contentstudio");
    const state = await getPostState(apiKey, connection.workspace_id!, postId, clientId);
    if (!state) return null;
    return {
      platform,
      status: state.status,
      publishedUrl: state.links[channel.channelId] ?? Object.values(state.links)[0] ?? null,
      publishedAt: state.publishedAt,
      metrics: {},
      error: state.errors[channel.channelId] ?? Object.values(state.errors)[0] ?? null,
    };
  }
  const { getPostState } = await import("../buffer");
  const state = await getPostState(apiKey, postId, clientId);
  if (!state) return null;
  return {
    platform,
    status: state.status,
    publishedUrl: state.externalLink,
    publishedAt: state.sentAt,
    metrics: state.metrics,
    error: state.status === "error" ? "The provider reported an error on this post." : null,
  };
}

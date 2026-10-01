import "server-only";
import { BufferError, createPost as bufferCreate, editPost as bufferEdit, postMetadata } from "../buffer";
import {
  ContentStudioError, createPost as csCreate, csMediaPlan, updatePost as csUpdate, type CsPostInput,
} from "../contentstudio";
import { decryptSecret } from "../crypto";
import { formatInZone } from "../tz";
import { PROVIDER_LABEL, type ChannelMapping, type Client, type PushProvider } from "../types";
import type { PlannedPost } from "./prepare";

// One place that knows how each publishing provider differs. Everything else
// (planning, the review screens, the push job) works the same either way.

export type ProviderInfo = {
  id: PushProvider;
  label: string;
  channels: ChannelMapping[];
  hasKey: boolean;
  /** Whatever else that provider needs before it can publish. */
  ready: boolean;
  missing: string | null;
};

export function providerInfo(client: Client): ProviderInfo {
  if (client.push_provider === "contentstudio") {
    const hasKey = !!client.contentstudio_api_key_enc;
    const workspace = !!client.contentstudio_workspace_id;
    return {
      id: "contentstudio",
      label: PROVIDER_LABEL.contentstudio,
      channels: client.contentstudio_channels ?? [],
      hasKey,
      ready: hasKey && workspace,
      missing: !hasKey ? "Add this client's ContentStudio API key in Settings."
        : !workspace ? "Choose this client's ContentStudio workspace in Settings."
        : null,
    };
  }
  const hasKey = !!client.buffer_api_key_enc;
  return {
    id: "buffer",
    label: PROVIDER_LABEL.buffer,
    channels: client.buffer_channels ?? [],
    hasKey,
    ready: hasKey,
    missing: hasKey ? null : "Add this client's Buffer API key in Settings.",
  };
}

export function providerKey(client: Client): string {
  const enc = client.push_provider === "contentstudio" ? client.contentstudio_api_key_enc : client.buffer_api_key_enc;
  if (!enc) throw new Error(providerInfo(client).missing ?? "No API key saved for this client.");
  return decryptSecret(enc);
}

/** True when the error means "wait and resume", so a push job can stop cleanly. */
export function isRateLimit(err: unknown): err is BufferError | ContentStudioError {
  return (
    (err instanceof BufferError || err instanceof ContentStudioError) && err.code === "RATE_LIMIT_EXCEEDED"
  );
}

function isMissingPost(err: unknown): boolean {
  if (err instanceof BufferError || err instanceof ContentStudioError) {
    return err.code === "NOT_FOUND" || /not found|couldn't find/i.test(err.message);
  }
  return false;
}

export type PublishResult = { id: string; status: string; action: "create" | "update"; request: unknown };

/**
 * Creates the post, or replaces the one we created last time. A post that has
 * been deleted at the provider is created again rather than failing the push.
 */
export async function publish(
  client: Client,
  apiKey: string,
  plan: PlannedPost,
  asDraft: boolean,
): Promise<PublishResult> {
  const existing = plan.existingPostId;
  if (client.push_provider === "contentstudio") {
    const workspaceId = client.contentstudio_workspace_id!;
    // ContentStudio reads a plain date/time as the workspace's local time.
    const scheduledAt = formatInZone(new Date(plan.dueAt!), client.contentstudio_workspace_tz || client.timezone);
    const media = csMediaPlan(plan.platform, plan.format, plan.media);
    const input: CsPostInput = {
      accountIds: [plan.channel!.channelId],
      text: plan.text,
      scheduledAt,
      images: media.images,
      video: media.video,
      postType: media.postType,
      firstComment: plan.firstComment,
      asDraft,
    };
    if (existing) {
      try {
        const r = await csUpdate(apiKey, workspaceId, existing, input, client.id);
        return { ...r, action: "update", request: input };
      } catch (err) {
        if (!isMissingPost(err)) throw err;
      }
    }
    const r = await csCreate(apiKey, workspaceId, input, client.id);
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
      const r = await bufferEdit(apiKey, existing, input, client.id);
      return { ...r, action: "update", request: input };
    } catch (err) {
      if (!isMissingPost(err)) throw err;
    }
  }
  const r = await bufferCreate(apiKey, input, client.id);
  return { ...r, action: "create", request: input };
}

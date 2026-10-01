import "server-only";
import { loggedCall } from "./log";

// ContentStudio REST API (https://api-prod.contentstudio.io/docs).
// Posts are created as drafts unless the caller explicitly asks to schedule.
// See docs/contentstudio-api-notes.md.

const API = "https://api.contentstudio.io/api/v1";

export class ContentStudioError extends Error {
  constructor(message: string, public code?: string, public retryAfter?: number) {
    super(message);
  }
}

type ErrorBody = { status?: boolean; message?: string; error_code?: string; retry_after?: number; errors?: Record<string, string[]> };

async function call<T>(
  apiKey: string,
  path: string,
  init: { method?: string; body?: unknown } ,
  op: string,
  clientId?: string,
): Promise<T> {
  return loggedCall({ service: "contentstudio", operation: op, clientId }, async () => {
    const res = await fetch(`${API}${path}`, {
      method: init.method ?? "GET",
      headers: { "X-API-Key": apiKey, "content-type": "application/json", accept: "application/json" },
      ...(init.body !== undefined && { body: JSON.stringify(init.body) }),
    });
    if (res.status === 429) {
      const wait = Number(res.headers.get("retry-after") ?? 60);
      throw new ContentStudioError(
        `ContentStudio's rate limit was reached. Wait about ${Math.max(1, Math.ceil(wait / 60))} minute(s), then resume.`,
        "RATE_LIMIT_EXCEEDED",
        wait,
      );
    }
    const body = (await res.json().catch(() => ({}))) as ErrorBody & { data?: T };
    if (!res.ok) throw new ContentStudioError(friendlyError(res.status, body), body.error_code);
    return body.data as T;
  });
}

function friendlyError(status: number, body: ErrorBody): string {
  const detail = Object.values(body.errors ?? {}).flat().join(" ") || body.message || "";
  switch (status) {
    case 401:
      return "ContentStudio rejected the API key. Check or replace it in Settings.";
    case 403:
      return `This ContentStudio key doesn't have access to that workspace or channel. ${detail}`.trim();
    case 404:
      return "ContentStudio couldn't find that post or workspace. It may have been deleted there.";
    case 422:
      return `ContentStudio wouldn't accept the post: ${detail || "check the scheduled time and workspace timezone."}`;
    case 400:
      return `ContentStudio wouldn't accept the post: ${detail || "one of the fields was invalid."}`;
    default:
      return `ContentStudio error ${status}${detail ? `: ${detail}` : ""}`;
  }
}

export type CsWorkspace = { id: string; name: string; slug?: string; timezone?: string };
export type CsAccount = {
  id: string;
  platform: string;
  account_name: string;
  profile_picture?: string;
  status?: string;
};

export async function listWorkspaces(apiKey: string, clientId?: string): Promise<CsWorkspace[]> {
  const data = await call<CsWorkspace[]>(apiKey, "/workspaces?per_page=50", {}, "workspaces", clientId);
  return data ?? [];
}

export async function listAccounts(apiKey: string, workspaceId: string, clientId?: string): Promise<CsAccount[]> {
  const data = await call<CsAccount[]>(apiKey, `/workspaces/${encodeURIComponent(workspaceId)}/accounts?per_page=100`, {}, "accounts", clientId);
  return data ?? [];
}

/** Our platform names → ContentStudio's. Only the ones that differ need mapping. */
const PLATFORM_TO_CS: Record<string, string> = { googlebusiness: "gmb", twitter: "twitter" };
const CS_TO_PLATFORM: Record<string, string> = { gmb: "googlebusiness" };

export const toCsPlatform = (p: string) => PLATFORM_TO_CS[p] ?? p;
export const fromCsPlatform = (p: string) => CS_TO_PLATFORM[p] ?? p;

/**
 * Works out the post type and media ContentStudio will actually accept.
 *
 * It is stricter than Buffer: a reel must carry exactly one video (an image is
 * rejected outright), a carousel needs at least two images, and no post may mix
 * images and video. Rather than fail the push, fall back to the nearest type
 * that works and say so, so the post still lands as a draft for a human to sort out.
 */
export function csMediaPlan(
  platform: string,
  format: string | null,
  media: { url: string; kind: "image" | "video" }[],
): { postType?: string; images: string[]; video?: string; note: string | null } {
  const p = toCsPlatform(platform);
  const images = media.filter((m) => m.kind === "image").map((m) => m.url);
  const video = media.find((m) => m.kind === "video")?.url;
  const videoOnly = (type: string) => ({ postType: type, images: [], video, note: null });

  if (p === "youtube") {
    return video ? videoOnly("video") : { postType: "video", images: [], video: undefined, note: "YouTube needs a video; this post has none." };
  }

  if (format === "reel") {
    if (video) return videoOnly(p === "tiktok" ? "video" : "reel");
    // No video approved: a still can't be a reel anywhere, so send it to the feed.
    return {
      postType: p === "tiktok" ? "video" : "feed",
      images: images.slice(0, 1),
      video: undefined,
      note: "Marked as a reel but only a still image is approved, so it goes to the feed. Swap in a video to post it as a reel.",
    };
  }

  if (format === "story") {
    if (video) return videoOnly("story");
    return { postType: "story", images: images.slice(0, 1), video: undefined, note: null };
  }

  if (format === "carousel") {
    if (images.length >= 2) return { postType: p === "linkedin" || p === "tiktok" || p === "instagram" ? "carousel" : "feed", images: images.slice(0, 10), video: undefined, note: null };
    if (video) return videoOnly(p === "tiktok" ? "video" : "feed");
    return {
      postType: "feed",
      images: images.slice(0, 1),
      video: undefined,
      note: images.length === 1 ? "Carousel with only one image approved, so it goes as a single-image post." : null,
    };
  }

  // Plain feed post: video wins if there is one, since the two can't be mixed.
  if (video) {
    return {
      postType: p === "tiktok" || p === "youtube" ? "video" : p === "facebook" || p === "instagram" ? "reel" : "feed",
      images: [],
      video,
      note: images.length ? "This post has both a video and images; ContentStudio takes one or the other, so the video is used." : null,
    };
  }
  if (p === "pinterest" || p === "gmb") return { postType: "feed", images: images.slice(0, 1), video: undefined, note: null };
  return { postType: "feed", images: images.slice(0, 10), video: undefined, note: null };
}

export type CsPostInput = {
  accountIds: string[];
  text: string;
  /** "YYYY-MM-DD HH:mm:ss" in the workspace's timezone. */
  scheduledAt: string;
  images: string[];
  video?: string;
  postType?: string;
  firstComment?: string | null;
  asDraft: boolean;
};

function body(input: CsPostInput) {
  const media: Record<string, unknown> = {};
  if (input.images.length) media.images = input.images.slice(0, 10);
  if (input.video) media.video = input.video;
  return {
    content: { text: input.text, ...(Object.keys(media).length && { media }) },
    accounts: input.accountIds,
    ...(input.postType && { post_type: input.postType }),
    ...(input.firstComment?.trim() && {
      first_comment: { message: input.firstComment.trim(), accounts: input.accountIds },
    }),
    scheduling: {
      publish_type: input.asDraft ? "draft" : "scheduled",
      scheduled_at: input.scheduledAt,
    },
  };
}

export async function createPost(apiKey: string, workspaceId: string, input: CsPostInput, clientId?: string) {
  const data = await call<{ id: string; post_url?: string; warning?: string }>(
    apiKey,
    `/workspaces/${encodeURIComponent(workspaceId)}/posts`,
    { method: "POST", body: body(input) },
    "createPost",
    clientId,
  );
  if (!data?.id) throw new ContentStudioError("ContentStudio didn't return a post id.");
  return { id: data.id, status: input.asDraft ? "draft" : "scheduled", url: data.post_url };
}

/** A full replace of the post, which is how ContentStudio's update works. */
export async function updatePost(apiKey: string, workspaceId: string, postId: string, input: CsPostInput, clientId?: string) {
  const data = await call<{ id?: string; post_url?: string }>(
    apiKey,
    `/workspaces/${encodeURIComponent(workspaceId)}/posts/${encodeURIComponent(postId)}`,
    { method: "PUT", body: body(input) },
    "updatePost",
    clientId,
  );
  return { id: data?.id ?? postId, status: input.asDraft ? "draft" : "scheduled", url: data?.post_url };
}

/** Workspace entitlements, so a big push can be checked before it starts. */
export async function workspaceLimits(apiKey: string, workspaceId: string, clientId?: string) {
  return call<Record<string, unknown>>(apiKey, `/workspaces/${encodeURIComponent(workspaceId)}/limits`, {}, "limits", clientId);
}

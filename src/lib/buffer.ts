import "server-only";
import { config } from "./config";
import { loggedCall } from "./log";

// Buffer GraphQL API. See docs/buffer-api-notes.md.
// Posts are created with saveToDraft: true unless the caller explicitly opts out.

export class BufferError extends Error {
  constructor(message: string, public code?: string, public retryAfter?: number) {
    super(message);
  }
}

type GqlResponse<T> = { data?: T; errors?: { message: string; extensions?: { code?: string; window?: string } }[] };

async function gql<T>(apiKey: string, query: string, variables: Record<string, unknown>, op: string, clientId?: string): Promise<T> {
  return loggedCall({ service: "buffer", operation: op, clientId }, async () => {
    const res = await fetch(config.buffer.apiUrl, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ query, variables }),
    });
    if (res.status === 429) {
      const wait = Number(res.headers.get("retry-after") ?? 60);
      throw new BufferError(`Buffer's rate limit was reached. Wait about ${Math.ceil(wait / 60)} minute(s), then resume.`, "RATE_LIMIT_EXCEEDED", wait);
    }
    if (res.status === 401) throw new BufferError("Buffer rejected the API key. Check or replace it in Settings.", "UNAUTHORIZED");
    const body = (await res.json().catch(() => ({}))) as GqlResponse<T>;
    const err = body.errors?.[0];
    if (err) {
      const code = err.extensions?.code;
      const friendly =
        code === "UNAUTHORIZED" ? "Buffer rejected the API key. Check or replace it in Settings."
        : code === "FORBIDDEN" ? "This Buffer key doesn't have access to that channel or organisation."
        : code === "NOT_FOUND" ? "Buffer couldn't find that post or channel. It may have been deleted in Buffer."
        : code === "RATE_LIMIT_EXCEEDED" ? "Buffer's rate limit was reached. Wait a few minutes, then resume."
        : `Buffer error: ${err.message}`;
      throw new BufferError(friendly, code);
    }
    if (!res.ok || !body.data) throw new BufferError(`Buffer returned an unexpected response (${res.status}).`);
    return body.data;
  });
}

export type BufferOrg = { id: string; name: string };
export type BufferApiChannel = {
  id: string;
  name: string;
  displayName: string | null;
  service: string;
  avatar: string | null;
  isQueuePaused: boolean;
  isDisconnected: boolean;
  isLocked: boolean;
  timezone: string | null;
  organizationId: string;
};

export async function listOrganizations(apiKey: string, clientId?: string): Promise<BufferOrg[]> {
  const data = await gql<{ account: { organizations: BufferOrg[] } }>(
    apiKey,
    `query { account { organizations { id name } } }`,
    {},
    "organizations",
    clientId,
  );
  return data.account.organizations;
}

export async function listChannels(apiKey: string, organizationId: string, clientId?: string): Promise<BufferApiChannel[]> {
  const data = await gql<{ channels: BufferApiChannel[] }>(
    apiKey,
    `query Channels($organizationId: OrganizationId!) {
      channels(input: { organizationId: $organizationId }) {
        id name displayName service avatar isQueuePaused isDisconnected isLocked timezone organizationId
      }
    }`,
    { organizationId },
    "channels",
    clientId,
  );
  return data.channels;
}

export type PostInput = {
  channelId: string;
  text: string;
  dueAt: string; // ISO UTC
  assets: ({ image: { url: string; metadata?: { altText: string } } } | { video: { url: string } })[];
  metadata?: Record<string, unknown>;
  saveToDraft: boolean;
};

type PostPayload = {
  __typename: string;
  post?: { id: string; status: string; dueAt: string | null };
  message?: string;
};

const PAYLOAD = `
  __typename
  ... on PostActionSuccess { post { id status dueAt } }
  ... on MutationError { message }
`;

function unwrap(p: PostPayload): { id: string; status: string } {
  if (p.post) return { id: p.post.id, status: p.post.status };
  throw new BufferError(explainPostError(p.message ?? p.__typename));
}

function explainPostError(message: string): string {
  if (/fetch image|dimensions/i.test(message)) return `Buffer couldn't download the image (${message}). Re-prepare the image and try again.`;
  if (/limit/i.test(message)) return `Buffer says a limit was reached: ${message}. Check the Buffer plan's queue limits.`;
  if (/instagram/i.test(message) && /media|image/i.test(message)) return `Instagram needs an image or video on every post. ${message}`;
  return `Buffer didn't accept the post: ${message}`;
}

export async function createPost(apiKey: string, input: PostInput, clientId?: string) {
  const data = await gql<{ createPost: PostPayload }>(
    apiKey,
    `mutation CreatePost($input: CreatePostInput!) { createPost(input: $input) { ${PAYLOAD} } }`,
    {
      input: {
        channelId: input.channelId,
        text: input.text,
        schedulingType: "automatic",
        mode: "customScheduled",
        dueAt: input.dueAt,
        assets: input.assets,
        ...(input.metadata && { metadata: input.metadata }),
        saveToDraft: input.saveToDraft,
      },
    },
    "createPost",
    clientId,
  );
  return unwrap(data.createPost);
}

export async function editPost(apiKey: string, id: string, input: PostInput, clientId?: string) {
  const data = await gql<{ editPost: PostPayload }>(
    apiKey,
    `mutation EditPost($input: EditPostInput!) { editPost(input: $input) { ${PAYLOAD} } }`,
    {
      input: {
        id,
        text: input.text,
        schedulingType: "automatic",
        mode: "customScheduled",
        dueAt: input.dueAt,
        assets: input.assets,
        ...(input.metadata && { metadata: input.metadata }),
        saveToDraft: input.saveToDraft,
      },
    },
    "editPost",
    clientId,
  );
  return unwrap(data.editPost);
}

/** Buffer `metadata` for a post type, per platform. */
export function postMetadata(service: string, format: string | null, firstComment?: string | null): Record<string, unknown> | undefined {
  const comment = firstComment?.trim() ? { firstComment: firstComment.trim() } : {};
  switch (service) {
    case "instagram": {
      const type = format === "carousel" ? "carousel" : format === "reel" ? "reel" : format === "story" ? "story" : "post";
      return { instagram: { type, shouldShareToFeed: type !== "story", ...(type !== "story" && comment) } };
    }
    case "facebook": {
      const type = format === "reel" ? "reel" : format === "story" ? "story" : "post";
      return { facebook: { type, ...(type === "post" && comment) } };
    }
    case "linkedin":
      return Object.keys(comment).length ? { linkedin: comment } : undefined;
    default:
      return undefined;
  }
}

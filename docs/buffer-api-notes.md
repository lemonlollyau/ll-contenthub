# Buffer API notes (checked 17 Sep 2026)

Sources: developers.buffer.com (reference.md, guides/*), support.buffer.com article 926.

- **Endpoint/auth:** `POST https://api.buffer.com`, `Authorization: Bearer <key>`, GraphQL `{ query, variables }`.
- **Key scope:** one key = the whole Buffer *account* (every organisation it belongs to). Pick the target with `organizationId`.
- **Channels:** `account { organizations { id name } }`, then `channels(input: { organizationId })` → `id name displayName service avatar isQueuePaused isDisconnected isLocked timezone`.
  `Service` values include `instagram facebook linkedin tiktok pinterest threads twitter googlebusiness youtube bluesky mastodon`.
- **Create:** `createPost(input: CreatePostInput!)` with `channelId`, `text`, `schedulingType: automatic`, `mode: customScheduled`, `dueAt` (ISO UTC), `assets`, `metadata`, and **`saveToDraft: true`** (status `draft`; nothing publishes until someone schedules it in Buffer).
  Results are a union: `... on PostActionSuccess { post { id } }`, `... on MutationError { message }`.
- **Update:** `editPost(input: { id, text, assets, metadata, dueAt, mode, schedulingType, saveToDraft })`. Omitted fields keep their values, and `assets: []` clears the media. Delete: `deletePost(input: { id })`.
- **Media:** there's no upload; pass public, stable HTTPS URLs. `assets: [{ image: { url, metadata: { altText } } }]` or `[{ video: { url } }]`. `altText` is required if `metadata` is sent. Carousels are an ordered list of image assets (implied, not stated).
- **Post types:** `metadata.instagram: { type: post|carousel|reel|story, shouldShareToFeed: Boolean!, firstComment }`; `metadata.facebook: { type: post|reel|story, firstComment }`; `metadata.linkedin: { firstComment }`. TikTok has no type field and isn't in the "supported platforms" list, so test it first.
- **First comment:** Instagram, Facebook and LinkedIn.
- **Rate limits (per key):** 100 requests per 15 minutes on every plan, 250/day (Free, Essentials) or 500/day (Team), 3k/7.5k/15k per 30 days. Over the limit: HTTP 429 with a `Retry-After` header and `extensions.code = RATE_LIMIT_EXCEEDED`. The `RateLimit` header shows what's left.
- **Legacy REST v1:** retired 1 Feb 2027.
- **Bulk CSV (Help Center):** headers `Text,Image URL,Tags,Posting Time` (case-sensitive); `YYYY-MM-DD HH:mm` 24-hour. Image URLs must be direct links ending `.jpg`/`.png`, 5 MB max. 100 posts per channel per file on paid plans (10 on Free). One channel per upload; "Save as Drafts" is chosen in the upload dialog.

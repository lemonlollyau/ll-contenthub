# ContentStudio API notes (checked 2 Oct 2026)

Sources: https://api-prod.contentstudio.io/docs (OpenAPI spec, authoritative),
https://docs.contentstudio.io/article/1163-contentstudio-api, article 564 (bulk upload).

- **Endpoint/auth:** `https://api.contentstudio.io/api/v1`, header `X-API-Key: cs_…`.
  The key is generated in-app: sidebar → **API** → Generate API Key (turn the API module
  on via Customize Sidebar if it's hidden). One key covers every workspace that account sees.
- **Plans:** API access is on paid plans; usage is metered as monthly API requests.
  `GET /workspaces/{id}/limits` reports what's left.
- **Workspaces:** `GET /workspaces` → `id`, `name`, `timezone`. The timezone matters:
  see scheduling below.
- **Channels:** `GET /workspaces/{id}/accounts` → `id` (what you pass in `accounts[]`),
  `platform`, `account_name`, `status`. Platform names match ours except Google Business,
  which they call `gmb`.
- **Create:** `POST /workspaces/{id}/posts` with `content.text`, `accounts[]`,
  `scheduling.publish_type` (**`draft`** | `scheduled` | `queued` | `content_category`) and
  `scheduling.scheduled_at`.
- **Scheduling:** `scheduled_at` is `"YYYY-MM-DD HH:mm:ss"` with no timezone offset, and is
  read as the **workspace's** local time. We store the workspace timezone when channels are
  mapped and format the time in it (`formatInZone`), so a client in a different timezone to
  their workspace still lands at the right moment.
- **Media:** public URLs in `content.media.images[]` (max 10) and `content.media.video`.
  There's also an upload endpoint and a media library, which we don't need since our
  prepared images already have public URLs. Text max 5,000 characters.
- **Post types:** `post_type` per platform — Instagram `feed|reel|story|carousel`,
  Facebook `feed|reel|story`, LinkedIn `feed|carousel`, YouTube `video|shorts`,
  TikTok `video|carousel`, Pinterest/GMB `feed`.
- **First comment:** `first_comment: { message, accounts[] }`, accounts being a subset of
  `accounts[]`.
- **Update:** `PUT /workspaces/{id}/posts/{post_id}` replaces the post in full, and only
  works while it's unpublished. We store the returned id per platform in
  `content_items.external_posts`, so re-pushing updates rather than duplicates.
- **Delete:** `DELETE /workspaces/{id}/posts/{post_id}`. Note Instagram and TikTok posts
  can't be deleted from the network through ContentStudio, only from its planner.
- **Rate limits:** `X-RateLimit-*` headers plus `Retry-After`; errors come back as
  `{status:false, message, error_code}` with 429 as `RATE_LIMIT_EXCEEDED`. The push job
  stops cleanly on a rate limit and offers Resume.
- **Bulk CSV (fallback):** columns `Date and Time`, `Message`, `Image URL`, `Link`;
  `dd/mm/yyyy hh:mm`; up to 500 rows per upload. Their downloadable template is the final
  word on header spelling — check it the first time you use a new account.

**Open items to confirm with a live test:** the exact rate-limit ceiling, media byte-size
limits, and that a naive `scheduled_at` really is read as workspace-local time.

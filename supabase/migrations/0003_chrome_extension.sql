-- Content Studio (Chrome extension): images designed in the extension.
-- When a post has custom_media, the Buffer push uses it instead of the
-- matched Drive images. Shape: [{"url":"...","kind":"image","altText":"...","source":"..."}]
alter table content_items
  add column if not exists custom_media jsonb not null default '[]'::jsonb;

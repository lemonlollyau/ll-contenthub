-- Catch-up: the custom_media column from 0003 and everything in 0005.

alter table content_items
  -- images attached by hand (uploaded, or designed in the extension); these
  -- stand in for whatever was matched from Drive
  add column if not exists custom_media jsonb not null default '[]'::jsonb,
  -- where a post ended up live, and how it performed
  add column if not exists published_urls jsonb not null default '{}'::jsonb,
  add column if not exists published_at timestamptz,
  add column if not exists metrics jsonb not null default '{}'::jsonb,
  add column if not exists metrics_at timestamptz,
  -- paid amplification shortlist
  add column if not exists boost boolean not null default false,
  add column if not exists boost_budget numeric(10,2),
  add column if not exists boost_notes text,
  -- a short plan for real human engagement around the post
  add column if not exists engagement_plan jsonb;

create index if not exists content_items_boost on content_items(client_id, boost) where boost;

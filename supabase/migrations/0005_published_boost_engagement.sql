-- Three additions after a post is sent:
--   1. where it ended up live, and how it performed
--   2. whether it's worth putting paid budget behind
--   3. a short plan for real human engagement around it

alter table content_items
  -- {"instagram": "https://www.instagram.com/p/...", "facebook": "..."}
  add column if not exists published_urls jsonb not null default '{}'::jsonb,
  add column if not exists published_at timestamptz,
  -- {"instagram": {"likes": 12, "comments": 3, "reach": 400, "checked_at": "..."}}
  add column if not exists metrics jsonb not null default '{}'::jsonb,
  add column if not exists metrics_at timestamptz,
  -- paid amplification: flagged here, exported for Meta Ads
  add column if not exists boost boolean not null default false,
  add column if not exists boost_budget numeric(10,2),
  add column if not exists boost_notes text,
  -- {"generated_at": "...", "hashtags": [...], "accounts": [...], "openers": [...]}
  add column if not exists engagement_plan jsonb;

create index if not exists content_items_boost on content_items(client_id, boost) where boost;

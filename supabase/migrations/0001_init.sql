-- lemonlolly Content Hub: initial schema (Phase 1 + fields reserved for Phase 2/3).
--
-- Security model: Row Level Security is ON for every table with NO policies,
-- so the public (anon) key can read/write nothing. All data access happens
-- server-side with the service-role key, after the app has checked that the
-- signed-in user is on the email allowlist.

create extension if not exists pgcrypto;

-- Keeps updated_at current on any table that has it.
create or replace function set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

-- ---------------------------------------------------------------------------
-- Clients
-- ---------------------------------------------------------------------------
create table clients (
  id                    uuid primary key default gen_random_uuid(),
  name                  text not null,
  slug                  text not null unique,
  timezone              text not null default 'Australia/Adelaide',
  drive_folder_id       text,
  -- Secrets are AES-256-GCM encrypted by the app (see src/lib/crypto.ts).
  buffer_api_key_enc    text,
  -- e.g. [{"platform":"instagram","channelId":"...","channelName":"Fringe Heals IG"}]
  buffer_channels       jsonb not null default '[]'::jsonb,
  klaviyo_api_key_enc   text,
  blog_destination      jsonb not null default '{}'::jsonb,
  -- Posting-time rules, see src/lib/posting-times.ts for the shape.
  posting_rules         jsonb not null default '{}'::jsonb,
  -- Saved spreadsheet column mapping so next month's import is one click:
  -- {"social": {"Caption (draft)": "caption", ...}, "email": {...}}
  import_mapping        jsonb not null default '{}'::jsonb,
  placeholder_image_url text,
  reuse_window_days     integer not null default 14,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create trigger clients_updated before update on clients
  for each row execute function set_updated_at();

create table brand_profiles (
  client_id          uuid primary key references clients(id) on delete cascade,
  voice_notes        text not null default '',
  words_to_avoid     text[] not null default '{}',
  compliance_notes   text not null default '',
  colours            jsonb not null default '{}'::jsonb,   -- {"primary":"#...","secondary":"#...",...}
  fonts              jsonb not null default '{}'::jsonb,   -- {"heading":"...","body":"..."}
  logo_url           text,
  email_footer       jsonb not null default '{}'::jsonb,
  standing_hashtags  text[] not null default '{}',
  standing_ctas      text[] not null default '{}',
  internal_links     jsonb not null default '[]'::jsonb,   -- for blog posts (Phase 3)
  updated_at         timestamptz not null default now()
);
create trigger brand_profiles_updated before update on brand_profiles
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- Campaigns, calendars, content
-- ---------------------------------------------------------------------------
create table campaigns (
  id           uuid primary key default gen_random_uuid(),
  client_id    uuid not null references clients(id) on delete cascade,
  name         text not null,
  start_date   date,
  end_date     date,
  offer        text not null default '',
  key_message  text not null default '',
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create trigger campaigns_updated before update on campaigns
  for each row execute function set_updated_at();

create table calendars (
  id               uuid primary key default gen_random_uuid(),
  client_id        uuid not null references clients(id) on delete cascade,
  month            date not null,               -- first day of the month
  source_filename  text,
  source_path      text,                        -- path in the private "imports" bucket
  column_mapping   jsonb not null default '{}'::jsonb,
  imported_at      timestamptz,                 -- null while the import is being reviewed
  created_at       timestamptz not null default now()
);
create index calendars_client_month on calendars(client_id, month);

create table content_items (
  id               uuid primary key default gen_random_uuid(),
  client_id        uuid not null references clients(id) on delete cascade,
  calendar_id      uuid references calendars(id) on delete cascade,
  campaign_id      uuid references campaigns(id) on delete set null,
  type             text not null check (type in ('social','email','blog')),
  row_number       integer,                     -- the "#" column
  post_date        date,
  post_time        time,
  day              text,
  phase            text,
  slot             text,
  channels         text[] not null default '{}',
  format           text check (format in ('feed','carousel','reel','story','text','square')),
  pillar           text,
  moment_offer     text,
  hook             text,
  caption          text,
  caption_status   text,
  -- AI suggestions never overwrite the caption; they live here until accepted.
  caption_suggestion text,
  cta              text,
  hashtags         text,
  first_comment    text,
  asset_brief      text,
  asset_group      text,
  asset_status     text,
  asset_ref        text,                        -- explicit file name / Drive link / file id
  owner            text,
  scheduled        text,
  live             text,
  compliance_note  text,
  status           text not null default 'draft'
                   check (status in ('draft','ready','approved','pushed')),
  -- email (Phase 2)
  email_subject      text,
  email_subject_alts text[] not null default '{}',
  email_preview      text,
  email_blocks       jsonb not null default '[]'::jsonb,
  -- blog (Phase 3)
  blog_title       text,
  blog_slug        text,
  blog_meta        text,
  blog_body        text,
  -- the original spreadsheet row, kept for traceability
  source_row       jsonb not null default '{}'::jsonb,
  -- Buffer post ids per channel so a re-push updates instead of duplicating
  buffer_posts     jsonb not null default '{}'::jsonb,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index content_items_client_date on content_items(client_id, post_date);
create index content_items_calendar on content_items(calendar_id);
create trigger content_items_updated before update on content_items
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- Drive assets
-- ---------------------------------------------------------------------------
create table assets (
  id                 uuid primary key default gen_random_uuid(),
  client_id          uuid not null references clients(id) on delete cascade,
  drive_file_id      text not null,
  folder_path        text not null default '',   -- e.g. "Products/Hydrating Balm"
  name               text not null,
  mime_type          text not null,
  kind               text not null check (kind in ('image','video')),
  width              integer,
  height             integer,
  duration_ms        integer,
  size_bytes         bigint,
  md5                text,
  drive_modified_at  timestamptz,
  thumbnail_path     text,                        -- path in the private "thumbs" bucket
  ai_description     text,
  ai_tags            jsonb,
  ai_analysed_md5    text,                        -- md5 at the time of analysis
  ai_analysed_at     timestamptz,
  last_synced_at     timestamptz not null default now(),
  removed_at         timestamptz,                 -- no longer in Drive
  created_at         timestamptz not null default now(),
  search_text        text generated always as (
    lower(folder_path || ' ' || name || ' ' || coalesce(ai_description, '') || ' ' || coalesce(ai_tags::text, ''))
  ) stored,
  unique (client_id, drive_file_id)
);
create index assets_client_folder on assets(client_id, folder_path);

-- Files that are new or changed since Claude last looked at them.
create view assets_needing_analysis with (security_invoker = true) as
  select * from assets
  where removed_at is null
    and ai_analysed_md5 is distinct from md5;

create table asset_matches (
  id               uuid primary key default gen_random_uuid(),
  content_item_id  uuid not null references content_items(id) on delete cascade,
  asset_id         uuid references assets(id) on delete cascade,  -- null = "No suitable asset"
  position         integer not null default 0,   -- carousel order
  confidence       numeric(4,3),                 -- 0.000 – 1.000
  reason           text,
  method           text not null check (method in ('explicit','folder','ai','manual')),
  state            text not null default 'suggested'
                   check (state in ('suggested','approved','swapped','rejected')),
  replaced_asset_id uuid references assets(id) on delete set null, -- what I swapped away from
  crop             jsonb,                        -- manual crop {left,top,width,height}; null = smart crop
  created_at       timestamptz not null default now(),
  decided_at       timestamptz
);
create index asset_matches_item on asset_matches(content_item_id);
create index asset_matches_asset on asset_matches(asset_id);

create table rendered_assets (
  id               uuid primary key default gen_random_uuid(),
  asset_id         uuid not null references assets(id) on delete cascade,
  content_item_id  uuid references content_items(id) on delete cascade,
  format           text not null,               -- feed | square | story | email | blog_hero
  width            integer not null,
  height           integer,
  crop             jsonb,                       -- manual crop {left,top,width,height} or null = smart
  storage_path     text not null,
  public_url       text not null,
  size_bytes       integer,
  warnings         text[] not null default '{}',
  created_at       timestamptz not null default now(),
  unique (content_item_id, asset_id, format)
);

-- ---------------------------------------------------------------------------
-- Logging and jobs
-- ---------------------------------------------------------------------------
create table push_logs (
  id               uuid primary key default gen_random_uuid(),
  client_id        uuid references clients(id) on delete cascade,
  content_item_id  uuid references content_items(id) on delete set null,
  target           text not null,               -- buffer | buffer_csv | klaviyo | export
  action           text not null,               -- create | update | export ...
  ok               boolean not null,
  request          jsonb,
  response         jsonb,
  error            text,
  created_by       text,
  created_at       timestamptz not null default now()
);
create index push_logs_client on push_logs(client_id, created_at desc);

-- Every external API call (Drive, Anthropic, Buffer, Klaviyo).
create table api_calls (
  id           bigint generated always as identity primary key,
  client_id    uuid references clients(id) on delete cascade,
  service      text not null,
  operation    text not null,
  ok           boolean not null,
  status_code  integer,
  duration_ms  integer,
  error        text,
  meta         jsonb,
  created_at   timestamptz not null default now()
);
create index api_calls_created on api_calls(created_at desc);

-- Long-running work (Drive indexing, matching, rendering) runs in small batches.
create table jobs (
  id          uuid primary key default gen_random_uuid(),
  client_id   uuid references clients(id) on delete cascade,
  kind        text not null,                    -- drive_index | ai_analyse | match | render | buffer_push
  status      text not null default 'queued'
              check (status in ('queued','running','done','failed','cancelled')),
  params      jsonb not null default '{}'::jsonb,
  state       jsonb not null default '{}'::jsonb, -- cursor / queue between batches
  total       integer not null default 0,
  done        integer not null default 0,
  message     text,
  error       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index jobs_client on jobs(client_id, created_at desc);
create trigger jobs_updated before update on jobs
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- Lock everything down: RLS on, no policies => only the service role gets in.
-- ---------------------------------------------------------------------------
alter table clients         enable row level security;
alter table brand_profiles  enable row level security;
alter table campaigns       enable row level security;
alter table calendars       enable row level security;
alter table content_items   enable row level security;
alter table assets          enable row level security;
alter table asset_matches   enable row level security;
alter table rendered_assets enable row level security;
alter table push_logs       enable row level security;
alter table api_calls       enable row level security;
alter table jobs            enable row level security;

-- ---------------------------------------------------------------------------
-- Storage buckets
--   rendered : PUBLIC  - processed images Buffer/Klaviyo fetch by URL
--   thumbs   : private - library thumbnails (served via signed URLs)
--   imports  : private - uploaded calendar spreadsheets
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('rendered', 'rendered', true),
       ('thumbs',   'thumbs',   false),
       ('imports',  'imports',  false)
on conflict (id) do nothing;

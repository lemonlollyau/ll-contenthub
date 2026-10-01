-- Photos picked on the phone (Content Hub → Pick) for designing later in the
-- Chrome extension. Either a Drive library asset, or a camera-roll upload
-- stored in the private "picks" bucket. used_at is set once the extension
-- has pulled it into its tray.
create table if not exists photo_picks (
  id               uuid primary key default gen_random_uuid(),
  client_id        uuid not null references clients(id) on delete cascade,
  content_item_id  uuid references content_items(id) on delete set null,
  asset_id         uuid references assets(id) on delete cascade,
  storage_path     text,
  label            text not null default '',
  note             text not null default '',
  created_by       text,
  created_at       timestamptz not null default now(),
  used_at          timestamptz,
  check (asset_id is not null or storage_path is not null)
);
create index if not exists photo_picks_client_open on photo_picks(client_id, used_at, created_at desc);

alter table photo_picks enable row level security;

insert into storage.buckets (id, name, public)
values ('picks', 'picks', false)
on conflict (id) do nothing;

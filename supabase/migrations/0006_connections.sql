-- A client's channels can live in several places at once: your agency Buffer
-- account, the client's own Buffer, a ContentStudio workspace. So an API key
-- becomes a named "connection" that any client can use, and each mapped
-- channel says which connection it belongs to.

create table if not exists push_connections (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,                 -- e.g. "lemonlolly Buffer", "Fringe Heals ContentStudio"
  provider      text not null check (provider in ('buffer', 'contentstudio')),
  api_key_enc   text not null,                 -- AES-256-GCM, server-side only
  workspace_id  text,                          -- ContentStudio only
  workspace_tz  text,                          -- ContentStudio schedules in the workspace's timezone
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

drop trigger if exists push_connections_updated on push_connections;
create trigger push_connections_updated before update on push_connections
  for each row execute function set_updated_at();

alter table push_connections enable row level security;
grant all on push_connections to service_role;

-- [{"platform":"instagram","channelId":"...","channelName":"...","connectionId":"..."}]
alter table clients add column if not exists channels jsonb not null default '[]'::jsonb;

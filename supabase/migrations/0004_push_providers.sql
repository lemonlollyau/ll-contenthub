-- Each client publishes through Buffer or ContentStudio. The provider is chosen
-- per client; credentials and channel mappings for both live side by side, so
-- switching back doesn't lose the other one's setup.

alter table clients
  add column if not exists push_provider text not null default 'buffer'
    check (push_provider in ('buffer', 'contentstudio')),
  add column if not exists contentstudio_api_key_enc text,
  add column if not exists contentstudio_workspace_id text,
  -- ContentStudio schedules in the workspace's own timezone, so we keep it.
  add column if not exists contentstudio_workspace_tz text,
  -- [{"platform":"instagram","channelId":"...","channelName":"..."}]
  add column if not exists contentstudio_channels jsonb not null default '[]'::jsonb;

-- Post ids come back from whichever provider was used, so the column name
-- shouldn't say "buffer" any more. (push_logs.target still records which one.)
alter table content_items rename column buffer_posts to external_posts;

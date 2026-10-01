-- Newer Supabase projects don't grant table access to the API roles automatically.
-- Only the server-side service_role gets access; anon/authenticated get nothing.

grant usage on schema public to service_role;
grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;
grant execute on all functions in schema public to service_role;

alter default privileges in schema public grant all on tables to service_role;
alter default privileges in schema public grant all on sequences to service_role;
alter default privileges in schema public grant execute on functions to service_role;

revoke all on all tables in schema public from anon, authenticated;

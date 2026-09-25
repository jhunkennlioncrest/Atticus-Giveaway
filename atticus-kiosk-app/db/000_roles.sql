-- 000 — roles bootstrap. Run this FIRST on a local mirror only.
--
-- Supabase provides anon, authenticated and service_role already, and running this there
-- changes nothing. A plain PostgreSQL database has none of them, so the grants inside the
-- migrations abort and leave the schema half-built. This creates them if they are missing.
do $$
declare r text;
begin
  foreach r in array array['anon', 'authenticated', 'service_role'] loop
    if not exists (select 1 from pg_roles where rolname = r) then
      execute format('create role %I nologin', r);
    end if;
  end loop;
  -- the local test user stands in for the server's service key
  if exists (select 1 from pg_roles where rolname = 'kiosk') then
    execute 'grant service_role to kiosk';
  end if;
end $$;

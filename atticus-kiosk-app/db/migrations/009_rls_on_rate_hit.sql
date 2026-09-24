-- 009 — rate_hit was created with the public-entry rate limiter but without row-level
-- security, so it was reachable with the anon key. It holds hashed caller addresses.
-- No policies: only the server's service key may touch it, as with every other table.
alter table public.rate_hit enable row level security;
do $$
begin
  if exists (select 1 from pg_roles where rolname='anon') then
    execute 'revoke all on table public.rate_hit from anon';
  end if;
  if exists (select 1 from pg_roles where rolname='authenticated') then
    execute 'revoke all on table public.rate_hit from authenticated';
  end if;
end $$;

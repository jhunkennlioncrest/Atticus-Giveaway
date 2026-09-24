create table if not exists unlock_revoked (jti text primary key, user_id uuid not null, at timestamptz not null default now());
create or replace function app_unlock_revoke(p_jti text, p_user uuid) returns jsonb language plpgsql as $$
begin insert into unlock_revoked (jti,user_id) values (p_jti,p_user) on conflict (jti) do nothing;
  insert into audit (actor,action,entity,entity_id) values (p_user::text,'tablet_locked','staff',p_user::text);
  return jsonb_build_object('ok',true); end $$;
create or replace function app_unlock_is_revoked(p_jti text) returns boolean language sql stable as $$
  select exists (select 1 from unlock_revoked where jti = p_jti); $$;

-- Single admin role: every authorised account sees and controls everything.
-- The shared PIN is gone; the whole admin area needs a real login.
drop function if exists check_pin(text,text);
drop function if exists set_pin(text,text,text);
alter table campaign drop column if exists pin_hash;

alter table staff drop constraint if exists staff_role_check;
alter table staff alter column role set default 'admin';
update staff set role = 'admin';
alter table staff add constraint staff_role_check check (role = 'admin');

-- ---------------------------------------------------------------------------
-- Named functions replace ad-hoc SQL from the server. Nothing the browser sends
-- ever reaches the database as SQL.
-- ---------------------------------------------------------------------------
create or replace function app_campaign(p_campaign text)
returns jsonb language sql stable security definer set search_path = public as $$
  select to_jsonb(c) from campaign c where c.id = p_campaign;
$$;

create or replace function app_admin_by_user(p_user uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select to_jsonb(s) from staff s where s.user_id = p_user and s.is_active;
$$;

create or replace function app_admin_seen(p_user uuid)
returns void language sql security definer set search_path = public as $$
  update staff set last_seen_at = now() where user_id = p_user;
$$;

create or replace function app_admin_add(p_user uuid, p_email text, p_name text, p_by text default '')
returns jsonb language plpgsql security definer set search_path = public as $$
declare v jsonb;
begin
  insert into staff (user_id, email, name, role) values (p_user, p_email::citext, coalesce(p_name,''), 'admin')
  on conflict (user_id) do update set email = excluded.email, name = excluded.name, is_active = true
  returning to_jsonb(staff) into v;
  insert into audit (actor, action, entity, entity_id, detail)
  values (p_by, 'admin_added', 'staff', p_user::text, jsonb_build_object('email', p_email));
  return v;
end $$;

create or replace function app_entries(p_campaign text, p_include_removed boolean default false,
                                       p_include_tests boolean default true)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc), '[]'::jsonb) from (
    select e.*, j.status as mail_status, j.sent_at as mail_sent_at, j.sent_by as mail_sent_by,
           j.send_count as mail_send_count, j.subject as mail_subject, j.attempts as mail_attempts
      from entry e left join email_job j on j.entry_id = e.id
     where e.campaign_id = p_campaign
       and (e.deleted_at is null or p_include_removed)
       and (e.is_test = false or p_include_tests)
     limit 5000) x;
$$;

create or replace function app_entry(p_campaign text, p_id uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select to_jsonb(x) from (
    select e.*, j.status as mail_status, j.send_count as mail_send_count,
           j.subject as mail_subject, j.html as mail_html, j.sent_at as mail_sent_at, j.sent_by as mail_sent_by
      from entry e left join email_job j on j.entry_id = e.id
     where e.campaign_id = p_campaign and e.id = p_id) x;
$$;

create or replace function app_entry_update(p_campaign text, p_id uuid, p_patch jsonb, p_by text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v entry; v_note text;
begin
  select * into v from entry where id = p_id and campaign_id = p_campaign for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'That entry no longer exists.'); end if;
  v_note := (select string_agg(k || ' → ' || coalesce(p_patch->>k,''), ', ')
               from jsonb_object_keys(p_patch) k
              where k in ('status','owner','reason','notes'));
  update entry set
    status = coalesce(p_patch->>'status', status),
    owner  = coalesce(p_patch->>'owner',  owner),
    reason = coalesce(p_patch->>'reason', reason),
    notes  = coalesce(p_patch->>'notes',  notes),
    updated_at = now(),
    history = history || jsonb_build_array(jsonb_build_object('at', now(), 'by', p_by, 'what', coalesce(v_note,'updated')))
   where id = p_id returning * into v;
  return jsonb_build_object('ok', true, 'entry', to_jsonb(v));
end $$;

create or replace function app_prize_save(p_campaign text, p_prize jsonb, p_by text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v prize;
begin
  update prize set
    weight       = coalesce((p_prize->>'weight')::int, weight),
    win_limit    = coalesce((p_prize->>'limit')::int, win_limit),
    active       = coalesce((p_prize->>'active')::boolean, active),
    info_url     = coalesce(p_prize->>'infoUrl', info_url),
    email_fields = coalesce(p_prize->'emailFields', email_fields),
    updated_at   = now()
   where campaign_id = p_campaign and id = p_prize->>'id' returning * into v;
  if not found then return jsonb_build_object('ok', false, 'error', 'Unknown prize.'); end if;
  insert into audit (actor, action, entity, entity_id, detail)
  values (p_by, 'prize_updated', 'prize', v.id, p_prize);
  return jsonb_build_object('ok', true, 'prize', to_jsonb(v));
end $$;

create or replace function app_settings_get(p_key text)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce((select value from settings where key = p_key), '{}'::jsonb);
$$;

create or replace function app_settings_save(p_key text, p_value jsonb, p_by text)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  insert into settings (key, value) values (p_key, p_value)
  on conflict (key) do update set value = excluded.value, updated_at = now();
  insert into audit (actor, action, entity, entity_id) values (p_by, 'settings_saved', 'settings', p_key);
  return p_value;
end $$;

create or replace function app_email_sent(p_entry uuid, p_by text, p_subject text, p_html text, p_provider text)
returns void language sql security definer set search_path = public as $$
  update email_job set status='sent', sent_at=now(), sent_by=p_by, send_count=send_count+1,
    subject=p_subject, html=p_html, provider_id=coalesce(p_provider,''),
    attempts = attempts || jsonb_build_array(jsonb_build_object('at',now(),'ok',true,'by',p_by)),
    updated_at=now() where entry_id = p_entry;
$$;

create or replace function app_email_failed(p_entry uuid, p_by text, p_error text)
returns void language sql security definer set search_path = public as $$
  update email_job set status = case when status='sent' then 'sent' else 'failed' end,
    attempts = attempts || jsonb_build_array(jsonb_build_object('at',now(),'ok',false,'by',p_by,'error',p_error)),
    updated_at=now() where entry_id = p_entry;
$$;

create or replace function app_email_queued(p_entry uuid)
returns void language sql security definer set search_path = public as $$
  update email_job set status='pending', updated_at=now() where entry_id = p_entry and status <> 'sent';
$$;

-- only the app's server (service role) may call any of this
do $$ declare f record; begin
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid=p.pronamespace
            where n.nspname='public' and p.proname like 'app\_%' or (n.nspname='public' and p.proname in
                  ('draw_prize','remove_entry','wheel_state','new_claim_ref'))
  loop
    execute format('revoke execute on function %s from anon, authenticated, public', f.sig);
    execute format('grant execute on function %s to service_role', f.sig);
  end loop;
end $$;

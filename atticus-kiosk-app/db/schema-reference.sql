-- Schema reference for the Atticus giveaway database, v1.3.0.
-- Generated from the local mirror that the test suites run against, which matches the
-- Supabase project's public schema including every function the server calls.
-- Supabase-only roles (anon, authenticated, service_role) and RLS policies are applied
-- by schema.sql and the numbered migrations; this file is the structural reference.

--
-- PostgreSQL database dump
--

\restrict 7TsVqNMlROgoJlfBhdXIATSGPjUtBmneFlzABG9SJKeFWBR8USw58QOrp3ZK0fr

-- Dumped from database version 16.15 (Ubuntu 16.15-0ubuntu0.24.04.1)
-- Dumped by pg_dump version 16.15 (Ubuntu 16.15-0ubuntu0.24.04.1)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: citext; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS citext WITH SCHEMA public;


--
-- Name: EXTENSION citext; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION citext IS 'data type for case-insensitive character strings';


--
-- Name: pgcrypto; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA public;


--
-- Name: EXTENSION pgcrypto; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION pgcrypto IS 'cryptographic functions';


--
-- Name: app_admin_add(uuid, text, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.app_admin_add(p_user uuid, p_email text, p_name text, p_by text DEFAULT ''::text) RETURNS jsonb
    LANGUAGE plpgsql
    AS $$
declare v staff;
begin
  update staff set user_id = p_user, name = coalesce(nullif(p_name,''), name), is_active = true
   where email = p_email::citext returning * into v;
  if not found then
    insert into staff (user_id, email, name, role) values (p_user, p_email::citext, coalesce(p_name,''), 'admin')
    on conflict (user_id) do update set email = excluded.email, name = excluded.name, is_active = true
    returning * into v;
  end if;
  insert into audit (actor, action, entity, entity_id, detail)
  values (p_by, 'admin_added', 'staff', p_user::text, jsonb_build_object('email', p_email));
  return to_jsonb(v);
end $$;


--
-- Name: app_admin_by_user(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.app_admin_by_user(p_user uuid) RETURNS jsonb
    LANGUAGE sql STABLE
    AS $$
  select to_jsonb(s) from staff s where s.user_id = p_user and s.is_active; $$;


--
-- Name: app_admin_seen(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.app_admin_seen(p_user uuid) RETURNS void
    LANGUAGE sql
    AS $$
  update staff set last_seen_at = now() where user_id = p_user; $$;


--
-- Name: app_campaign(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.app_campaign(p_campaign text) RETURNS jsonb
    LANGUAGE sql STABLE
    AS $$
  select to_jsonb(c) from campaign c where c.id = p_campaign; $$;


--
-- Name: app_email_failed(uuid, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.app_email_failed(p_entry uuid, p_by text, p_error text) RETURNS void
    LANGUAGE sql
    AS $$
  update email_job set status = case when status='sent' then 'sent' else 'failed' end,
    attempts = attempts || jsonb_build_array(jsonb_build_object('at',now(),'ok',false,'by',p_by,'error',p_error)),
    updated_at=now() where entry_id = p_entry; $$;


--
-- Name: app_email_queued(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.app_email_queued(p_entry uuid) RETURNS void
    LANGUAGE sql
    AS $$
  update email_job set status='pending', updated_at=now() where entry_id = p_entry and status <> 'sent'; $$;


--
-- Name: app_email_sent(uuid, text, text, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.app_email_sent(p_entry uuid, p_by text, p_subject text, p_html text, p_provider text) RETURNS void
    LANGUAGE sql
    AS $$ update email_job set status='sent', sent_at=now(), sent_by=p_by, send_count=send_count+1,
  subject=p_subject, html=p_html, provider_id=coalesce(p_provider,''),
  attempts = attempts || jsonb_build_array(jsonb_build_object('at',now(),'ok',true,'by',p_by)), updated_at=now()
  where entry_id = p_entry; $$;


--
-- Name: app_entries(text, boolean, boolean); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.app_entries(p_campaign text, p_include_removed boolean DEFAULT false, p_include_tests boolean DEFAULT true) RETURNS jsonb
    LANGUAGE sql STABLE
    AS $$
  select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc), '[]'::jsonb) from (
    select e.*, j.status as mail_status, j.sent_at as mail_sent_at, j.sent_by as mail_sent_by,
           j.send_count as mail_send_count, j.subject as mail_subject, j.attempts as mail_attempts
      from entry e left join email_job j on j.entry_id = e.id
     where e.campaign_id = p_campaign and (e.deleted_at is null or p_include_removed)
       and (e.is_test = false or p_include_tests) limit 5000) x; $$;


--
-- Name: app_entry(text, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.app_entry(p_campaign text, p_id uuid) RETURNS jsonb
    LANGUAGE sql STABLE
    AS $$
  select to_jsonb(x) from (
    select e.*, j.status as mail_status, j.send_count as mail_send_count, j.subject as mail_subject,
           j.html as mail_html, j.sent_at as mail_sent_at, j.sent_by as mail_sent_by
      from entry e left join email_job j on j.entry_id = e.id
     where e.campaign_id = p_campaign and e.id = p_id) x; $$;


--
-- Name: app_entry_update(text, uuid, jsonb, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.app_entry_update(p_campaign text, p_id uuid, p_patch jsonb, p_by text) RETURNS jsonb
    LANGUAGE plpgsql
    AS $$
declare v entry; v_note text; begin
  select * into v from entry where id = p_id and campaign_id = p_campaign for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'That entry no longer exists.'); end if;
  select string_agg(k || ' -> ' || coalesce(p_patch->>k,''), ', ') into v_note
    from jsonb_object_keys(p_patch) k where k in ('status','owner','reason','notes');
  update entry set status=coalesce(p_patch->>'status',status), owner=coalesce(p_patch->>'owner',owner),
    reason=coalesce(p_patch->>'reason',reason), notes=coalesce(p_patch->>'notes',notes), updated_at=now(),
    history = history || jsonb_build_array(jsonb_build_object('at',now(),'by',p_by,'what',coalesce(v_note,'updated')))
   where id = p_id returning * into v;
  return jsonb_build_object('ok', true, 'entry', to_jsonb(v)); end $$;


--
-- Name: app_lock(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.app_lock(p_user uuid) RETURNS jsonb
    LANGUAGE plpgsql
    AS $$
declare v integer; begin
  update staff set unlock_epoch = unlock_epoch + 1 where user_id = p_user returning unlock_epoch into v;
  insert into audit (actor,action,entity,entity_id) values (p_user::text,'admin_locked','staff',p_user::text);
  return jsonb_build_object('ok',true,'epoch',v); end $$;


--
-- Name: app_prize_save(text, jsonb, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.app_prize_save(p_campaign text, p_prize jsonb, p_by text) RETURNS jsonb
    LANGUAGE plpgsql
    AS $$
declare v prize; begin
  update prize set weight=coalesce((p_prize->>'weight')::int,weight), win_limit=coalesce((p_prize->>'limit')::int,win_limit),
    active=coalesce((p_prize->>'active')::boolean,active), info_url=coalesce(p_prize->>'infoUrl',info_url),
    email_fields=coalesce(p_prize->'emailFields',email_fields), updated_at=now()
   where campaign_id=p_campaign and id=p_prize->>'id' returning * into v;
  if not found then return jsonb_build_object('ok',false,'error','Unknown prize.'); end if;
  insert into audit (actor,action,entity,entity_id,detail) values (p_by,'prize_updated','prize',v.id,p_prize);
  return jsonb_build_object('ok',true,'prize',to_jsonb(v)); end $$;


--
-- Name: app_rate_ok(text, text, integer, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.app_rate_ok(p_bucket text, p_kind text, p_limit integer, p_minutes integer) RETURNS boolean
    LANGUAGE plpgsql
    AS $$
declare v_count integer; begin
  delete from rate_hit where at < now() - interval '1 day';
  select count(*) into v_count from rate_hit where bucket=p_bucket and kind=p_kind and at > now() - make_interval(mins=>p_minutes);
  if v_count >= p_limit then return false; end if;
  insert into rate_hit (bucket,kind) values (p_bucket,p_kind); return true; end $$;


--
-- Name: app_set_pin(text, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.app_set_pin(p_campaign text, p_pin text, p_by text) RETURNS jsonb
    LANGUAGE plpgsql
    AS $_$
begin
  if p_pin !~ '^[0-9]{4,8}$' then return jsonb_build_object('ok',false,'error','The PIN should be 4 to 8 digits.'); end if;
  update campaign set pin_hash = encode(digest(p_pin||id,'sha256'),'hex') where id=p_campaign;
  insert into audit (actor,action,entity,entity_id) values (p_by,'pin_changed','campaign',p_campaign);
  return jsonb_build_object('ok',true); end $_$;


--
-- Name: app_settings_get(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.app_settings_get(p_key text) RETURNS jsonb
    LANGUAGE sql STABLE
    AS $$
  select coalesce((select value from settings where key = p_key), '{}'::jsonb); $$;


--
-- Name: app_settings_save(text, jsonb, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.app_settings_save(p_key text, p_value jsonb, p_by text) RETURNS jsonb
    LANGUAGE plpgsql
    AS $$
begin insert into settings (key,value) values (p_key,p_value) on conflict (key) do update set value=excluded.value, updated_at=now();
  insert into audit (actor,action,entity,entity_id) values (p_by,'settings_saved','settings',p_key); return p_value; end $$;


--
-- Name: app_unlock(text, text, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.app_unlock(p_campaign text, p_pin text, p_user uuid) RETURNS jsonb
    LANGUAGE plpgsql
    AS $$
declare v_ok boolean; v_s staff; v_wait integer; begin
  select * into v_s from staff where user_id=p_user for update;
  if not found then return jsonb_build_object('ok',false,'error','Unknown account.'); end if;
  if v_s.pin_blocked_until is not null and v_s.pin_blocked_until > now() then
    v_wait := ceil(extract(epoch from (v_s.pin_blocked_until - now()))/60);
    return jsonb_build_object('ok',false,'blocked',true,'minutes',v_wait,
      'error','Too many wrong PINs. Try again in '||v_wait||' minute(s), or sign in again.'); end if;
  select exists (select 1 from campaign c where c.id=p_campaign
    and c.pin_hash = encode(digest(p_pin||c.id,'sha256'),'hex')) into v_ok;
  if v_ok then update staff set pin_fails=0, pin_blocked_until=null, last_seen_at=now() where user_id=p_user;
    return jsonb_build_object('ok',true,'epoch',v_s.unlock_epoch); end if;
  update staff set pin_fails=pin_fails+1,
    pin_blocked_until = case when pin_fails+1 >= 5 then now()+interval '5 minutes' else pin_blocked_until end
   where user_id=p_user returning * into v_s;
  insert into audit (actor,action,entity,entity_id,detail) values (v_s.email::text,'pin_failed','staff',p_user::text,
    jsonb_build_object('fails',v_s.pin_fails));
  if v_s.pin_fails >= 5 then return jsonb_build_object('ok',false,'blocked',true,'minutes',5,
    'error','Too many wrong PINs. Try again in 5 minutes, or sign in again.'); end if;
  return jsonb_build_object('ok',false,'left',5-v_s.pin_fails,
    'error','Wrong PIN. '||(5-v_s.pin_fails)||' tries left before this tablet is locked out.'); end $$;


--
-- Name: app_unlock_is_revoked(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.app_unlock_is_revoked(p_jti text) RETURNS boolean
    LANGUAGE sql STABLE
    AS $$
  select exists (select 1 from unlock_revoked where jti = p_jti); $$;


--
-- Name: app_unlock_revoke(text, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.app_unlock_revoke(p_jti text, p_user uuid) RETURNS jsonb
    LANGUAGE plpgsql
    AS $$
begin insert into unlock_revoked (jti,user_id) values (p_jti,p_user) on conflict (jti) do nothing;
  insert into audit (actor,action,entity,entity_id) values (p_user::text,'tablet_locked','staff',p_user::text);
  return jsonb_build_object('ok',true); end $$;


--
-- Name: draw_prize(text, text, text, text, text, text, boolean); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.draw_prize(p_campaign text, p_email text, p_name text, p_phone text DEFAULT ''::text, p_book text DEFAULT ''::text, p_tablet text DEFAULT ''::text, p_is_test boolean DEFAULT false) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare v_c campaign; v_existing entry; v_total numeric; v_roll numeric; v_acc numeric := 0;
  v_pick prize; v_row prize; v_entry entry; v_ref text;
begin
  select * into v_c from campaign where id = p_campaign;
  if not found then return jsonb_build_object('state','error','error','Unknown campaign.'); end if;
  if p_email is null or btrim(p_email)='' then return jsonb_build_object('state','error','error','An email address is needed.'); end if;
  select * into v_existing from entry where campaign_id=p_campaign and email=btrim(p_email)::citext
    and deleted_at is null and is_test=false for update;
  if found then
    update entry set repeats=repeats+1, updated_at=now() where id=v_existing.id;
    return jsonb_build_object('state','already','entry',to_jsonb(v_existing));
  end if;
  perform 1 from prize where campaign_id=p_campaign order by id for update;
  select coalesce(sum(p.weight),0) into v_total from prize p
   where p.campaign_id=p_campaign and p.active and p.weight>0
     and (select count(*) from entry e where e.campaign_id=p_campaign and e.prize_id=p.id and e.deleted_at is null and e.is_test=false) < p.win_limit;
  if v_total<=0 then return jsonb_build_object('state','closed'); end if;
  v_roll := random()*v_total;
  for v_row in select p.* from prize p where p.campaign_id=p_campaign and p.active and p.weight>0
      and (select count(*) from entry e where e.campaign_id=p_campaign and e.prize_id=p.id and e.deleted_at is null and e.is_test=false) < p.win_limit
      order by p.sort, p.id
  loop v_acc := v_acc + v_row.weight; if v_roll < v_acc then v_pick := v_row; exit; end if; end loop;
  if v_pick is null then return jsonb_build_object('state','closed'); end if;
  v_ref := new_claim_ref();
  insert into entry (campaign_id,email,name,phone,book_title,prize_id,prize_name,claim_ref,claim_by,
    consent_version,consent_at,rules_version,tablet,is_test,history)
  values (p_campaign, btrim(p_email)::citext, p_name, p_phone, p_book, v_pick.id, v_pick.name, v_ref,
    now()+make_interval(days=>v_c.claim_days), v_c.consent_version, now(), v_c.rules_version, p_tablet, p_is_test,
    jsonb_build_array(jsonb_build_object('at',now(),'by',coalesce(nullif(p_tablet,''),'kiosk'),'what','Prize awarded: '||v_pick.name)))
  returning * into v_entry;
  insert into email_job (entry_id,status) values (v_entry.id, case when p_is_test then 'cancelled' else 'pending' end);
  insert into audit (actor,action,entity,entity_id,detail) values (coalesce(nullif(p_tablet,''),'kiosk'),
    case when p_is_test then 'test_entry_created' else 'entry_created' end,'entry',v_entry.id::text,
    jsonb_build_object('campaign',p_campaign,'prize',v_pick.id,'claim_ref',v_ref));
  return jsonb_build_object('state','won','entry',to_jsonb(v_entry),'prize',to_jsonb(v_pick));
end $$;


--
-- Name: new_claim_ref(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.new_claim_ref() RETURNS text
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare v_ref text; i integer := 0;
begin
  loop
    v_ref := 'ATC-' || upper(substr(translate(gen_random_uuid()::text,'-o0il1',''), 1, 6));
    exit when not exists (select 1 from entry where claim_ref = v_ref);
    i := i + 1; if i > 10 then v_ref := 'ATC-' || upper(substr(translate(gen_random_uuid()::text,'-',''),1,10)); exit; end if;
  end loop; return v_ref;
end $$;


--
-- Name: remove_entry(text, uuid, text, text, boolean); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.remove_entry(p_campaign text, p_entry_id uuid, p_actor text, p_reason text DEFAULT ''::text, p_force boolean DEFAULT false) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare v_entry entry; v_job email_job;
begin
  select * into v_entry from entry where id = p_entry_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'That entry no longer exists.');
  end if;
  -- the guard: an entry from another campaign is refused, and nothing about it is revealed
  if v_entry.campaign_id is distinct from p_campaign then
    return jsonb_build_object('ok', false, 'error', 'That entry belongs to another campaign.');
  end if;
  if v_entry.deleted_at is not null then
    return jsonb_build_object('ok', true, 'already', true, 'entry', to_jsonb(v_entry));  -- idempotent
  end if;
  if v_entry.status in ('Claimed','Fulfilled') and not p_force then
    return jsonb_build_object('ok', false, 'needs_review', true,
      'error', 'This prize is marked ' || v_entry.status || '. Handle it separately before removing the entry.');
  end if;

  select * into v_job from email_job where entry_id = v_entry.id for update;

  update entry
     set deleted_at = now(), deleted_by = p_actor, delete_reason = p_reason, updated_at = now(),
         history = history || jsonb_build_array(jsonb_build_object('at', now(), 'by', p_actor,
                   'what', 'Entry removed; ' || v_entry.prize_name || ' returned to stock'))
   where id = v_entry.id
   returning * into v_entry;

  update email_job
     set status = case when status = 'sent' then 'sent' else 'cancelled' end, updated_at = now()
   where entry_id = v_entry.id;

  insert into audit (actor, action, entity, entity_id, detail)
  values (p_actor, 'entry_removed', 'entry', v_entry.id::text,
          jsonb_build_object('prize', v_entry.prize_id, 'claim_ref', v_entry.claim_ref,
                             'stock_returned', 1, 'reason', p_reason,
                             'email_was', coalesce(v_job.status,'none')));

  return jsonb_build_object('ok', true, 'entry', to_jsonb(v_entry),
    'stock_returned', 1,
    'email_already_sent', coalesce(v_job.status,'none') = 'sent');
end $$;


--
-- Name: wheel_state(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.wheel_state(p_campaign text DEFAULT 'fbf26'::text) RETURNS jsonb
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select coalesce(jsonb_agg(x order by (x->>'sort')::int), '[]'::jsonb) from (
    select jsonb_build_object('id',p.id,'name',p.name,'short',p.short,'lines',p.lines,'worth',p.worth,
      'weight',p.weight,'limit',p.win_limit,'active',p.active,'infoUrl',p.info_url,'emailFields',p.email_fields,'sort',p.sort,
      'won',(select count(*) from entry e where e.campaign_id=p.campaign_id and e.prize_id=p.id and e.deleted_at is null and e.is_test=false),
      'left',greatest(0,p.win_limit-(select count(*) from entry e where e.campaign_id=p.campaign_id and e.prize_id=p.id and e.deleted_at is null and e.is_test=false))) as x
    from prize p where p.campaign_id=p_campaign order by p.sort) s; $$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: audit; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.audit (
    id bigint NOT NULL,
    at timestamp with time zone DEFAULT now() NOT NULL,
    actor text DEFAULT ''::text NOT NULL,
    action text NOT NULL,
    entity text DEFAULT ''::text NOT NULL,
    entity_id text DEFAULT ''::text NOT NULL,
    detail jsonb DEFAULT '{}'::jsonb NOT NULL
);


--
-- Name: audit_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.audit_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: audit_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.audit_id_seq OWNED BY public.audit.id;


--
-- Name: campaign; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.campaign (
    id text NOT NULL,
    name text NOT NULL,
    starts_on date,
    ends_on date,
    claim_days integer DEFAULT 60 NOT NULL,
    rules_version text DEFAULT '1.0'::text NOT NULL,
    consent_version text DEFAULT '1.0'::text NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    pin_hash text DEFAULT ''::text NOT NULL,
    session_hours integer DEFAULT 12 NOT NULL,
    lock_after_minutes integer DEFAULT 3 NOT NULL,
    is_preview boolean DEFAULT false NOT NULL
);


--
-- Name: email_job; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.email_job (
    entry_id uuid NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    subject text DEFAULT ''::text NOT NULL,
    html text DEFAULT ''::text NOT NULL,
    attempts jsonb DEFAULT '[]'::jsonb NOT NULL,
    sent_at timestamp with time zone,
    sent_by text DEFAULT ''::text NOT NULL,
    send_count integer DEFAULT 0 NOT NULL,
    provider_id text DEFAULT ''::text NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: entry; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.entry (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    campaign_id text NOT NULL,
    email public.citext NOT NULL,
    name text NOT NULL,
    phone text DEFAULT ''::text NOT NULL,
    book_title text DEFAULT ''::text NOT NULL,
    prize_id text NOT NULL,
    prize_name text NOT NULL,
    claim_ref text NOT NULL,
    claim_by timestamp with time zone NOT NULL,
    status text DEFAULT 'Awarded'::text NOT NULL,
    owner text DEFAULT ''::text NOT NULL,
    reason text DEFAULT ''::text NOT NULL,
    notes text DEFAULT ''::text NOT NULL,
    history jsonb DEFAULT '[]'::jsonb NOT NULL,
    consent_version text DEFAULT ''::text NOT NULL,
    consent_at timestamp with time zone,
    rules_version text DEFAULT ''::text NOT NULL,
    tablet text DEFAULT ''::text NOT NULL,
    is_test boolean DEFAULT false NOT NULL,
    repeats integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone,
    deleted_by text,
    delete_reason text
);


--
-- Name: prize; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.prize (
    campaign_id text NOT NULL,
    id text NOT NULL,
    name text NOT NULL,
    short text NOT NULL,
    lines jsonb DEFAULT '[]'::jsonb NOT NULL,
    worth text DEFAULT ''::text NOT NULL,
    weight integer NOT NULL,
    win_limit integer NOT NULL,
    active boolean DEFAULT true NOT NULL,
    info_url text DEFAULT ''::text NOT NULL,
    email_fields jsonb DEFAULT '{}'::jsonb NOT NULL,
    sort integer NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT prize_weight_check CHECK ((weight >= 0)),
    CONSTRAINT prize_win_limit_check CHECK ((win_limit >= 0))
);


--
-- Name: rate_hit; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.rate_hit (
    id bigint NOT NULL,
    bucket text NOT NULL,
    kind text NOT NULL,
    at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: rate_hit_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.rate_hit_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: rate_hit_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.rate_hit_id_seq OWNED BY public.rate_hit.id;


--
-- Name: settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.settings (
    key text NOT NULL,
    value jsonb NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: staff; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.staff (
    user_id uuid NOT NULL,
    email public.citext NOT NULL,
    name text DEFAULT ''::text NOT NULL,
    role text DEFAULT 'admin'::text NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    last_seen_at timestamp with time zone,
    unlock_epoch integer DEFAULT 1 NOT NULL,
    pin_fails integer DEFAULT 0 NOT NULL,
    pin_blocked_until timestamp with time zone,
    CONSTRAINT staff_role_check CHECK ((role = 'admin'::text))
);


--
-- Name: unlock_revoked; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.unlock_revoked (
    jti text NOT NULL,
    user_id uuid NOT NULL,
    at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: audit id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit ALTER COLUMN id SET DEFAULT nextval('public.audit_id_seq'::regclass);


--
-- Name: rate_hit id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rate_hit ALTER COLUMN id SET DEFAULT nextval('public.rate_hit_id_seq'::regclass);


--
-- Name: audit audit_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit
    ADD CONSTRAINT audit_pkey PRIMARY KEY (id);


--
-- Name: campaign campaign_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.campaign
    ADD CONSTRAINT campaign_pkey PRIMARY KEY (id);


--
-- Name: email_job email_job_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_job
    ADD CONSTRAINT email_job_pkey PRIMARY KEY (entry_id);


--
-- Name: entry entry_claim_ref_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.entry
    ADD CONSTRAINT entry_claim_ref_key UNIQUE (claim_ref);


--
-- Name: entry entry_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.entry
    ADD CONSTRAINT entry_pkey PRIMARY KEY (id);


--
-- Name: prize prize_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.prize
    ADD CONSTRAINT prize_pkey PRIMARY KEY (campaign_id, id);


--
-- Name: rate_hit rate_hit_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rate_hit
    ADD CONSTRAINT rate_hit_pkey PRIMARY KEY (id);


--
-- Name: settings settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.settings
    ADD CONSTRAINT settings_pkey PRIMARY KEY (key);


--
-- Name: staff staff_email_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.staff
    ADD CONSTRAINT staff_email_key UNIQUE (email);


--
-- Name: staff staff_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.staff
    ADD CONSTRAINT staff_pkey PRIMARY KEY (user_id);


--
-- Name: unlock_revoked unlock_revoked_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.unlock_revoked
    ADD CONSTRAINT unlock_revoked_pkey PRIMARY KEY (jti);


--
-- Name: entry_campaign_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX entry_campaign_created ON public.entry USING btree (campaign_id, created_at DESC);


--
-- Name: entry_one_per_author_per_campaign; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX entry_one_per_author_per_campaign ON public.entry USING btree (campaign_id, email) WHERE ((deleted_at IS NULL) AND (is_test = false));


--
-- Name: entry_prize_live; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX entry_prize_live ON public.entry USING btree (campaign_id, prize_id) WHERE ((deleted_at IS NULL) AND (is_test = false));


--
-- Name: rate_hit_lookup; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX rate_hit_lookup ON public.rate_hit USING btree (bucket, kind, at DESC);


--
-- Name: email_job email_job_entry_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_job
    ADD CONSTRAINT email_job_entry_id_fkey FOREIGN KEY (entry_id) REFERENCES public.entry(id) ON DELETE CASCADE;


--
-- Name: entry entry_campaign_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.entry
    ADD CONSTRAINT entry_campaign_id_fkey FOREIGN KEY (campaign_id) REFERENCES public.campaign(id);


--
-- Name: entry entry_prize_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.entry
    ADD CONSTRAINT entry_prize_fkey FOREIGN KEY (campaign_id, prize_id) REFERENCES public.prize(campaign_id, id);


--
-- Name: prize prize_campaign_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.prize
    ADD CONSTRAINT prize_campaign_id_fkey FOREIGN KEY (campaign_id) REFERENCES public.campaign(id);


--
-- PostgreSQL database dump complete
--

\unrestrict 7TsVqNMlROgoJlfBhdXIATSGPjUtBmneFlzABG9SJKeFWBR8USw58QOrp3ZK0fr


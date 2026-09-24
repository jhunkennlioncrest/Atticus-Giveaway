-- 001 — core functions.
-- These four were written directly in Supabase while building and never made it into the
-- migration files, so a database built from these files alone was missing the draw itself.
-- Taken verbatim from the working database. Idempotent: safe to run against Supabase.

CREATE OR REPLACE FUNCTION public.new_claim_ref() RETURNS text
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

CREATE OR REPLACE FUNCTION public.draw_prize(p_campaign text, p_email text, p_name text, p_phone text DEFAULT ''::text, p_book text DEFAULT ''::text, p_tablet text DEFAULT ''::text, p_is_test boolean DEFAULT false) RETURNS jsonb
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

CREATE OR REPLACE FUNCTION public.wheel_state(p_campaign text DEFAULT 'fbf26'::text) RETURNS jsonb
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select coalesce(jsonb_agg(x order by (x->>'sort')::int), '[]'::jsonb) from (
    select jsonb_build_object('id',p.id,'name',p.name,'short',p.short,'lines',p.lines,'worth',p.worth,
      'weight',p.weight,'limit',p.win_limit,'active',p.active,'infoUrl',p.info_url,'emailFields',p.email_fields,'sort',p.sort,
      'won',(select count(*) from entry e where e.campaign_id=p.campaign_id and e.prize_id=p.id and e.deleted_at is null and e.is_test=false),
      'left',greatest(0,p.win_limit-(select count(*) from entry e where e.campaign_id=p.campaign_id and e.prize_id=p.id and e.deleted_at is null and e.is_test=false))) as x
    from prize p where p.campaign_id=p_campaign order by p.sort) s; $$;

CREATE OR REPLACE FUNCTION public.app_set_pin(p_campaign text, p_pin text, p_by text) RETURNS jsonb
    LANGUAGE plpgsql
    AS $_$
begin
  if p_pin !~ '^[0-9]{4,8}$' then return jsonb_build_object('ok',false,'error','The PIN should be 4 to 8 digits.'); end if;
  update campaign set pin_hash = encode(digest(p_pin||id,'sha256'),'hex') where id=p_campaign;
  insert into audit (actor,action,entity,entity_id) values (p_by,'pin_changed','campaign',p_campaign);
  return jsonb_build_object('ok',true); end $_$;

-- only the server's key may call these; role names differ between Supabase and a local mirror
do $do$
declare f record; r text;
begin
  for f in select p.oid::regprocedure::text as sig from pg_proc p
           join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public'
             and p.proname in ('draw_prize','wheel_state','new_claim_ref','app_set_pin')
  loop
    execute format('revoke all on function %s from public', f.sig);
    foreach r in array array['anon','authenticated'] loop
      if exists (select 1 from pg_roles where rolname = r) then
        execute format('revoke all on function %s from %I', f.sig, r);
      end if;
    end loop;
    if exists (select 1 from pg_roles where rolname = 'service_role') then
      execute format('grant execute on function %s to service_role', f.sig);
    end if;
  end loop;
end $do$;

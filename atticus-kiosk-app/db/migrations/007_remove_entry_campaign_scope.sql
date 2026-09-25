-- 006 — an entry can only be removed by the campaign that owns it.
-- Before this, remove_entry trusted the entry id alone, so a preview deployment holding a
-- production entry id could have removed a real winner. The campaign is now checked inside
-- the function, where no caller can skip it.
-- Everything else is unchanged from the original function.

drop function if exists remove_entry(uuid, text, text, boolean);

CREATE OR REPLACE FUNCTION public.remove_entry(p_campaign text, p_entry_id uuid, p_actor text, p_reason text DEFAULT ''::text, p_force boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
end $function$;

-- only the server's key may call this; role names differ between Supabase and a local mirror
revoke all on function remove_entry(text, uuid, text, text, boolean) from public;
do $$
declare r text;
begin
  foreach r in array array['anon','authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on function remove_entry(text, uuid, text, text, boolean) from %I', r);
    end if;
  end loop;
  foreach r in array array['service_role','kiosk'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('grant execute on function remove_entry(text, uuid, text, text, boolean) to %I', r);
    end if;
  end loop;
end $$;

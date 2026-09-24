-- 010 — a test entry never takes stock, so removing one must not claim a unit came back.
-- The stock counter itself was always correct (wheel_state ignores test entries); only the
-- number reported to staff was wrong, which made the removal message say a prize had been
-- restored when nothing moved. Same for an entry with no prize.
-- Applied to the Supabase project on 25 Sep 2026.

CREATE OR REPLACE FUNCTION public.remove_entry(p_campaign text, p_entry_id uuid, p_actor text, p_reason text DEFAULT ''::text, p_force boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_entry entry; v_job email_job; v_returned int;
begin
  select * into v_entry from entry where id = p_entry_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'That entry no longer exists.');
  end if;
  if v_entry.campaign_id is distinct from p_campaign then
    return jsonb_build_object('ok', false, 'error', 'That entry belongs to another campaign.');
  end if;
  if v_entry.deleted_at is not null then
    return jsonb_build_object('ok', true, 'already', true, 'entry', to_jsonb(v_entry));
  end if;
  if v_entry.status in ('Claimed','Fulfilled') and not p_force then
    return jsonb_build_object('ok', false, 'needs_review', true,
      'error', 'This prize is marked ' || v_entry.status || '. Handle it separately before removing the entry.');
  end if;

  -- a test entry took nothing, so nothing comes back
  v_returned := case when coalesce(v_entry.is_test, false) or v_entry.prize_id is null then 0 else 1 end;

  select * into v_job from email_job where entry_id = v_entry.id for update;

  update entry
     set deleted_at = now(), deleted_by = p_actor, delete_reason = p_reason, updated_at = now(),
         history = history || jsonb_build_array(jsonb_build_object('at', now(), 'by', p_actor,
                   'what', case when v_returned = 1
                                then 'Entry removed; ' || v_entry.prize_name || ' returned to stock'
                                else 'Test entry removed; no stock was used' end))
   where id = v_entry.id
   returning * into v_entry;

  update email_job
     set status = case when status = 'sent' then 'sent' else 'cancelled' end, updated_at = now()
   where entry_id = v_entry.id;

  insert into audit (actor, action, entity, entity_id, detail)
  values (p_actor, 'entry_removed', 'entry', v_entry.id::text,
          jsonb_build_object('prize', v_entry.prize_id, 'claim_ref', v_entry.claim_ref,
                             'stock_returned', v_returned, 'is_test', coalesce(v_entry.is_test,false),
                             'reason', p_reason, 'email_was', coalesce(v_job.status,'none')));

  return jsonb_build_object('ok', true, 'entry', to_jsonb(v_entry),
    'stock_returned', v_returned,
    'email_already_sent', coalesce(v_job.status,'none') = 'sent');
end $function$;

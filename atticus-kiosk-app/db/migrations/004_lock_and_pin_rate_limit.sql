alter table staff add column if not exists unlock_epoch integer not null default 1;
alter table staff add column if not exists pin_fails integer not null default 0;
alter table staff add column if not exists pin_blocked_until timestamptz;
create or replace function app_lock(p_user uuid) returns jsonb language plpgsql as $$
declare v integer; begin
  update staff set unlock_epoch = unlock_epoch + 1 where user_id = p_user returning unlock_epoch into v;
  insert into audit (actor,action,entity,entity_id) values (p_user::text,'admin_locked','staff',p_user::text);
  return jsonb_build_object('ok',true,'epoch',v); end $$;
drop function if exists app_unlock(text,text);
create or replace function app_unlock(p_campaign text, p_pin text, p_user uuid) returns jsonb language plpgsql as $$
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

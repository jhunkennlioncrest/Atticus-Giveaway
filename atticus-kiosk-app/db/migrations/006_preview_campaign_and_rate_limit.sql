alter table campaign add column if not exists is_preview boolean not null default false;
insert into campaign (id,name,is_preview,pin_hash) values ('preview','PREVIEW — testing only',true,
  encode(digest('2026preview','sha256'),'hex')) on conflict (id) do nothing;
insert into prize (campaign_id,id,name,short,lines,worth,weight,win_limit,sort,info_url,email_fields)
select 'preview',id,name,short,lines,worth,weight,win_limit,sort,info_url,email_fields from prize where campaign_id='fbf26'
on conflict (campaign_id,id) do nothing;
create table if not exists rate_hit (id bigserial primary key, bucket text not null, kind text not null, at timestamptz not null default now());
create index if not exists rate_hit_lookup on rate_hit (bucket,kind,at desc);
create or replace function app_rate_ok(p_bucket text,p_kind text,p_limit integer,p_minutes integer) returns boolean language plpgsql as $$
declare v_count integer; begin
  delete from rate_hit where at < now() - interval '1 day';
  select count(*) into v_count from rate_hit where bucket=p_bucket and kind=p_kind and at > now() - make_interval(mins=>p_minutes);
  if v_count >= p_limit then return false; end if;
  insert into rate_hit (bucket,kind) values (p_bucket,p_kind); return true; end $$;

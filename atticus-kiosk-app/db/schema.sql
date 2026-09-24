create extension if not exists citext;
create extension if not exists pgcrypto;

create table campaign (
  id text primary key, name text not null, starts_on date, ends_on date,
  claim_days integer not null default 60, rules_version text not null default '1.0',
  consent_version text not null default '1.0', is_active boolean not null default true,
  created_at timestamptz not null default now());

create table prize (
  campaign_id text not null references campaign(id), id text not null,
  name text not null, short text not null, lines jsonb not null default '[]'::jsonb,
  worth text not null default '', weight integer not null check (weight >= 0),
  win_limit integer not null check (win_limit >= 0), active boolean not null default true,
  info_url text not null default '', email_fields jsonb not null default '{}'::jsonb,
  sort integer not null, updated_at timestamptz not null default now(),
  primary key (campaign_id, id));

create table entry (
  id uuid primary key default gen_random_uuid(), campaign_id text not null references campaign(id),
  email citext not null, name text not null, phone text not null default '',
  book_title text not null default '', prize_id text not null, prize_name text not null,
  claim_ref text not null unique, claim_by timestamptz not null,
  status text not null default 'Awarded', owner text not null default '', reason text not null default '',
  notes text not null default '', history jsonb not null default '[]'::jsonb,
  consent_version text not null default '', consent_at timestamptz, rules_version text not null default '',
  tablet text not null default '', is_test boolean not null default false, repeats integer not null default 0,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  deleted_at timestamptz, deleted_by text, delete_reason text,
  constraint entry_prize_fkey foreign key (campaign_id, prize_id) references prize(campaign_id, id));

create unique index entry_one_per_author_per_campaign on entry (campaign_id, email)
  where deleted_at is null and is_test = false;
create index entry_prize_live on entry (campaign_id, prize_id) where deleted_at is null and is_test = false;
create index entry_campaign_created on entry (campaign_id, created_at desc);

create table email_job (
  entry_id uuid primary key references entry(id) on delete cascade,
  status text not null default 'pending', subject text not null default '', html text not null default '',
  attempts jsonb not null default '[]'::jsonb, sent_at timestamptz, sent_by text not null default '',
  send_count integer not null default 0, provider_id text not null default '',
  updated_at timestamptz not null default now());

create table settings (key text primary key, value jsonb not null, updated_at timestamptz not null default now());
create table audit (id bigserial primary key, at timestamptz not null default now(), actor text not null default '',
  action text not null, entity text not null default '', entity_id text not null default '',
  detail jsonb not null default '{}'::jsonb);
create table staff (user_id uuid primary key, email citext not null unique, name text not null default '',
  role text not null default 'admin' check (role = 'admin'), is_active boolean not null default true,
  created_at timestamptz not null default now(), last_seen_at timestamptz);

insert into campaign (id,name,starts_on,ends_on) values ('fbf26','Frankfurter Buchmesse 2026','2026-10-07','2026-10-11');
insert into prize (campaign_id,id,name,short,lines,worth,weight,win_limit,sort) values
 ('fbf26','v2500','$2,500 Publishing/ Marketing Voucher','$2,500','["$2,500","voucher"]','$2,500 to spend with us',1,1,1),
 ('fbf26','pkg','Standard Publishing Package','Package','["Publishing","package"]','Worth $1,599',2,2,2),
 ('fbf26','logan','Global Book Network with Logan','GBN','["Global Book","Network"]','Your story, on camera',2,2,3),
 ('fbf26','video','Cinematic Book Video','Video','["Cinematic","book video"]','Worth $2,000',3,3,4),
 ('fbf26','bs2','2 Partnered Bookstore Display','2 stores','["2 bookstore","displays"]','Your book in 2 US stores',3,3,5),
 ('fbf26','bs1','1 Partnered Bookstore Display','1 store','["1 bookstore","display"]','Your book in a US store',4,4,6),
 ('fbf26','v800','$800 Publishing/Marketing Voucher','$800','["$800","voucher"]','$800 to spend with us',2,2,7),
 ('fbf26','v250','$250 Publishing/Marketing Voucher','$250','["$250","voucher"]','$250 to spend with us',7,7,8),
 ('fbf26','v100','$100 Publishing/Marketing Voucher','$100','["$100","voucher"]','$100 to spend with us',25,25,9),
 ('fbf26','v80','$80 Publishing/Marketing Voucher','$80','["$80","voucher"]','$80 to spend with us',51,50,10);
insert into settings (key,value) values ('email_shared','{}'::jsonb);

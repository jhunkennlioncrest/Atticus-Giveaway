-- 003 — the admin columns on campaign.
-- These were added directly in Supabase while building, so they were missing from the
-- migration files: 002 drops pin_hash, and nothing put it back, which left a database
-- built from these files alone unable to run 005 or the PIN unlock. Idempotent, so running
-- it against Supabase (where the columns already exist) changes nothing.

alter table campaign add column if not exists pin_hash           text    not null default '';
alter table campaign add column if not exists session_hours      integer not null default 12;
alter table campaign add column if not exists lock_after_minutes integer not null default 3;

-- the default PIN for any campaign that has none yet
update campaign set pin_hash = encode(digest('2026' || id, 'sha256'), 'hex') where pin_hash = '';

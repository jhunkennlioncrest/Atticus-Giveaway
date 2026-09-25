-- 008 — settings are stored per campaign ("key:campaign") from v1.3.1 onward.
-- The unscoped rows written by earlier versions would otherwise be invisible to the app.
-- Copies each to both campaigns, then removes the unscoped row. Never overwrites.
insert into settings (key, value, updated_at)
select s.key || ':' || c.id, s.value, now()
from settings s
cross join (select id from campaign where id in ('fbf26','preview')) c
where s.key not like '%:%'
on conflict (key) do nothing;

delete from settings where key not like '%:%';

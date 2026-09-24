-- 011 — the campaign payload is served to anyone who loads the page, and it carried
-- pin_hash. A four-digit PIN behind a plain SHA-256 is recoverable offline in moments, so
-- publishing the hash defeated the point of the PIN on an unattended tablet.
--
-- Nothing outside the database reads it: app_unlock does the comparison internally, and
-- neither the server nor the page references pin_hash. Removed from the payload only; the
-- column and the PIN itself are unchanged.
--
-- Applied to the Supabase project on 25 Sep 2026 and verified against the live preview:
-- the public response no longer carries pin_hash, the correct PIN still unlocks, and a
-- wrong PIN is still refused.

CREATE OR REPLACE FUNCTION public.app_campaign(p_campaign text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select to_jsonb(c) - 'pin_hash' from campaign c where c.id = p_campaign;
$function$;

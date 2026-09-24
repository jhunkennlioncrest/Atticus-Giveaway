# Atticus Spin to Win — v1.3.1

A public prize wheel for the Atticus stand, plus an admin area. Entries, prizes and stock
live in a shared Supabase database (Frankfurt), so every tablet and phone sees the same
thing and two devices can never hand out the same last prize.

**This version does NOT work from browser storage and does NOT work offline.** Every spin
needs the server. That is the price of shared stock and one entry per author across devices.

## What's in this folder
- `index.html` — the whole app: public wheel and admin area
- `set-password.html` — where invitation and password-reset links land
- `api/app.js` — the server: draw, entries, emails, admin sign-in
- `api/_core.js`, `api/_email.js` — shared server logic and the winner-email wording
- `api/send-email.js` — the manual test-send endpoint used by Settings
- `db/` — the database schema and migrations
- `tests/` — the test suites, and how to run them
- `vercel.json`, `_headers`, `manifest.webmanifest`, `sw.js`, `icons/`, `fonts/`

## Deploy a PREVIEW (does not touch production)
1. In GitHub, make a branch (for example `preview`) and upload this folder's contents into
   `atticus-kiosk-app` on that branch. Vercel builds a preview automatically.
2. Vercel → Settings → Environment Variables, scope **Preview** only:

   | Name | Value | Needed |
   |---|---|---|
   | `CAMPAIGN_ID` | `preview` | **yes** — locks this deployment to the test campaign. There is no default: without it the server refuses every request rather than guessing the live campaign. A non-production Vercel deployment is refused any value except `preview`. |
   | `SUPABASE_URL` | `https://<project>.supabase.co` | yes |
   | `SUPABASE_SERVICE_KEY` | service_role key | yes |
   | `ADMIN_SIGNING_SECRET` | long random string | yes — signs admin unlock codes |
   | `EMAIL_PROVIDER` | `resend` or `zeptomail` | for sending |
   | `FROM_ADDRESS` | `Atticus Publishing <no-reply@yourdomain>` | for sending |
   | `RESEND_API_KEY` or `ZEPTO_TOKEN` | provider key | for sending |
   | `ZEPTO_HOST` | `api.zeptomail.eu` / `.in` | ZeptoMail outside the US |
   | `EMAIL_SEND_KEY` | long random string | only for the test-send button |
   | `SITE_URL` | `https://<your-preview>.vercel.app` | only if the deployment sits behind a custom domain; otherwise Vercel's own `VERCEL_URL` is used |

   No self-address setting is needed: email is sent inside `api/app.js`.
3. Open the preview URL. No URL parameter is needed or accepted: the deployment decides
   its campaign, and a request naming a different one is refused.

**Production** uses the same files with `CAMPAIGN_ID=fbf26` and its own copies of the rest.

## Supabase
### A database that already exists (our Supabase project)
**Nothing to run — already applied on 25 Sep 2026:** migrations 007 (campaign check inside
`remove_entry`), 008 (settings scoped per campaign) and 009 (row-level security on
`rate_hit`). Verified afterwards: the guard refuses a cross-campaign removal, the eight
settings rows carry campaign suffixes, and the security linter reports no errors.

Do not re-run `schema.sql`. The other files in `db/` are already live on our project and
exist so a new database can be built from scratch.

### A brand-new database
`db/000_roles.sql`, then `db/schema.sql`, then every file in `db/migrations/` in numerical
order. `db/schema-reference.sql` is the full structure for comparison.

### Invitation and reset links (one-time setup)
Supabase → Authentication → URL Configuration → Redirect URLs, add both:
`https://<your-preview>.vercel.app/set-password.html` and the production equivalent.
Supabase only redirects to addresses on that list; without it, invitation and reset links
land on the wrong page. The server asks for that address on every invite and reset.
- Row-level security is on for every table with no public policies. Only the service key,
  held by the server, can read or write. The anon key reads nothing.

## Admin
- **Sign in once per tablet** with an email and password (Supabase Auth).
- **PIN** (default 2026) reopens the admin view between authors; it authorises nothing on
  its own. Five wrong tries locks that account out for five minutes.
- **Hand to author** kills this tablet's unlock on the server. Other tablets carry on.
- **Log out** ends this tablet's session; the PIN alone is then useless here.
- **Test mode** marks entries as tests: no stock used, no email, kept out of reporting.
- **Remove entry** returns exactly the stock it used, once, and cancels an unsent email.

## Adding another admin
Supabase → Authentication → Users → Add user (set a password, auto-confirm), or send an
invitation, which lands on `set-password.html`. Then link the account:
`select app_admin_add('<user-uuid>'::uuid,'<email>','<name>','setup');`

## Emails
Winner emails are written per prize in Staff → Emails and stored on the server, so every
device shares them. An email with any detail still missing **cannot be sent**: Done queues
it and staff see what's outstanding. Test sends go to one nominated address from Settings.

## During the fair
Entries are in the database, not the tablet, so nothing is lost if a tablet dies. Export
from Staff → Entries whenever you want a copy.

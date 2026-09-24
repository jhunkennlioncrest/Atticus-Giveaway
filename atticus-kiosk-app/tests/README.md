# Tests — how to run them

## Two kinds, kept apart

**Local app tests — these are the ones that have been run.** The real server code in `api/`
runs against a local PostgreSQL database carrying the same schema as Supabase, and the real
`index.html` is driven in two browsers. Two things are stand-ins: Supabase Auth (passwords)
and the email provider (sends are captured, not delivered).

**Deployed tests — NOT run.** Nothing here has been tested on a live Vercel deployment or
through Supabase from the app. The database functions were checked directly in Supabase.
The first preview deploy is the first real test of the Vercel variables, the invitation and
reset emails, and live sending.

## Dependencies
- Node.js 20 or newer (uses built-in `fetch`)
- PostgreSQL 14 or newer, with the `citext` and `pgcrypto` extensions available
- `npm install pg` (the only Node dependency)
- For the browser suites: Python 3.10+, `pip install playwright` then `playwright install chromium`

## Setup
```bash
# 1. database
createdb kiosk_test
psql -d kiosk_test -c "create role kiosk login password 'kiosk'; grant all on database kiosk_test to kiosk;"
psql -d kiosk_test -f ../db/schema.sql
for f in ../db/migrations/*.sql; do psql -d kiosk_test -v ON_ERROR_STOP=1 -f "$f"; done
# ../db/schema-reference.sql is the full structure including every function, for comparison

# 2. test server (connection details are at the top of server.js)
CAMPAIGN_ID=preview node server.js        # listens on 8770; PORT overrides

# 3. a fresh state and an admin account, before each suite
curl -s "localhost:8770/__reset"
curl -s "localhost:8770/__admin?email=john@atticus.test&password=secret123&name=John"
```

## Commands
```bash
# server suites (74 checks)
node apitest.js          # 17  draw, repeats, Done sending/queueing, test mode, removal, six-way race
node authtest.js         # 17  sign-in, session cookie, PIN unlock, logout
node locktest.js         # 12  locking kills the unlock server-side, PIN rate limiting
node twotablets.js       #  7  locking one tablet leaves another admin working
node publictest.js       #  7  public QR entry, deployment-locked campaign, abuse limits
node crosscampaign.js    #  6  an entry from another campaign cannot be removed here
node configtest.js       #  3  the server refuses to run without CAMPAIGN_ID
node vercelconfigtest.js #  5  api/app.js guards: missing or mismatched deployment config

# browser suites (33 checks) — run from the folder holding these files
python3 t10.py           # 14  two browsers: shared entries, cross-device repeat block, hand-over
python3 t11.py           #  9  two browsers racing for the last prize, stock restored, test mode
python3 t12.py           # 10  campaign locked by deployment, server-held wording, password page
```

Each suite prints `PASS`/`FAIL` per check and a total on the last line, and exits non-zero
on any failure. Reset between suites; they each assume a clean database.

**Total: 107 checks, all passing as of this package.**

## What still cannot be tested here
- Real Supabase Auth: invitation and reset links, and the redirect to `set-password.html`
- Real email delivery through Resend or ZeptoMail
- Vercel environment variables and the `VERCEL_ENV` guard on a live deployment

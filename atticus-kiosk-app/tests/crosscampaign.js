/* Regression: an entry belonging to another campaign must not be removable here.
   The deployment is locked to "preview"; the entry is created directly in "fbf26". */
const { Client } = require("pg");
const B = "http://localhost:8770";
let res = [];
const ck = (n, ok, d = "") => { res.push(ok); console.log((ok ? "PASS " : "FAIL ") + n, d); };
let cookie = "", unlockTok = "";
async function call(op, body = {}, h = {}) {
  const r = await fetch(`${B}/api/app`, { method: "POST",
    headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}),
               ...(unlockTok ? { "x-unlock": unlockTok } : {}), ...h }, body: JSON.stringify({ op, ...body }) });
  const sc = r.headers.get("set-cookie"); if (sc) cookie = sc.split(";")[0];
  const j = await r.json().catch(() => ({})); j.status = r.status; return j;
}
(async () => {
    // same database the server under test is using
  const pg = new Client({ host: process.env.PGHOST || "127.0.0.1", port: Number(process.env.PGPORT || 5432),
    user: process.env.PGUSER || "kiosk", password: process.env.PGPASSWORD || "kiosk",
    database: process.env.PGDATABASE || "kiosk_test" });
  await pg.connect();
  await pg.query(`delete from entry where claim_ref like 'PROD-TEST%'`);   // clean slate

  // a real entry in the live campaign, with a prize unit taken
  const prod = await pg.query(
    `insert into entry (campaign_id, email, name, prize_id, prize_name, claim_ref, claim_by, status)
     values ('fbf26','real.author@example.com','Real Author','v80','$80 Publishing/Marketing Voucher',
             'PROD-TEST-' || floor(random()*100000)::text, now(), 'Won')
     returning id`);
  const prodId = prod.rows[0].id;
  const stock = async () => (await pg.query(
    `select count(*)::int c from entry where campaign_id='fbf26' and prize_id='v80' and deleted_at is null`)).rows[0].c;
  const before = await stock();

  // sign in with the account the setup step created; register one only if it isn't there
  let li = await call("login", { email: "john@atticus.test", password: "secret123" });
  if (!li.ok) {
    await fetch(`${B}/__admin?email=john@atticus.test&password=secret123&name=John`);
    li = await call("login", { email: "john@atticus.test", password: "secret123" });
  }
  ck("Signed in as an admin", li.ok === true, li.error || "");
  const un = await call("unlock", { pin: "2026" });
  unlockTok = un.unlock || un.token || "";
  const mine = await call("state");
  ck("This deployment is the preview one", mine.campaign.id === "preview", mine.campaign.id);

  const r = await call("entryRemove", { id: prodId, reason: "regression test" });
  ck("A production entry can't be removed from preview", r.ok === false && /another campaign/i.test(r.error || ""), r.error);

  const row = (await pg.query(`select deleted_at from entry where id=$1`, [prodId])).rows[0];
  ck("The production entry is untouched", row.deleted_at === null, String(row.deleted_at));
  const after = await stock();
  ck("Production stock is unchanged", after === before, `${before} -> ${after}`);

  // forcing doesn't get round it either
  const f = await call("entryRemove", { id: prodId, reason: "forced", force: true });
  ck("Forcing doesn't get round the campaign check", f.ok === false && /another campaign/i.test(f.error || ""), f.error);

  // and removal inside this campaign still works normally
  const d = await call("draw", { form: { email: "local@example.com", name: "Local", consent: true } });
  const own = await call("entryRemove", { id: d.entry.id, reason: "cleanup" });
  ck("An entry in this campaign still removes and returns its unit",
     own.ok === true && own.stock_returned === 1, (own.error || "returned " + own.stock_returned));

  await pg.query(`delete from entry where claim_ref like 'PROD-TEST%'`);
  await pg.end();
  console.log(`\n${res.filter(Boolean).length}/${res.length} passed`);
  process.exit(res.every(Boolean) ? 0 : 1);
})();

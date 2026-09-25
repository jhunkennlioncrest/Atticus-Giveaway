/* Exercises api/app.js itself — the file Vercel runs — for the deployment-config guards. */
const path = require("path").join(__dirname, "..", "api", "app.js");
let res = [];
const ck = (n, ok, d = "") => { res.push(ok); console.log((ok ? "PASS " : "FAIL ") + n, d); };
async function hit(env) {
  for (const k of Object.keys(require.cache)) delete require.cache[k];
  Object.assign(process.env, { SUPABASE_URL: "https://example.supabase.co", SUPABASE_SERVICE_KEY: "x" }, env);
  const handler = require(path);
  const req = { method: "POST", url: "/api/app", headers: { "content-type": "application/json" },
    on(ev, fn) { if (ev === "data") fn(Buffer.from(JSON.stringify({ op: "state" }))); if (ev === "end") fn(); } };
  let out = "", status = 200;
  const res2 = { statusCode: 200, setHeader() {}, end(b) { out = b || ""; status = this.statusCode; } };
  await handler(req, res2);
  let j = {}; try { j = JSON.parse(out); } catch {}
  return { status, error: j.error || "" };
}
(async () => {
  let r = await hit({ CAMPAIGN_ID: "", ADMIN_SIGNING_SECRET: "s", VERCEL_ENV: "preview" });
  ck("No CAMPAIGN_ID is refused", r.status === 503 && /CAMPAIGN_ID/.test(r.error), r.error);
  r = await hit({ CAMPAIGN_ID: "fbf26", ADMIN_SIGNING_SECRET: "s", VERCEL_ENV: "preview" });
  ck("A preview deployment pointed at the live campaign is refused",
     r.status === 503 && /must be "preview"/.test(r.error), r.error);
  r = await hit({ CAMPAIGN_ID: "preview", ADMIN_SIGNING_SECRET: "", VERCEL_ENV: "preview" });
  ck("A missing signing secret is refused", r.status === 503 && /ADMIN_SIGNING_SECRET/.test(r.error), r.error);
  r = await hit({ CAMPAIGN_ID: "preview", ADMIN_SIGNING_SECRET: "s", VERCEL_ENV: "production" });
  ck("The production deployment is refused the preview campaign",
     r.status === 503 && /must not be "preview"/.test(r.error), r.error);
  r = await hit({ CAMPAIGN_ID: "preview", ADMIN_SIGNING_SECRET: "s", VERCEL_ENV: "preview" });
  ck("A correctly configured preview passes the guards", r.status !== 503 || !/CAMPAIGN_ID|ADMIN_SIGNING/.test(r.error), r.error);
  console.log(`\n${res.filter(Boolean).length}/${res.length} passed`);
  process.exit(res.every(Boolean) ? 0 : 1);
})();

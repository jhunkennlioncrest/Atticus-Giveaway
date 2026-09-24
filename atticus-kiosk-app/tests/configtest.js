/* The deployment must refuse to run when it is configured wrongly, rather than guessing.
   Each case starts its own server on a spare port with only that configuration. */
const { spawn } = require("child_process");
let res = [];
const ck = (n, ok, d = "") => { res.push(ok); console.log((ok ? "PASS " : "FAIL ") + n, d); };
const wait = ms => new Promise(r => setTimeout(r, ms));

async function boot(env, port) {
  const p = spawn("node", ["server.js"], { env: { ...process.env, ...env, PORT: String(port) }, stdio: "ignore" });
  await wait(5000); return p;
}
async function ask(port) {
  try {
    const r = await fetch(`http://localhost:${port}/api/app`, { method: "POST",
      headers: { "content-type": "application/json" }, body: JSON.stringify({ op: "state" }) });
    const j = await r.json().catch(() => ({})); return { status: r.status, error: j.error || "", ok: j.ok, j };
  } catch (e) { return { status: 0, error: String(e.message) }; }
}
(async () => {
  const A = 8800 + Math.floor(Math.random() * 90);
  let p = await boot({ CAMPAIGN_ID: "" }, A);
  let a = await ask(A);
  ck("With no CAMPAIGN_ID the server refuses", a.status === 503 && /CAMPAIGN_ID/.test(a.error), a.error);
  ck("It does not fall back to the live campaign", !/fbf26/.test(JSON.stringify(a.j || {})) || a.status === 503);
  p.kill();

  const B2 = A + 1;
  p = await boot({ CAMPAIGN_ID: "preview" }, B2);
  a = await ask(B2);
  ck("With CAMPAIGN_ID=preview it runs", a.status === 200 && a.j.campaign.id === "preview", a.error);
  p.kill();
  console.log(`\n${res.filter(Boolean).length}/${res.length} passed`);
  process.exit(res.every(Boolean) ? 0 : 1);
})();

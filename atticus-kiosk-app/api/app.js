/* Vercel entry point. Talks to Supabase with the service key, which never leaves the server. */
const { run, unlockTools } = require("./_core.js");
const { renderEmail } = require("./_email.js");

const URL_ = () => process.env.SUPABASE_URL, KEY = () => process.env.SUPABASE_SERVICE_KEY;
async function rest(path, init = {}) {
  const r = await fetch(URL_() + path, { ...init, headers: {
    apikey: KEY(), Authorization: `Bearer ${KEY()}`, "Content-Type": "application/json", ...(init.headers || {}) } });
  const text = await r.text(); let j = null; try { j = text ? JSON.parse(text) : null; } catch { j = text; }
  if (!r.ok) throw new Error((j && (j.message || j.error_description || j.error)) || `Database answered ${r.status}`);
  return j;
}
// every call is a named database function: no SQL string ever leaves this app
const db = { rpc: (fn, args) => rest(`/rest/v1/rpc/${fn}`, { method: "POST", body: JSON.stringify(args || {}) }) };
const auth = {
  async login(email, password) {
    try {
      const j = await rest(`/auth/v1/token?grant_type=password`, { method: "POST", body: JSON.stringify({ email, password }) });
      return { ok: true, token: j.access_token, user: j.user };
    } catch { return { ok: false }; }
  },
  async verify(token) {
    try { return await rest(`/auth/v1/user`, { headers: { Authorization: `Bearer ${token}` } }); }
    catch { return null; }
  },
  async setPassword(token, password) {
    try { await rest(`/auth/v1/user`, { method: "PUT", headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({ password }) }); return { ok: true }; }
    catch (err) { return { ok: false, error: String(err.message || err) }; }
  },
  async reset(email) {
    const to = `${siteUrl()}/set-password.html`;
    try { await rest(`/auth/v1/recover?redirect_to=${encodeURIComponent(to)}`, { method: "POST",
      body: JSON.stringify({ email }) }); } catch {}
    return { ok: true };
  },
  // invites the new admin to set their own password; no password passes through this app
  async invite(email) {
    try {
      const to = `${siteUrl()}/set-password.html`;
      const j = await rest(`/auth/v1/invite?redirect_to=${encodeURIComponent(to)}`, { method: "POST",
        body: JSON.stringify({ email }) });
      return { ok: true, userId: j.id };
    } catch (err) { return { ok: false, error: String(err.message || err) }; }
  }
};
/* Sending runs in this same function rather than calling ourselves over HTTP, so no
   self-address or extra key is needed and it works the same on preview and production. */
async function sendMail(msg) {
  const provider = String(process.env.EMAIL_PROVIDER || "").toLowerCase();
  const from = process.env.FROM_ADDRESS;
  if (!provider || !from) throw new Error("Email sending isn't set up on this deployment yet.");
  if (provider === "resend") {
    const r = await fetch("https://api.resend.com/emails", { method: "POST",
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json",
                 "Idempotency-Key": msg.idempotencyKey },
      body: JSON.stringify({ from, to: [msg.to], subject: msg.subject, html: msg.html, text: msg.text,
                             headers: { "X-Entity-Ref-ID": msg.idempotencyKey } }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.message || j.error?.message || `Resend answered ${r.status}`);
    return j.id || "";
  }
  const host = process.env.ZEPTO_HOST || "api.zeptomail.com";
  let token = String(process.env.ZEPTO_TOKEN || "").trim();
  if (!/^Zoho-enczapikey\s/i.test(token)) token = "Zoho-enczapikey " + token;
  const m = String(from).match(/^\s*(.*?)\s*<([^>]+)>\s*$/);
  const f = m ? { name: m[1].replace(/^"|"$/g, ""), address: m[2] } : { name: "", address: String(from).trim() };
  const r = await fetch(`https://${host}/v1.1/email`, { method: "POST",
    headers: { Authorization: token, "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ from: { address: f.address, name: f.name || undefined },
      to: [{ email_address: { address: msg.to, name: msg.name || undefined } }],
      subject: msg.subject, htmlbody: msg.html, textbody: msg.text, client_reference: msg.idempotencyKey }) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error?.details?.[0]?.message || j.message || `ZeptoMail answered ${r.status}`);
  return j.request_id || "";
}

/* The campaign is fixed by this deployment, never by the request. A preview deployment
   sets CAMPAIGN_ID=preview and physically cannot touch the real campaign, whatever URL
   or body a caller sends. */
/* Where invitation and reset links should land. On Vercel, VERCEL_URL is filled in
   automatically for every deployment, so a preview's links come back to that preview.
   SITE_URL overrides it when the deployment sits behind a custom domain. */
function siteUrl() {
  const u = process.env.SITE_URL || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "");
  return String(u).replace(/\/+$/, "");
}

const CAMPAIGN = () => process.env.CAMPAIGN_ID || "";

/* Returns a reason the deployment is misconfigured, or "" if it is fine.
   There is no default campaign on purpose: an unset CAMPAIGN_ID must never quietly
   become the real Frankfurt campaign. */
function configProblem() {
  const id = CAMPAIGN();
  if (!id) return "CAMPAIGN_ID is not set on this deployment. Set it to \"preview\" for a test deployment or \"fbf26\" for the live one.";
  if (!process.env.ADMIN_SIGNING_SECRET) return "ADMIN_SIGNING_SECRET is not set on this deployment.";
  // a preview build must never be pointed at the live campaign
  const env = String(process.env.VERCEL_ENV || "").toLowerCase();
  if (env && env !== "production" && id !== "preview")
    return `This is a ${env} deployment, so CAMPAIGN_ID must be "preview", not "${id}".`;
  if (env === "production" && id === "preview")
    return "This is the production deployment, so CAMPAIGN_ID must not be \"preview\".";
  return "";
}

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") { res.statusCode = 405; return res.end(JSON.stringify({ ok: false, error: "Method not allowed." })); }
  if (!URL_() || !KEY()) { res.statusCode = 503; return res.end(JSON.stringify({ ok: false, error: "The database isn't connected yet (Vercel settings)." })); }
  let body = {}; try { body = typeof req.body === "object" && req.body ? req.body : JSON.parse(req.body || "{}"); } catch {}
  const problem = configProblem();
  if (problem) {
    res.statusCode = 503;
    return res.end(JSON.stringify({ ok: false, error: problem }));
  }
  if (body.campaign && body.campaign !== CAMPAIGN()) {
    res.statusCode = 400;
    return res.end(JSON.stringify({ ok: false, error: `This deployment only serves the "${CAMPAIGN()}" campaign.` }));
  }
  const ctx = { db, auth, headers: req.headers, campaign: CAMPAIGN(),
                kioskKey: process.env.KIOSK_DEVICE_KEY || "", renderEmail, sendMail,
                unlock: unlockTools(process.env.ADMIN_SIGNING_SECRET) };
  try {
    const data = await run(ctx, String(body.op || ""), body);
    // the session cookie is set and cleared by the server; page scripts can't read it
    if (data.setSession) {
      res.setHeader("Set-Cookie", `atk=${encodeURIComponent(data.setSession)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${(data.sessionHours || 12) * 3600}`);
      delete data.setSession;
    }
    if (data.clearSession) res.setHeader("Set-Cookie", "atk=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0");
    res.statusCode = 200; res.end(JSON.stringify({ ok: true, ...data }));
  } catch (err) {
    res.statusCode = err.code && err.code >= 400 && err.code < 600 ? err.code : 500;
    res.end(JSON.stringify({ ok: false, error: String(err.message || err) }));
  }
};

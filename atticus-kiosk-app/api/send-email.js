/* Atticus kiosk: sends one confirmation email.
   Runs on Vercel as a serverless function. The email provider's key lives only in
   Vercel's environment variables; the tablet sends a separate kiosk key.

   Environment variables (Vercel → Project → Settings → Environment Variables):
     EMAIL_PROVIDER   "resend" or "zeptomail"
     FROM_ADDRESS     e.g. Atticus Publishing <no-reply@atticuspublishing.com>
     KIOSK_SEND_KEY   long random text; staff paste the same value into the tablet
     RESEND_API_KEY   when EMAIL_PROVIDER=resend
     ZEPTO_TOKEN      when EMAIL_PROVIDER=zeptomail ("Zoho-enczapikey ..." from ZeptoMail)
     ZEPTO_HOST       optional; api.zeptomail.com (default), api.zeptomail.eu, api.zeptomail.in
*/
const crypto = require("crypto");

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const MARKER_RE = /\[(To confirm|currency to confirm)/i;
const MAX_HTML = 300000, MAX_TEXT = 60000;
const hits = new Map();                       // light per-instance rate limit

function reply(res, code, body) {
  res.statusCode = code;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(body));
}
function sameKey(a, b) {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}
function parseFrom(from) {
  const m = String(from).match(/^\s*(.*?)\s*<([^>]+)>\s*$/);
  return m ? { name: m[1].replace(/^"|"$/g, ""), address: m[2] } : { name: "", address: String(from).trim() };
}
async function readBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string") return JSON.parse(req.body || "{}");
  const chunks = []; for await (const c of req) chunks.push(c);
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

async function sendResend(msg, from) {
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json", "Idempotency-Key": msg.idempotencyKey },
    body: JSON.stringify({ from, to: [msg.to], subject: msg.subject, html: msg.html, text: msg.text,
      headers: { "X-Entity-Ref-ID": msg.idempotencyKey } })
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.message || j.error?.message || `Resend answered ${r.status}`);
  return j.id || "";
}
async function sendZepto(msg, from) {
  const host = process.env.ZEPTO_HOST || "api.zeptomail.com";
  let token = String(process.env.ZEPTO_TOKEN || "").trim();
  if (!/^Zoho-enczapikey\s/i.test(token)) token = "Zoho-enczapikey " + token;
  const f = parseFrom(from);
  const r = await fetch(`https://${host}/v1.1/email`, {
    method: "POST",
    headers: { Authorization: token, "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ from: { address: f.address, name: f.name || undefined },
      to: [{ email_address: { address: msg.to, name: msg.name || undefined } }],
      subject: msg.subject, htmlbody: msg.html, textbody: msg.text, client_reference: msg.idempotencyKey })
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error?.details?.[0]?.message || j.error?.message || j.message || `ZeptoMail answered ${r.status}`);
  return j.request_id || "";
}

module.exports = async function handler(req, res) {
  const key = process.env.KIOSK_SEND_KEY, from = process.env.FROM_ADDRESS;
  const provider = String(process.env.EMAIL_PROVIDER || "").toLowerCase();
  const providerKey = provider === "resend" ? process.env.RESEND_API_KEY : provider === "zeptomail" ? process.env.ZEPTO_TOKEN : "";
  if (!key || !from || !providerKey)
    return reply(res, 503, { ok: false, error: "Email sending isn't set up on the server yet (Vercel environment variables are missing)." });
  if (!sameKey(req.headers["x-kiosk-key"] || "", key))
    return reply(res, 401, { ok: false, error: "The sending key on this tablet doesn't match. Check Settings → Email sending." });

  if (req.method === "GET") {           // connection check; sends nothing
    const f = parseFrom(from);
    return reply(res, 200, { ok: true, provider: provider === "resend" ? "Resend" : "ZeptoMail", from: f.address });
  }
  if (req.method !== "POST") return reply(res, 405, { ok: false, error: "Method not allowed." });

  const now = Date.now(), recent = (hits.get("all") || []).filter(t => now - t < 60000);
  if (recent.length >= 30) return reply(res, 429, { ok: false, error: "Too many emails in one minute. Wait a moment and try again." });
  hits.set("all", [...recent, now]);

  let msg;
  try { msg = await readBody(req); } catch { return reply(res, 400, { ok: false, error: "The request couldn't be read." }); }
  const bad =
    !EMAIL_RE.test(String(msg.to || "")) ? "The author's email address isn't valid." :
    !msg.subject || /[\r\n]/.test(msg.subject) || msg.subject.length > 200 ? "The subject is empty or too long." :
    typeof msg.html !== "string" || !msg.html || msg.html.length > MAX_HTML ? "The email body is empty or too large." :
    typeof msg.text !== "string" || msg.text.length > MAX_TEXT ? "The plain-text version is too large." :
    !/^[A-Za-z0-9-]{4,80}$/.test(String(msg.idempotencyKey || "")) ? "Missing send reference." :
    MARKER_RE.test(msg.subject + msg.html + msg.text) ? "The email still has [To confirm] notes in it." : "";
  if (bad) return reply(res, 422, { ok: false, error: bad });

  try {
    const id = provider === "resend" ? await sendResend(msg, from) : await sendZepto(msg, from);
    return reply(res, 200, { ok: true, id });
  } catch (err) {
    return reply(res, 502, { ok: false, error: "The email provider refused the email: " + String(err.message || err).slice(0, 240) });
  }
};

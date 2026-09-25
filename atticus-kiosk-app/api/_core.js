/* Atticus kiosk: all server-side behaviour in one place.

   Three separate secrets, deliberately not shared:
     ADMIN_SIGNING_SECRET  signs admin unlock codes. Server only. Never sent to a tablet.
     EMAIL_SEND_KEY        lets this server call its own email function. Server only.
     KIOSK_DEVICE_KEY      optional. A value staff type into a tablet once, so a stranger
                           with the address can't create entries. It is not a signing key
                           and is never used to authorise anything in the admin area.

   The handler (api/app.js on Vercel) and the local test harness both call run().
   `db` runs SQL functions and queries; `auth` handles staff logins. Both are passed
   in, so the same code is exercised by the tests and in production. */

const crypto = require("crypto");
/* Unlock tokens are signed here and kept only in the tablet's memory, so closing the
   admin view or handing the tablet over drops it and the PIN is asked for again. */
function unlockTools(secret, minutes = 60) {
  const sign = data => crypto.createHmac("sha256", secret || "dev-secret").update(data).digest("hex").slice(0, 32);
  return {
    issue(userId) {
      const exp = Date.now() + minutes * 60000, jti = crypto.randomUUID().replace(/-/g, "").slice(0, 16);
      return `${userId}.${jti}.${exp}.${sign(userId + "." + jti + "." + exp)}`;
    },
    parse(token) { const [id, jti, exp, sig] = String(token || "").split("."); return { id, jti, exp, sig }; },
    // shape, signature and expiry only; whether it has been locked is a database question
    valid(token, userId) {
      const { id, jti, exp, sig } = this.parse(token);
      if (!id || !jti || !exp || !sig) return false;
      if (id !== String(userId)) return false;
      if (Number(exp) < Date.now()) return false;
      const want = sign(id + "." + jti + "." + exp);
      return sig.length === want.length && crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(want));
    }
  };
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const MARKER_RE = /\[(To confirm|currency to confirm)/i;

function bad(msg, code = 400) { const e = new Error(msg); e.code = code; return e; }

/* Access has two layers, on purpose.
   1. SIGN IN (email + password) authorises the tablet and lasts a working session.
      The session token is sent as a cookie the browser script can't read.
   2. UNLOCK (the PIN) re-opens the admin view on a tablet that is already signed in,
      so nobody has to type a password between authors.
   The PIN alone authorises nothing: every request below checks the signed-in session
   too, so a tablet that has been logged out is useless even if someone knows the PIN. */
function cookie(ctx, name) {
  const raw = ctx.headers.cookie || "";
  const hit = raw.split(";").map(s => s.trim()).find(s => s.startsWith(name + "="));
  return hit ? decodeURIComponent(hit.slice(name.length + 1)) : "";
}
async function requireAdmin(ctx) {
  const token = cookie(ctx, "atk") || (ctx.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!token) throw bad("Sign in to open the admin area.", 401);
  const who = await ctx.auth.verify(token);
  if (!who) throw bad("That sign-in has expired. Sign in again.", 401);
  const admin = await ctx.db.rpc("app_admin_by_user", { p_user: who.id });
  if (!admin) throw bad("This account isn't set up for the giveaway. Ask an existing admin to add it.", 403);
  return admin;
}
// admin data needs the signed-in session AND a current unlock
async function requireUnlocked(ctx) {
  const admin = await requireAdmin(ctx);
  const token = String(ctx.headers["x-unlock"] || "");
  if (!ctx.unlock.valid(token, admin.user_id)) throw bad("Enter the PIN to open the admin view.", 423);
  // locked on this tablet? other tablets are unaffected
  if (await ctx.db.rpc("app_unlock_is_revoked", { p_jti: ctx.unlock.parse(token).jti }))
    throw bad("This tablet was locked. Enter the PIN to open the admin view.", 423);
  return admin;
}
/* The wheel is public: authors scan a QR code and open it on their own phones, so
   there is no shared secret to check. Abuse is limited instead:
     - a cap per caller per 10 minutes, counted in the database
     - one entry per author per campaign, enforced by a unique index
     - the draw itself is server-side, so nothing about the prize can be forged. */
function callerBucket(ctx) {
  const ip = String(ctx.headers["x-forwarded-for"] || ctx.headers["x-real-ip"] || "local").split(",")[0].trim();
  return crypto.createHash("sha256").update("fbf26|" + ip).digest("hex").slice(0, 32);   // stored hashed, not as an address
}
async function limitPublic(ctx, kind, limit, minutes) {
  const ok = await ctx.db.rpc("app_rate_ok", { p_bucket: callerBucket(ctx), p_kind: kind, p_limit: limit, p_minutes: minutes });
  if (!ok) throw bad("Too many tries from this connection. Wait a few minutes and try again.", 429);
}

const OPS = {
  /* ---------------- participant ---------------- */
  async state(ctx) {
    const [prizes, campaign, shared] = await Promise.all([
      ctx.db.rpc("wheel_state", { p_campaign: ctx.campaign }),
      ctx.db.rpc("app_campaign", { p_campaign: ctx.campaign }),
      ctx.db.rpc("app_settings_get", { p_key: settingsKey(ctx, "email_shared") })]);
    return { campaign, prizes, shared: shared || {} };
  },

  // one transaction in the database: checks the author, picks by weight, takes the stock
  async draw(ctx, body) {
    await limitPublic(ctx, "draw", 12, 10);
    const f = body.form || {};
    if (!EMAIL_RE.test(String(f.email || ""))) throw bad("That email address doesn't look right.");
    if (!String(f.name || "").trim()) throw bad("A name is needed.");
    const r = await ctx.db.rpc("draw_prize", {
      p_campaign: ctx.campaign, p_email: f.email, p_name: f.name, p_phone: f.phone || "",
      p_book: f.book || "", p_tablet: body.tablet || "", p_is_test: !!body.test
    });
    if (r.state === "error") throw bad(r.error);
    return r;
  },

  /* Done: the author has seen their prize. Send now if the prize's email wording is
     complete, otherwise leave it queued for staff. Never sends twice. */
  async done(ctx, body) {
    await limitPublic(ctx, "done", 30, 10);
    const id = String(body.entryId || "");
    const entry = await ctx.db.rpc("app_entry", { p_campaign: ctx.campaign, p_id: id });
    if (!entry) throw bad("That entry no longer exists.", 404);
    if (entry.is_test) return { status: "test", note: "Test entry: no email is sent." };
    if (entry.mail_status === "sent") return { status: "sent", already: true };

    const built = await buildEmail(ctx, entry);
    if (built.missing.length) {
      await ctx.db.rpc("app_email_queued", { p_entry: id });
      return { status: "queued", missing: built.missing,
               note: "Saved. Staff will check the wording before this email goes out." };
    }
    return await sendFor(ctx, entry, built, { by: "kiosk (Done)" });
  },

  /* ---------------- staff ---------------- */
  async login(ctx, body) {
    const r = await ctx.auth.login(String(body.email || ""), String(body.password || ""));
    if (!r.ok) throw bad("That email address or password isn't right.", 401);
    const admin = await ctx.db.rpc("app_admin_by_user", { p_user: r.user.id });
    if (!admin) throw bad("This account isn't set up for the giveaway. Ask an existing admin to add it.", 403);
    await ctx.db.rpc("app_admin_seen", { p_user: r.user.id });
    const c = await ctx.db.rpc("app_campaign", { p_campaign: ctx.campaign });
    return { setSession: r.token, sessionHours: c.session_hours, unlock: ctx.unlock.issue(r.user.id),
             lockAfterMinutes: c.lock_after_minutes, admin: { name: admin.name, email: admin.email } };
  },
  // is this tablet still signed in? used on start-up to decide between "sign in" and "PIN"
  // finishes an invitation or reset: the link's token is exchanged for a new password
  async setPassword(ctx, body) {
    const pw = String(body.password || "");
    if (pw.length < 10) throw bad("Use at least 10 characters.");
    const r = await ctx.auth.setPassword(String(body.token || ""), pw);
    if (!r.ok) throw bad("That link has expired. Ask for a new one.");
    return { ok: true };
  },
  async resetPassword(ctx, body) {
    const email = String(body.email || "");
    if (!EMAIL_RE.test(email)) throw bad("That email address doesn't look right.");
    await ctx.auth.reset(email);          // always succeeds outwardly: never reveals who has an account
    return { ok: true };
  },
  async me(ctx) {
    const s = await requireAdmin(ctx);
    return { admin: { name: s.name, email: s.email }, signedIn: true };
  },
  // the PIN re-opens the view on a tablet that is already signed in
  async unlock(ctx, body) {
    const admin = await requireAdmin(ctx);
    const r = await ctx.db.rpc("app_unlock", { p_campaign: ctx.campaign, p_pin: String(body.pin || ""), p_user: admin.user_id });
    if (!r.ok) throw bad(r.error || "Wrong PIN.", r.blocked ? 429 : 401);
    const c = await ctx.db.rpc("app_campaign", { p_campaign: ctx.campaign });
    return { unlock: ctx.unlock.issue(admin.user_id), lockAfterMinutes: c.lock_after_minutes,
             admin: { name: admin.name, email: admin.email } };
  },
  /* Hand to author: this tablet's unlock code dies on the server straight away.
     Another admin working on another tablet is not interrupted. */
  async lock(ctx) {
    const admin = await requireAdmin(ctx);
    const jti = ctx.unlock.parse(String(ctx.headers["x-unlock"] || "")).jti;
    if (!jti) return { ok: true, locked: true, note: "Nothing to lock: this tablet wasn't unlocked." };
    await ctx.db.rpc("app_unlock_revoke", { p_jti: jti, p_user: admin.user_id });
    return { ok: true, locked: true };
  },
  async setPin(ctx, body) {
    const admin = await requireUnlocked(ctx);
    const r = await ctx.db.rpc("app_set_pin", { p_campaign: ctx.campaign, p_pin: String(body.pin || ""),
      p_by: admin.name || admin.email });
    if (!r.ok) throw bad(r.error);
    return r;
  },
  // ends the session on this tablet: back to the public wheel, nothing admin visible
  async logout(ctx) { return { ok: true, clearSession: true }; },
  async pin(ctx, body) {
    const ok = await ctx.db.rpc("check_pin", { p_campaign: ctx.campaign, p_pin: String(body.pin || "") });
    if (!ok) throw bad("Wrong PIN.", 401);
    return { ok: true };
  },
  async entries(ctx, body) {
    const admin = await requireUnlocked(ctx);
    const entries = await ctx.db.rpc("app_entries", { p_campaign: ctx.campaign,
      p_include_removed: !!body.includeRemoved, p_include_tests: body.includeTests !== false });
    return { entries, admin: { name: admin.name, email: admin.email } };
  },
  async entryUpdate(ctx, body) {
    const admin = await requireUnlocked(ctx);
    const r = await ctx.db.rpc("app_entry_update", { p_campaign: ctx.campaign, p_id: String(body.id),
      p_patch: body.patch || {}, p_by: admin.name || admin.email });
    if (!r.ok) throw bad(r.error || "That didn't work.", 404);
    return r;
  },
  // removes the entry and hands back exactly the stock it used, once
  async entryRemove(ctx, body) {
    const admin = await requireUnlocked(ctx);
    const r = await ctx.db.rpc("remove_entry", {
      p_campaign: ctx.campaign,                       // an entry from another campaign is refused
      p_entry_id: String(body.id), p_actor: admin.name || admin.email,
      p_reason: String(body.reason || ""), p_force: !!body.force });
    if (!r.ok && !r.needs_review) throw bad(r.error || "That didn't work.");
    return r;
  },
  async emailPreview(ctx, body) {
    await requireUnlocked(ctx);
    const entry = await ctx.db.rpc("app_entry", { p_campaign: ctx.campaign, p_id: String(body.id) });
    if (!entry) throw bad("That entry no longer exists.", 404);
    return await buildEmail(ctx, entry, true);
  },
  async emailSend(ctx, body) {
    const admin = await requireUnlocked(ctx);
    const entry = await ctx.db.rpc("app_entry", { p_campaign: ctx.campaign, p_id: String(body.id) });
    if (!entry) throw bad("That entry no longer exists.", 404);
    if (entry.mail_status === "sent" && !body.again) return { status: "sent", already: true };
    const draft = body.draft && body.draft.html ? body.draft : await buildEmail(ctx, entry);
    if (!body.draft && draft.missing && draft.missing.length)
      throw bad("This prize's email wording isn't complete yet: " + draft.missing.join(", "));
    if (MARKER_RE.test(draft.subject + draft.html + (draft.text || "")))
      throw bad("The email still has [To confirm] notes in it.");
    return await sendFor(ctx, entry, draft, { by: admin.name || admin.email, again: !!body.again });
  },
  /* ---------------- prize control (PIN) ---------------- */
  async prizeSave(ctx, body) {
    const admin = await requireUnlocked(ctx);
    const r = await ctx.db.rpc("app_prize_save", { p_campaign: ctx.campaign, p_prize: body.prize || {},
      p_by: admin.name || admin.email });
    if (!r.ok) throw bad(r.error || "Unknown prize.", 404);
    return r;
  },
  async emailTemplate(ctx, body) {
    const admin = await requireUnlocked(ctx);
    if (body.prize) await ctx.db.rpc("app_prize_save", { p_campaign: ctx.campaign,
      p_prize: { id: body.prize.id, emailFields: body.prize.emailFields || {} }, p_by: admin.name || admin.email });
    if (body.shared) await ctx.db.rpc("app_settings_save", { p_key: settingsKey(ctx, "email_shared"), p_value: body.shared,
      p_by: admin.name || admin.email });
    const prizes = await ctx.db.rpc("wheel_state", { p_campaign: ctx.campaign });
    const shared = await ctx.db.rpc("app_settings_get", { p_key: settingsKey(ctx, "email_shared") });
    return { prizes, shared };
  },
  /* Every setting belongs to one campaign. Without this a preview edit would land on the
     same row the live campaign reads. Keys already carrying a campaign are left alone. */
  async settingsGet(ctx, body) {
    await requireAdmin(ctx);
    return { value: await ctx.db.rpc("app_settings_get", { p_key: settingsKey(ctx, body.key) }) };
  },
  async settingsSave(ctx, body) {
    const admin = await requireUnlocked(ctx);
    return { value: await ctx.db.rpc("app_settings_save", { p_key: settingsKey(ctx, body.key),
      p_value: body.value || {}, p_by: admin.name || admin.email }) };
  },
  async adminAdd(ctx, body) {
    const admin = await requireUnlocked(ctx);
    const invited = await ctx.auth.invite(String(body.email || ""));
    if (!invited.ok) throw bad(invited.error || "That invitation didn't send.");
    const added = await ctx.db.rpc("app_admin_add", { p_user: invited.userId, p_email: body.email,
      p_name: String(body.name || ""), p_by: admin.name || admin.email });
    return { admin: added };
  }

};

/* ---------------- email building and sending ---------------- */
async function buildEmail(ctx, entry, preview = false) {
  const prizes = await ctx.db.rpc("wheel_state", { p_campaign: entry.campaign_id });
  const p = prizes.find(x => x.id === entry.prize_id) || {};
  const prize = { id: p.id, name: p.name, email_fields: p.emailFields || {} };
  const shared = await ctx.db.rpc("app_settings_get", { p_key: settingsKey(ctx, "email_shared") });
  return ctx.renderEmail(entry, prize, shared || {}, preview);
}
async function sendFor(ctx, entry, msg, opts) {
  const n = (entry.mail_send_count || 0) + 1;
  try {
    const id = await ctx.sendMail({ to: entry.email, name: entry.name, subject: msg.subject,
      html: msg.html, text: msg.text, idempotencyKey: `${entry.claim_ref}-${n}` });
    await ctx.db.rpc("app_email_sent", { p_entry: entry.id, p_by: opts.by || "",
      p_subject: msg.subject, p_html: msg.html, p_provider: String(id || "") });
    return { status: "sent", to: entry.email };
  } catch (err) {
    await ctx.db.rpc("app_email_failed", { p_entry: entry.id, p_by: opts.by || "",
      p_error: String(err.message || err).slice(0, 200) });
    return { status: "failed", error: String(err.message || err) };
  }
}

function settingsKey(ctx, key) {
  const k = String(key || "");
  return k.includes(":") ? k : `${k}:${ctx.campaign}`;
}

async function run(ctx, op, body) {
  // the campaign comes from this deployment's settings; a request can never change it
  if (body && body.campaign && body.campaign !== ctx.campaign)
    throw bad(`This deployment only serves the "${ctx.campaign}" campaign.`, 400);
  const fn = OPS[op];
  if (!fn) throw bad("Unknown request.", 404);
  return await fn(ctx, body || {});
}

module.exports = { run, OPS, EMAIL_RE, MARKER_RE, unlockTools };

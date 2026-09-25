/* The winner email. This is the only place the wording lives: the kiosk asks the
   server to render previews too, so what staff review is what actually sends. */

const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const filled = v => typeof v === "string" && v.trim() !== "" && !/^\[.*\]$/.test(v.trim());

const TYPES = { v2500: "voucher", v800: "voucher", v250: "voucher", v100: "voucher", v80: "voucher", bs1: "bookstore", bs2: "bookstore" };
const typeOf = id => TYPES[id] || "service";

const FIELDS = {
  voucher: [["currency", "Currency code", true], ["services", "Services the voucher can be used for", true],
            ["minSpend", "Minimum spend or purchase needed", true], ["exclusions", "Exclusions", false],
            ["expiry", "Voucher expiry date", true], ["partial", "Can the balance be used across several purchases?", true],
            ["redeem", "How to redeem", true]],
  bookstore: [["description", "What the display includes", true], ["location", "Participating bookstore(s) and location", true],
              ["placement", "Placement type", true], ["duration", "How long the display runs", true],
              ["eligibility", "Book eligibility review", false], ["format", "Format requirements", false],
              ["copies", "Copies the author supplies", true], ["shipping", "Shipping costs and who pays", true],
              ["timeline", "Fulfilment timeline", true], ["conditions", "Other conditions", false]],
  service: [["description", "What's included", true], ["submit", "What the author must submit", true],
            ["claim", "How to claim", true], ["timeline", "Fulfilment timeline", true], ["conditions", "Limitations and conditions", true]]
};
const SHARED = [["teamName", "Sign-off", true], ["supportEmail", "Support email", true],
                ["website", "Website", true], ["privacyUrl", "Privacy policy link", true],
                ["claimUrl", "Claim link", false], ["calendlyUrl", "Calendly booking link", false], ["apptDates", "Appointment dates", false]];

function missingFor(prize, shared) {
  const f = prize.email_fields || {}, out = [];
  for (const [k, label, req] of SHARED) if (req && !filled(shared[k])) out.push(label);
  for (const [k, label, req] of FIELDS[typeOf(prize.id)]) if (req && !filled(f[k])) out.push(label);
  return out;
}
function deadline(iso) {
  const d = new Date(iso);
  const day = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Berlin", weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(d);
  const tz = (new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Berlin", timeZoneName: "short" }).formatToParts(d)
    .find(x => x.type === "timeZoneName") || {}).value || "CET";
  return `${day}, 11:59 PM Frankfurt time (${tz})`;
}

function renderEmail(entry, prize, shared = {}, preview = false) {
  const f = prize.email_fields || {}, type = typeOf(prize.id);
  const labelOf = k => (FIELDS[type].find(x => x[0] === k) || SHARED.find(x => x[0] === k) || [k, k])[1];
  const v = (k, src = f) => filled(src[k]) ? { h: esc(src[k].trim()), t: src[k].trim() }
    : (preview ? { h: `<span style="background:#FFE3D6;color:#9A3412;border-radius:4px;padding:0 4px">[To confirm: ${esc(labelOf(k))}]</span>`,
                   t: `[To confirm: ${labelOf(k)}]` } : null);
  const first = String(entry.name || "").trim().split(/\s+/)[0] || "there";
  const book = String(entry.book_title || "").trim();
  const name = (type === "voucher" && !filled(f.currency))
    ? prize.name.replace(/^\$/, preview ? "[currency to confirm] " : "") : prize.name;
  const H = [], T = [];
  const para = (h, t) => { H.push(`<p style="margin:0 0 14px">${h}</p>`); T.push(t); };
  const head = x => { H.push(`<h2 style="font:600 18px/1.3 Arial,Helvetica,sans-serif;color:#FE5D29;margin:26px 0 10px;text-transform:uppercase;letter-spacing:.04em">${x}</h2>`); T.push(x.toUpperCase()); };
  const list = items => { const it = items.filter(Boolean); if (!it.length) return;
    H.push(`<table role="presentation" style="width:100%;border-collapse:collapse;margin:0 0 14px">${it.map(([k, x]) =>
      `<tr><td style="padding:6px 10px 6px 0;color:#6B6B6B;vertical-align:top;width:40%">${esc(k)}</td><td style="padding:6px 0;vertical-align:top">${x.h}</td></tr>`).join("")}</table>`);
    T.push(it.map(([k, x]) => `- ${k}: ${x.t}`).join("\n")); };
  const row = (k, x) => x ? [k, x] : null;
  const sup = v("supportEmail", shared);

  para(`Hi ${esc(first)},`, `Hi ${first},`);
  para(`Congratulations! You've won <strong>${esc(name)}</strong> in our Frankfurt Book Exhibit Spin-the-Wheel giveaway.`,
       `Congratulations! You've won ${name} in our Frankfurt Book Exhibit Spin-the-Wheel giveaway.`);
  para(book ? `Thank you for joining us and sharing <em>${esc(book)}</em>. We're excited to help you take the next step in your publishing journey.`
            : `Thank you for joining us. We're excited to help you take the next step in your publishing journey.`,
       book ? `Thank you for joining us and sharing "${book}". We're excited to help you take the next step in your publishing journey.`
            : `Thank you for joining us. We're excited to help you take the next step in your publishing journey.`);

  head("Your prize");
  if (type === "voucher") {
    const svc = v("services"), amt = (name.match(/\$[\d,]+/) || [name])[0];
    para(`A credit of <strong>${esc(amt)}</strong> toward ${svc ? svc.h : ""}. This is a voucher for Atticus services. It is not cash and can't be exchanged for cash.`,
         `A credit of ${amt} toward ${svc ? svc.t : ""}. This is a voucher for Atticus services. It is not cash and can't be exchanged for cash.`);
    list([row("Minimum spend", v("minSpend")), row("Exclusions", filled(f.exclusions) ? v("exclusions") : null),
          row("Expires", v("expiry")), row("Using the balance", v("partial"))]);
  } else if (type === "bookstore") {
    const d = v("description"); if (d) para(d.h, d.t);
    list([row("Where", v("location")), row("Placement", v("placement")), row("How long", v("duration")),
          row("Eligibility", filled(f.eligibility) ? v("eligibility") : null), row("Format", filled(f.format) ? v("format") : null)]);
    para("A display helps readers discover your book. It doesn't guarantee sales or ongoing stocking.",
         "A display helps readers discover your book. It doesn't guarantee sales or ongoing stocking.");
  } else { const d = v("description"); if (d) para(d.h, d.t); }

  H.push(`<p style="margin:0 0 14px;font-size:15px">Claim reference: <strong style="font-size:18px;letter-spacing:.08em">${esc(entry.claim_ref)}</strong></p>`);
  T.push(`Claim reference: ${entry.claim_ref}`);

  head("How to claim");
  const how = type === "voucher" ? v("redeem") : type === "service" ? v("claim")
    : { h: `Email us at ${sup ? sup.h : ""} with your claim reference and we'll confirm the next steps for your display.`,
        t: `Email us at ${sup ? sup.t : ""} with your claim reference and we'll confirm the next steps for your display.` };
  if (how) para(how.h, how.t);
  const href = filled(shared.claimUrl) ? shared.claimUrl.trim()
    : filled(shared.supportEmail) ? `mailto:${shared.supportEmail.trim()}?subject=${encodeURIComponent("Prize claim " + entry.claim_ref)}` : "";
  if (href) {
    H.push(`<p style="margin:6px 0 18px"><a href="${esc(href)}" style="display:inline-block;background:#FE5D29;color:#140702;text-decoration:none;font:700 15px Arial,Helvetica,sans-serif;padding:13px 26px;border-radius:999px">Claim your prize</a></p>`);
    T.push(`Claim your prize: ${href.replace(/\?subject=.*/, "")} (quote ${entry.claim_ref})`);
  } else if (preview && sup) { H.push(`<p>${sup.h}</p>`); T.push(sup.t); }
  para(`Please claim your prize by <strong>${esc(deadline(entry.claim_by))}</strong>.`, `Please claim your prize by ${deadline(entry.claim_by)}.`);

  const after = type === "bookstore" ? [row("Copies to send", v("copies")), row("Shipping", v("shipping")), row("Timeline", v("timeline"))]
              : type === "service" ? [row("What to send us", v("submit")), row("Timeline", v("timeline"))] : [];
  if (after.filter(Boolean).length) { para("<strong>After you claim</strong>", "After you claim:"); list(after); }

  const cond = [];
  if (type === "voucher") { const m = v("minSpend"); if (m && !/^none$/i.test(f.minSpend || "")) cond.push({ h: `<strong>Using this voucher requires a purchase: ${m.h}</strong>`, t: `USING THIS VOUCHER REQUIRES A PURCHASE: ${m.t}` }); }
  if (type === "bookstore") { const sh = v("shipping"); if (sh) cond.push({ h: `<strong>Shipping: ${sh.h}</strong>`, t: `SHIPPING: ${sh.t}` }); if (filled(f.conditions)) cond.push(v("conditions")); }
  if (type === "service") { const c = v("conditions"); if (c) cond.push(c); }
  cond.push({ h: "Prizes can't be transferred or exchanged for cash.", t: "Prizes can't be transferred or exchanged for cash." });
  H.push(`<p style="margin:14px 0;font-size:14px;color:#3A3A3A"><strong>Prize conditions:</strong> ${cond.map(c => c.h).join(" ")}</p>`);
  T.push(`Prize conditions: ${cond.map(c => c.t).join(" ")}`);

  if (filled(shared.calendlyUrl) && filled(shared.apptDates)) {
    head("Let's talk about your book");
    para(`If you'd like to discuss your publishing goals, you can book an optional post-event appointment. It's separate from claiming your prize. Appointments start at <strong>5 PM UK time</strong> on ${esc(shared.apptDates)}.`,
         `If you'd like to discuss your publishing goals, you can book an optional post-event appointment. It's separate from claiming your prize. Appointments start at 5 PM UK time on ${shared.apptDates}.`);
    H.push(`<p style="margin:0 0 18px"><a href="${esc(shared.calendlyUrl)}" style="color:#FE5D29;font-weight:700">Book an appointment</a></p>`);
    T.push(`Book an appointment: ${shared.calendlyUrl}`);
  }
  if (sup) para(`Have a question? Email us at ${sup.h} and we'll be happy to help.`, `Have a question? Email us at ${sup.t} and we'll be happy to help.`);

  const team = v("teamName", shared), web = v("website", shared), priv = v("privacyUrl", shared);
  H.push(`<p style="margin:0 0 4px">Best,<br>${team ? team.h : ""}</p><p style="margin:0 0 20px;color:#6B6B6B;font-size:14px">${sup ? sup.h : ""}${sup && web ? " · " : ""}${web ? web.h : ""}</p>`);
  T.push(`Best,\n${team ? team.t : ""}\n${[sup && sup.t, web && web.t].filter(Boolean).join(" · ")}`);

  const noReplyH = `<strong>Please do not reply to this email.</strong> This address isn't monitored. To claim your prize or ask a question, email ${sup ? sup.h : ""}.`;
  const noReplyT = `PLEASE DO NOT REPLY TO THIS EMAIL. This address isn't monitored. To claim your prize or ask a question, email ${sup ? sup.t : ""}.`;
  const footH = `You're receiving this email because you took part in our Frankfurt Book Exhibit giveaway.${filled(shared.privacyUrl) ? ` <a href="${esc(shared.privacyUrl)}" style="color:#6B6B6B">Privacy policy</a>` : priv ? " " + priv.h : ""}`;
  const footT = `You're receiving this email because you took part in our Frankfurt Book Exhibit giveaway.${priv ? " Privacy policy: " + priv.t : ""}`;
  const subject = `You won ${name} at the Frankfurt Book Exhibit!`;

  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(subject)}</title></head>
<body style="margin:0;background:#F2F2F2"><table role="presentation" width="100%" style="background:#F2F2F2;padding:20px 10px"><tr><td align="center">
<table role="presentation" width="100%" style="max-width:600px;background:#FFFFFF;border-radius:14px;overflow:hidden">
<tr><td style="background:#000;padding:22px 28px"><span style="font:700 22px Arial,Helvetica,sans-serif;letter-spacing:.14em;color:#FE5D29">ATTICUS</span><br><span style="font:700 13px Arial,Helvetica,sans-serif;letter-spacing:.28em;color:#FFFFFF">PUBLISHING</span></td></tr>
<tr><td id="content" style="padding:26px 28px 8px;font:16px/1.55 Arial,Helvetica,sans-serif;color:#1B1B1B">${H.join("\n")}</td></tr>
<tr><td id="noreply" style="padding:0 28px 18px"><div style="border:1px solid #F3C4B2;background:#FFF4EF;border-radius:10px;padding:12px 14px;font:14px/1.5 Arial,Helvetica,sans-serif;color:#7A2E12">${noReplyH}</div></td></tr>
<tr><td style="padding:14px 28px 24px;font:12px/1.5 Arial,Helvetica,sans-serif;color:#6B6B6B;border-top:1px solid #EEE">${footH}</td></tr>
</table></td></tr></table></body></html>`;
  const text = [`Subject: ${subject}`, ...T, noReplyT, footT].join("\n\n").replace(/\n{3,}/g, "\n\n");
  return { subject, html, text, missing: missingFor(prize, shared) };
}

module.exports = { renderEmail, missingFor, FIELDS, SHARED, typeOf };

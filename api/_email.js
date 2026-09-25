/* The winner email. This is the only place the wording lives: the kiosk asks the
   server to render previews too, so what staff review is what actually sends. */

const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const filled = v => typeof v === "string" && v.trim() !== "" && !/^\[.*\]$/.test(v.trim());

const TYPES = { v2500: "voucher", v800: "voucher", v250: "voucher", v100: "voucher", v80: "voucher", bs1: "bookstore", bs2: "bookstore" };
const typeOf = id => TYPES[id] || "service";

const LETTER = [["subject", "Subject line", true], ["body", "Email letter", true]];
const FIELDS = { voucher: LETTER, bookstore: LETTER, service: LETTER };
const SHARED = [["teamName", "Sign-off", true], ["phones", "Phone numbers", false],
                ["website", "Website", true], ["facebookUrl", "Facebook page", false],
                ["referralUrl", "Referral programme link", false], ["privacyUrl", "Privacy policy link", true],
                ["supportEmail", "Support email", false], ["logoUrl", "Signature image URL", false]];

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
  const ref = String(entry.claim_ref || "");
  const inline = (t, html) => {
    let x = html ? esc(t) : t;
    x = x.split("[First Name]").join(html ? esc(first) : first);
    x = x.split("[Book Title]").join(book ? (html ? `<em>${esc(book)}</em>` : `"${book}"`) : (html ? "your book" : "your book"));
    x = x.split("[Claim Reference]").join(html ? `<strong style="letter-spacing:.08em">${esc(ref)}</strong>` : ref);
    return x;
  };
  const leadIn = (t, html) => {           // bold a short "Label:" opener, as the letters do
    const m = t.match(/^([A-Z][^:\n]{0,34}):\s(.*)$/s);
    if (!m) return inline(t, html);
    return html ? `<strong>${esc(m[1])}:</strong> ${inline(m[2], true)}` : inline(t, false);
  };

  const raw = filled(f.body) ? f.body.trim()
    : (preview ? "[To confirm: Email letter]" : null);
  if (raw) for (const blk of raw.split(/\n\s*\n/).map(x => x.trim()).filter(Boolean)) {
    const lines = blk.split("\n").map(x => x.trim()).filter(Boolean);
    if (lines.every(l => /^[-\u2022]\s+/.test(l))) {
      const items = lines.map(l => l.replace(/^[-\u2022]\s+/, ""));
      H.push(`<ul style="margin:0 0 14px;padding-left:20px">${items.map(i => `<li style="margin:0 0 6px">${leadIn(i, true)}</li>`).join("")}</ul>`);
      T.push(items.map(i => `- ${inline(i, false)}`).join("\n"));
    } else if (lines.length === 1 && lines[0].length < 60 && lines[0] === lines[0].toUpperCase() && /[A-Z]/.test(lines[0])) {
      head(esc(lines[0]));
    } else {
      const joined = lines.join(" ");
      H.push(`<p style="margin:0 0 14px">${leadIn(joined, true)}</p>`);
      T.push(inline(joined, false));
    }
  }

  const priv = v("privacyUrl", shared);
  // Signature, laid out as the approved Atticus block
  const brand = filled(shared.teamName) ? shared.teamName.trim() : "";
  const bw = brand.split(" ");
  const brandH = brand ? `<span style="color:#FE5D29">${esc(bw[0])}</span>${bw.length > 1 ? " " + esc(bw.slice(1).join(" ")) : ""}` : "";
  H.push(`<p style="margin:22px 0 10px">Best regards,</p>`);
  T.push("Best regards,");
  if (brand) {
    H.push(`<p style="margin:0 0 10px;font:700 17px Arial,Helvetica,sans-serif;letter-spacing:.01em">${brandH}</p>`);
    T.push(brand);
  }
  if (filled(shared.phones)) {
    const ln = shared.phones.trim().split("\n").map(x => x.trim()).filter(Boolean);
    H.push(`<table role="presentation" style="border-collapse:collapse;margin:0 0 12px">${ln.map(l => {
      const m = l.match(/^(.*?):\s*(.+)$/);
      const lbl = m ? m[1] : "", num = m ? m[2] : l;
      const tel = num.replace(/[^\d+]/g, "");
      return `<tr><td style="padding:1px 6px 1px 0;font:15px/1.5 Arial,Helvetica,sans-serif;color:#1B1B1B;white-space:nowrap">${lbl ? esc(lbl) + ":" : ""}</td>` +
             `<td style="padding:1px 0;font:15px/1.5 Arial,Helvetica,sans-serif"><a href="tel:${esc(tel)}" style="color:#FE5D29;text-decoration:none">${esc(num)}</a></td></tr>`;
    }).join("")}</table>`);
    T.push(ln.join("\n"));
  }
  const urls = [];
  if (filled(shared.website)) urls.push(shared.website.trim());
  if (filled(shared.facebookUrl)) urls.push(shared.facebookUrl.trim());
  if (urls.length) {
    H.push(`<p style="margin:0 0 14px;font:15px/1.7 Arial,Helvetica,sans-serif">${urls.map(u => `<a href="${esc(u)}" style="color:#FE5D29">${esc(u)}</a>`).join("<br>")}</p>`);
    T.push(urls.join("\n"));
  }
  if (filled(shared.logoUrl)) {
    H.push(`<p style="margin:22px 0 20px"><img src="${esc(shared.logoUrl.trim())}" width="557" alt="Atticus Publishing, BBB Accredited Business, Alliance of Independent Authors, IBPA member, Trustpilot" style="display:block;width:100%;max-width:557px;height:auto;border:0"></p>`);
  }

  if (filled(shared.referralUrl)) {
    head("Help another author take their next step");
    para("Know an author who could benefit from publishing or marketing support? Discover how you can earn service credit through the Atticus Publishing referral program. It is separate from claiming your prize and is not needed to claim it.",
         "Know an author who could benefit from publishing or marketing support? Discover how you can earn service credit through the Atticus Publishing referral program. It is separate from claiming your prize and is not needed to claim it.");
    H.push(`<p style="margin:0 0 18px"><a href="${esc(shared.referralUrl.trim())}" style="color:#FE5D29;font-weight:700">View the program details and submit your referral</a></p>`);
    T.push(`View the program details and submit your referral: ${shared.referralUrl.trim()}`);
  }

  const footH = `You're receiving this email because you participated in our Frankfurt Book Exhibit giveaway.${filled(shared.privacyUrl) ? ` <a href="${esc(shared.privacyUrl)}" style="color:#6B6B6B">Privacy Policy</a>` : priv ? " " + priv.h : ""}`;
  const footT = `You're receiving this email because you participated in our Frankfurt Book Exhibit giveaway.${priv ? " Privacy Policy: " + priv.t : ""}`;
  const subject = filled(f.subject) ? inline(f.subject.trim(), false) : `You won ${name} at the Frankfurt Book Exhibit!`;

  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(subject)}</title></head>
<body style="margin:0;background:#F2F2F2"><table role="presentation" width="100%" style="background:#F2F2F2;padding:20px 10px"><tr><td align="center">
<table role="presentation" width="100%" style="max-width:600px;background:#FFFFFF;border-radius:14px;overflow:hidden">
<tr><td style="background:#000;padding:22px 28px"><span style="font:700 22px Arial,Helvetica,sans-serif;letter-spacing:.14em;color:#FE5D29">ATTICUS</span><br><span style="font:700 13px Arial,Helvetica,sans-serif;letter-spacing:.28em;color:#FFFFFF">PUBLISHING</span></td></tr>
<tr><td id="content" style="padding:26px 28px 8px;font:16px/1.55 Arial,Helvetica,sans-serif;color:#1B1B1B">${H.join("\n")}</td></tr>
<tr><td id="footer" style="padding:14px 28px 24px;font:12px/1.5 Arial,Helvetica,sans-serif;color:#6B6B6B;border-top:1px solid #EEE">${footH}</td></tr>
</table></td></tr></table></body></html>`;
  const text = [`Subject: ${subject}`, ...T, footT].join("\n\n").replace(/\n{3,}/g, "\n\n");
  return { subject, html, text, missing: missingFor(prize, shared) };
}

module.exports = { renderEmail, missingFor, FIELDS, SHARED, typeOf };

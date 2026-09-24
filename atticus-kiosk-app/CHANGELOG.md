# Changelog: Atticus Spin to Win kiosk

Version numbers: MAJOR.MINOR.PATCH. MAJOR changes how the giveaway works, MINOR adds features, PATCH fixes things.
The version shows on the start screen (bottom), in Staff → Settings, and in a notice after a tablet updates.

## 1.3.0 (24 September 2026) — preview, not deployed
- Entries, prizes and stock now live in the shared Supabase database (Frankfurt), so every tablet and phone sees the same thing.
- The draw happens on the server: two devices can never take the same last prize.
- One entry per author per campaign, enforced by the database across all devices.
- Public entry by QR code with no key; abuse limited per connection.
- Admin: sign in once per tablet, then the PIN reopens the view. Hand to author locks that tablet only. Log out ends the session.
- Done sends the winner email when the prize wording is complete, and queues it for staff review when it isn't.
- Test mode, and entry removal that returns exactly the stock it used.
- Campaigns: a separate preview campaign for testing, isolated from the real one.

## 1.2.0 (23 September 2026) — preview, not yet deployed
- Atticus mark in the middle of the wheel. It isn't a link and doesn't cover the prize labels; the header logo still opens the publishing guide.
- "Prizes You Could Win" funnel replaces the flat list: widest prize at the top, narrowing down, with the approved prize names.
- Prizes can carry a detail link (Staff → Prize control → Add detail link). Linked prizes show "Details ↗" and open in a new tab.
- Approved participant-facing prize names across the wheel, funnel, results, emails and admin. Internal prize ids unchanged, so older entries keep the name they were awarded under.
- Participant-facing odds display removed. Staff still see and edit the chances.

## 1.1.0 (23 September 2026)
- Send emails by hand from Entries: "Send email" opens the author's email, generated from our template, to review and edit before sending.
- Every email carries a fixed "Please do not reply to this email" notice; claims and questions go to the support address instead.
- Email sending through the app's own server on Vercel (Resend or ZeptoMail). Settings → Email sending: sending key, connection check, test email.
- Each send is recorded on the entry (who sent it, when, a copy of what was sent). A second email to the same author needs an extra confirmation.
- Version numbers and this changelog; "Updated to version x" notice after a tablet updates.
- Removed the "Draft build" banner.

## 1.0.0 (22 September 2026)
- First live release on Vercel as an installable tablet app: works offline, keeps the screen on, protects saved entries.
- Prize draw on the spin tap; full prizes leave the wheel automatically; repeat emails stopped before the wheel.
- Staff panel: prize control, entries with Excel and CSV export, email templates, settings.

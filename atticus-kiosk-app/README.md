# Atticus Spin to Win: tablet app

This folder is the complete app. Host it once, then install it on each tablet from the browser.

## 1. Put it online (Netlify, about 2 minutes)
1. Sign in at app.netlify.com.
2. Go to **Sites → Add new site → Deploy manually**.
3. Drag this whole folder (or the zip) onto the page.
4. Netlify gives you an address like `https://something.netlify.app`. Rename it under **Site configuration → Change site name** if you like.

Keep the address among staff. The page is hidden from search engines. Anyone who opens it can only save entries onto their own device, so nothing reaches you from outside the stand tablet.

### Or on Vercel (also no GitHub)
1. Sign in at vercel.com and go to **vercel.com/drop**.
2. Drag this folder or the zip onto the page, pick your team, name the project (for example `atticus-spin`), and select **Deploy**.
3. You get an address like `https://atticus-spin.vercel.app`.

**Updating on Vercel:** every drop makes a *new* project with a *new* address, and a tablet treats a new address as a brand-new app with no entries. So drop once, then for updates either:
- run `npx vercel --prod` inside this folder (asks you to log in and pick the existing project the first time), or
- connect the project to a Git repository later.
Never switch a tablet to a new address during the fair before exporting its entries.

## 2. Install on the tablet (needs internet once)
**iPad (Safari):** open the address → **Share** → **Add to Home Screen** → open it from the new icon.
**Android (Chrome):** open the address → menu (⋮) → **Install app**. Or: PIN screen → Settings → **Install on this tablet**.

After the first open it works without internet.

## 3. Check it's ready
Staff PIN → **Settings → This tablet**. You want:
- Installed: Yes
- Works offline: Yes
- Entries protected: Yes
- Screen stays on: Yes (if not supported, set the tablet's auto-lock to Never)

## 4. Lock the tablet to the app
- **iPad:** Settings → Accessibility → Guided Access → on. Open the app, triple-click the side button, Start.
- **Android:** Settings → Security → App pinning → on. Open the app, open recent apps, tap the icon, Pin.

## 5. During the fair
- Entries live on the tablet. **Export Excel at every break** (Staff → Entries → Export Excel).
- Don't clear the browser's data or uninstall the app until you've exported.
- Updates: publish a new version to the same address. Each tablet picks it up next time it's online, and only restarts on the "Spin to win" screen, never mid-entry.

## Email sending (set up once)
1. In Vercel → your project → **Settings → Environment Variables**, add (for Production):
   - `EMAIL_PROVIDER` = `resend` or `zeptomail`
   - `FROM_ADDRESS` = `Atticus Publishing <no-reply@yourdomain>`
   - `KIOSK_SEND_KEY` = a long random password you make up (you'll type it into each tablet)
   - `RESEND_API_KEY` (Resend) or `ZEPTO_TOKEN` (ZeptoMail; plus `ZEPTO_HOST` if your account is EU or India)
2. **Redeploy** so the variables take effect.
3. On the tablet: Staff → Settings → Email sending → paste the sending key → **Save key** → **Check connection** → **Send test email** to yourself.
4. To email a winner: Staff → Entries → **Send email** → review and edit → **Send email** → confirm.

Never paste API keys into chats or the GitHub repo; they only go in Vercel's settings.

## Releasing an update
1. Upload the new files into the `atticus-kiosk-app` folder on GitHub (Add file → Upload files) and commit. Vercel redeploys by itself.
2. Tablets update next time they're online, on the "Spin to win" screen, and show "Updated to version x".
3. Check the version at the bottom of the start screen.

## Before going live
- Change the staff PIN from 2026 (Settings).
- Delete practice entries (Settings → Delete all entries).

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

## Before going live
- Change the staff PIN from 2026 (Settings).
- Delete practice entries (Settings → Delete all entries).
- The top banner says "Draft build" until prizes, voucher terms and legal review are approved.

# Putting Cold Trail on the App Store & Play Store

Cold Trail is a web app. You don't rewrite it as a native app — you **wrap the
live website** in a store-ready package. The repo is already set up for this:
it's an installable **PWA** (app manifest, service worker, app icons), which is
the foundation every route below builds on.

**Prerequisite for all store routes:** the site must be live on HTTPS at a real
domain first — i.e. finish pointing `www.thecoldtrail.com` at Railway (see
`DEPLOY.md`). The stores wrap that URL.

---

## The honest summary of cost & effort

| Route | Store | Cost | Hard part |
|-------|-------|------|-----------|
| **Add to Home Screen (PWA)** | none — installs from the browser | **Free** | Nothing. Works today. |
| **Google Play** (TWA) | Play Store | **$25 once** | Almost none — a website generates the package for you. |
| **Apple App Store** | App Store | **$99 / year** | Needs a Mac + Xcode, and Apple review can reject thin website wrappers. |

Start with the free PWA, add Google Play next (cheap + easy), and treat the App
Store as the last and most involved step.

---

## Route 1 — Installable PWA (free, works right now)

No store, no fee. On the live site:

- **Android / Chrome:** a "Install app" / "Add to Home screen" prompt appears; tap it.
- **iPhone / Safari:** Share → **Add to Home Screen**.

It installs with the Cold Trail icon, opens full-screen (no browser bars), and
launches like a native app. This is the fastest way to get "an app" in people's
hands and to test everything before paying store fees.

---

## Route 2 — Google Play (recommended first store)

Easiest path, mostly no-code, via **PWABuilder** (a free Microsoft tool that
turns a PWA into a signed Android app using a Trusted Web Activity).

1. Pay the **one-time $25** and create a **Google Play Console** account:
   <https://play.google.com/console>.
2. Go to **<https://www.pwabuilder.com>**, enter `https://www.thecoldtrail.com`,
   and click **Package for stores → Android**. Download the `.aab` (App Bundle)
   and the generated `assetlinks.json`.
3. **Remove the browser address bar** (Digital Asset Links): PWABuilder gives you
   an `assetlinks.json`. It must be served at
   `https://www.thecoldtrail.com/.well-known/assetlinks.json`. Drop that file in
   the repo at `apps/web/.well-known/assetlinks.json`, push, and Railway serves
   it. (Send me the file and I'll wire it in — the server already allows that
   path.)
4. In Play Console: **Create app** → upload the `.aab` → fill in store listing
   (name, short/long description, screenshots — grab them from your phone), set
   content rating (this is a fictional crime game → likely Teen/16+), privacy
   policy URL, and submit. Review is usually a day or two.

You can reuse the app icons in `apps/web/icons/` and the description from
`apps/web/manifest.webmanifest` for the listing.

---

## Route 3 — Apple App Store (most involved)

Realities before you start:
- **$99/year** Apple Developer Program: <https://developer.apple.com/programs/>.
- You need a **Mac with Xcode** to build and submit (or a paid cloud-Mac / CI
  service). There's no way around a Mac for the final upload.
- **Review risk:** Apple's guideline 4.2 ("minimum functionality") rejects apps
  that are just a website in a shell. Cold Trail is a real interactive game, which
  helps, but give it the best chance: ship it with the app icon and splash, make
  sure it works offline-gracefully, and write a review note explaining it's an
  original multiplayer deduction game.

Two ways to generate the iOS project:
- **PWABuilder → iOS**: same site as Route 2, choose iOS; it produces an Xcode
  project wrapping the PWA. Open it in Xcode, set your Team, Archive → upload to
  App Store Connect.
- **Capacitor** (more control, this repo includes a starter `capacitor.config.json`):
  ```bash
  npm i -D @capacitor/cli @capacitor/core @capacitor/ios
  npx cap add ios
  npx cap sync
  npx cap open ios      # opens Xcode → set Team, Archive, upload
  ```
  The included config points the native shell at your live site, so the app
  always serves the latest version.

Then in **App Store Connect** (<https://appstoreconnect.apple.com>): create the
app, upload the build from Xcode, add screenshots + description + age rating,
and submit for review.

---

## Recommended order

1. ✅ Finish the domain (`DEPLOY.md`) so the site is live on HTTPS.
2. ✅ Test **Add to Home Screen** on your own phone — that's the app experience.
3. 💵 **Google Play** via PWABuilder ($25) — your first real store listing.
4. 💵 **App Store** via PWABuilder/Capacitor ($99/yr + a Mac) once Play is live.

I can help with the parts that live in this repo: the `assetlinks.json` wiring,
tuning `capacitor.config.json` (app id, name, splash), the store description and
age-rating answers, and a privacy-policy page. Just tell me which route you're
starting with.

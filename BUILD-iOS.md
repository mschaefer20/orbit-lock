# Shipping Orbit Lock to the App Store (from Windows)

Same pipeline as Tidal: the game in `www/` is wrapped by **Capacitor**, and
**Codemagic** builds, signs and uploads it from a cloud Mac. No Mac needed.
Everything below is already configured in this repo; you mostly click.

## 0. One-time prerequisites (you have these from Tidal)
- Apple Developer Program membership.
- Codemagic account with the `appstore` variable group (App Store Connect API
  key + `CERTIFICATE_PRIVATE_KEY`). Reuse it as-is; the API key has admin
  access so it can create the certificate and profile for the new bundle id.
- GitHub account (repo `mschaefer20/tidal` already exists there).

## 1. Push the code to GitHub
```
cd C:\Users\masch\Documents\games\game4
git add -A
git commit -m "Orbit Lock v1.0"
```
Create an empty repo on GitHub named `orbit-lock` (private is fine), then:
```
git remote add origin https://github.com/mschaefer20/orbit-lock.git
git push -u origin main
```

## 2. Register the app id + create the App Store Connect record
1. developer.apple.com → Certificates, Identifiers & Profiles → Identifiers →
   **+** → App IDs → App. Description `Orbit Lock`, Bundle ID **explicit**
   `com.mschaefer20.orbitlock`. No capabilities needed. Register.
2. appstoreconnect.apple.com → Apps → **+** → New App. Platform iOS, name
   `Orbit Lock`, primary language English, bundle id the one above, SKU
   `orbitlock`. Full access.

## 3. Hook up Codemagic
1. Codemagic → Add application → GitHub → `orbit-lock` → **codemagic.yaml**.
2. Confirm the `appstore` variable group is attached to this app (Team
   settings → the group is shared, but check the app can see it).
3. Start a build, workflow **Orbit Lock iOS**, branch `main`.
   The workflow also runs `tools/solve.js`, so a level that stopped solving
   fails the build on purpose.
4. About 15 minutes later the build appears in App Store Connect →
   TestFlight. Add yourself as an internal tester and install via the
   TestFlight app. **Play it on the phone before submitting.**

## 4. Publish the privacy page
App Store review needs a privacy URL. `docs/` has one ready, but GitHub
Pages only serves **public** repos on a free account (`tidal` is public,
`orbit-lock` is private). Either make the repo public (Settings → General →
Danger Zone → Change visibility; nothing secret is committed) or copy
`docs/` into `tidal/docs/orbit-lock/` and adjust the URLs. Then: repo →
Settings → Pages → Source: Deploy from a branch, `main`, folder `/docs`.
The URL becomes `https://mschaefer20.github.io/orbit-lock/privacy.html` and
support is `https://mschaefer20.github.io/orbit-lock/`. Check both load
(first deploy takes a few minutes) before pasting them into Connect.

## 5. Fill in the App Store page
Text to paste is in `STORE-LISTING.md`.
- Category **Games** → Puzzle. Secondary: Casual.
- **Age rating** questionnaire: all "None" → 4+.
- **App Privacy**: Data Not Collected (progress is stored on the device only).
- **Screenshots**: ready in `store/screenshots/` (6.9" 1320×2868 required,
  6.5" 1284×2778 for older phones). Upload 1-5 in order. Regenerate with
  `node tools/screenshots.js` if the art changes.
- Export compliance is already answered in the build (no custom encryption).
- Attach the TestFlight build, Add for Review, Submit.

## 6. Updates later
Bump `MARKETING_VERSION` in `codemagic.yaml` (and `CACHE` in `www/sw.js`),
commit, push, run the Codemagic workflow, attach the new build to a new
version in App Store Connect, submit. Adding levels is
`node tools/gen.js --count 130` first; the CI solve step re-proves them.

## Local checks before a build
```
npm install                 # once
node tools/solve.js         # every level still solves
node tools/make-assets.js   # regenerate icon/splash if you change the art
npx cap add ios && npx cap sync   # only works on a Mac; CI does this for you
```

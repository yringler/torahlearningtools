# Android apps on Google Play: one-time setup

`apps/android` wraps the two web apps in a WebView so each is its own Android app. Family Link then
sees "Word Quiz" and "משנה בעל פה" as their own apps with their own time limits. Chrome's limit
doesn't apply to them, unlike the installed Chrome web apps or a Trusted Web Activity (TWA), which
Android counts as Chrome.

| Flavor | Package name (permanent) | Loads |
| --- | --- | --- |
| `flashcards` | `com.torahlearningtools.chederflashcards` | https://chederflashcards.torahlearningtools.com/ |
| `baalpeh` | `com.torahlearningtools.baalpeh` | https://byheart.torahlearningtools.com/ |

The apps load the live site, so a normal Cloudflare deploy updates them. Publish a new Play build
only when `apps/android` itself changes.

Do the steps in order.

## 1. Google Play developer account

1. Sign up at <https://play.google.com/console/signup>. It costs $25 once and needs ID verification,
   which can take a few days.
2. A **personal** account is fine for internal testing. Note that personal accounts created after
   Nov 2023 must run a closed test with at least 12 testers for 14 days in a row before they can
   publish to **production**. Internal testing doesn't have this requirement.

## 2. Create the upload key (on your computer, once, used by both apps)

```sh
keytool -genkeypair -v -keystore upload.jks -alias upload \
  -keyalg RSA -keysize 4096 -validity 10000
# Pick one strong password. keytool's default PKCS12 format uses it for both the store and the key.
base64 -w0 upload.jks > upload.jks.b64      # macOS: base64 -i upload.jks -o upload.jks.b64
```

Back up `upload.jks` and its password somewhere safe, such as a password manager. Never commit it:
`*.jks` is already gitignored. Play App Signing holds the real app-signing key, so if you lose the
upload key, Play support can reset it. That takes days, though.

## 3. GitHub secrets

GitHub → repo **Settings → Environments → `production`** (the same environment the Cloudflare
deploys use) → **Add environment secret**:

| Secret | Value |
| --- | --- |
| `ANDROID_UPLOAD_KEYSTORE_BASE64` | Contents of `upload.jks.b64` (one line) |
| `ANDROID_UPLOAD_KEYSTORE_PASSWORD` | The keystore password from step 2 |
| `PLAY_SERVICE_ACCOUNT_JSON` | The whole JSON key file from step 5 |

The key alias is fixed to `upload` in the workflow. If you chose a different alias, edit
`ANDROID_KEY_ALIAS` in `.github/workflows/android.yml`.

## 4. Create the two apps and do the first upload by hand

Play only accepts API uploads for a package that already has one bundle uploaded through the
console, so the first upload of each app is manual.

1. In Play Console, select **Create app** twice:
   - "Word Quiz": app, free.
   - "משנה בעל פה": app, free.
2. GitHub → **Actions → "android: build and publish to Google Play" → Run workflow**. Choose branch
   `main`, app `both`, and **untick "upload"**. You can add the first two secrets before step 5 for
   this run.
3. Download the two artifacts. Each zip contains an `.aab`.
4. For each app in Play Console: **Test and release → Testing → Internal testing → Create new
   release**. Accept **Play App Signing** if asked, upload that app's `.aab`, save, and roll out.
   Make sure each `.aab` goes to the matching app. Play rejects a package name that doesn't match.
5. **Internal testing → Testers**: create an email list containing the Google accounts that will
   install the app, i.e. the kids' supervised accounts (and yours). Copy the **opt-in link**.

## 5. Service account so GitHub can upload

1. In Google Cloud Console (<https://console.cloud.google.com/>), create a project or pick any
   existing one.
2. Enable the **Google Play Android Developer API** for it.
3. **IAM & Admin → Service accounts → Create**, e.g. `github-play-upload`. It doesn't need any
   Cloud roles.
4. Open the service account → **Keys → Add key → JSON**. Save the downloaded file as the
   `PLAY_SERVICE_ACCOUNT_JSON` secret (step 3), then delete the file.
5. Play Console → **Users and permissions → Invite new users** → paste the service account's email
   (`…@….iam.gserviceaccount.com`). Under **App permissions**, add both apps with **Release apps to
   testing tracks**, plus **Release to production…** if you'll publish publicly. Send the invite.
   No acceptance step is needed. Permissions can take a while to take effect, up to about a day in
   some reports.

From now on: **Actions → Run workflow** on `main`, choose the app and track, keep "upload" ticked.
- **status**: until an app's first release has been published in the console, the API only accepts
  `draft` releases. If the upload fails with "Only releases with status draft may be created on
  draft app", run again with `draft`, then select **Roll out** in the console. After that, use
  `completed`.
- **versionCode** is the workflow run number, so every run is newer than the last.

## 6. Make baalpeh's sign-in email link open the app (optional, recommended)

Without this step, tapping the sign-in link opens the browser (which may be the locked Chrome) and
signs in there, not in the app. The parent can always type the 6-digit code from the email into the
app instead, which works with no setup.

1. Play Console → baalpeh app → **Test and release → App integrity → App signing**. Copy the
   **Digital Asset Links JSON** snippet. It contains the SHA-256 of Play's app-signing key.
2. Save it as `apps/baalpeh/public/.well-known/assetlinks.json`. The final file looks like:
   ```json
   [{
     "relation": ["delegate_permission/common.handle_all_urls"],
     "target": {
       "namespace": "android_app",
       "package_name": "com.torahlearningtools.baalpeh",
       "sha256_cert_fingerprints": ["AA:BB:…"]
     }
   }]
   ```
3. Merge to `main` (the baalpeh workflow deploys it). Check with
   `curl -i https://byheart.torahlearningtools.com/.well-known/assetlinks.json`: expect `200` and JSON.
4. Android checks the file when the app is installed or updated, so reinstall or update the app
   after the file is live.

## 7. Getting it onto the kids' tablets

1. On the tablet, signed in as the child, open the opt-in link from step 4.5 and **Become a
   tester**. Then install from the Play Store link on that page. Family Link may ask you to approve
   the install.
   - Not yet verified: whether Play lets a supervised child account opt into an internal test. If
     it doesn't, the fallback is a closed test or a production release (see step 1's 12-testers
     rule).
2. In Family Link, set Chrome's limit as you like and give the two apps their own limit (or "Always
   allowed").
3. **Test the whole point first:** use up Chrome's time, then open both apps. They should still
   work. Also check offline: open each app once online, then turn on airplane mode.

## Before a closed or production release (not needed for internal testing)

Play Console's **App content** section needs:
- A **privacy policy URL**. Neither site has one yet.
- **Target audience**. Word Quiz is for children, which brings in Google Play's Families policy:
  no ads SDKs, an accurate Data safety form, and so on.
- **Data safety**. baalpeh collects an email address for the account. Account deletion already
  exists in the app (`DELETE /api/account`). Play also wants a web URL where users can request
  deletion.
- Content rating questionnaire, store listing text, screenshots, and a 512×512 icon (use the web
  apps' `icon-512.png`).

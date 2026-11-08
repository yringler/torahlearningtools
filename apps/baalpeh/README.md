# משנה בעל פה — Mishnah Ba'al Peh

A tablet-friendly web app that helps children memorize Mishnayos by heart, starting with **Maseches Brachos**.
Parents sign in with an emailed link or code. Progress is saved on the device first and synced to a small
Cloudflare Worker (Hono + D1), so it works offline and follows the family across tablets.

## Deploying to Cloudflare (checklist)

Full steps: [§15 of the server plan](docs/SERVER_PLAN.md#15-deployment-steps-for-the-owner).

- [ ] `npx -y npm@11.6.2 install`, then `npx wrangler login`.
- [ ] **D1:** `npx wrangler d1 create baalpeh`, paste the printed `database_id` into `wrangler.jsonc`, then
      `npm run db:migrate:remote` (applies `migrations/`).
- [ ] **`wrangler.jsonc` placeholders** (marked `OWNER`): `database_id`, `vars.APP_ORIGIN` (`https://your.domain`, no
      trailing slash), `vars.EMAIL_FROM`, `vars.TURNSTILE_SITE_KEY`, and the commented `routes` entry for your custom domain.
- [ ] **Turnstile:** dashboard → Turnstile → Add widget for your hostname (Managed). Site key → `vars.TURNSTILE_SITE_KEY`;
      secret key → `npx wrangler secret put TURNSTILE_SECRET_KEY`.
- [ ] **Resend:** add and verify your sending domain (DNS records in Cloudflare) until it shows *Verified*; create a
      sending-only API key → `npx wrangler secret put RESEND_API_KEY`; set `vars.EMAIL_FROM` to an address on that
      domain, e.g. `Mishnah Ba'al Peh <login@your.domain>`. Without the key, production refuses to send login emails.
- [ ] **Auth secret:** `openssl rand -base64 32 | npx wrangler secret put AUTH_SECRET`.
- [ ] **Deploy:** `npm run deploy` (build, remote migrations, `wrangler deploy`).
- [ ] **GitHub Actions (monorepo root [`.github/workflows/baalpeh.yml`](../../.github/workflows/baalpeh.yml)):** add repository secrets `CLOUDFLARE_API_TOKEN` ("Edit
      Cloudflare Workers" template plus *Account → D1 → Edit*) and `CLOUDFLARE_ACCOUNT_ID`, and create a GitHub
      environment named `production`. Pushes to `main` that touch `apps/baalpeh/` then test and deploy
      (see [`docs/cloudflare-setup.md`](../../docs/cloudflare-setup.md) at the monorepo root).
- [ ] Smoke test: sign in by code on one device and by link on another, add a child, learn a step, check it syncs.

## How the learning works

Each mishnah is cut into child-sized **pieces** (2–6 words, split at natural phrase breaks). Pieces are grouped into
**parts** of up to 6. The child goes through a cumulative chain:

```
piece 1 → piece 2 → 1+2 → piece 3 → 1–3 → … → whole part
(long mishnah) part 2 the same way → parts 1+2 → … → whole mishnah → parent check ✓
```

A **perek** is built up the same way, with mishnayos in place of pieces:

```
mishnah 1 → mishnah 2 → 1+2 → mishnah 3 → 1–3 → … → whole perek → 🎯 "I'm ready to be tested" → email to the parent
→ the parent listens, taps the link in the email and confirms → perek verified → the next perek opens
```

Perakim longer than 5 mishnayos are split evenly into parts (8 → 4+4), each part is built up, then the parts are
joined (1–8). Saying mishnayos together is self-checked like a chain inside a mishnah.

**Moving to the next perek is not on the honor system.** At the end of a perek the child can look the whole perek
over (and say it once alone), then taps "I'm ready to be tested" and confirms. The server emails the account's address:
the child's name, the perek phrase by phrase, and a link (at most one email per child every 10 minutes). Only the
parent's tap on that link, then "knows it" on the page it opens (`/perek-test`), verifies the perek, on the server; no
in-app check and nothing the device sends can. Every perek after the first unverified one is greyed out and can't be
opened; its saved progress and stars stay. While waiting, the child can "Continue as a guest": guest mode is ungated and
never counts. Progress saved on the device (guest or pre-account) can be imported only into an account with no
children. See [`docs/PARENT_VERIFICATION.md`](docs/PARENT_VERIFICATION.md). On the map, each perek row has a progress ring and its mishnah circles joined by golden threads (gold
once those two mishnayos were said together), with a golden spine down to the next perek. Tapping the perek opens the
**perek screen**: its step path, where tapping selects "mishnah 2 alone", "mishnayos 1–2 together", a whole part or the
🎯 test, and one button runs it (practice of known mishnayos changes no progress). Older saved progress is read as it is:
"mishnayos 1–k in a row" counts for every chain inside 1–k, and a perek finished before verification counts as learned
(its next step is the parent's test). See
[`docs/PEREK_BUILDUP.md`](docs/PEREK_BUILDUP.md).

Hints fade as the child learns:

| Level | Shows |
|---|---|
| L0 | Full text + simple meaning; tap any word for its meaning |
| L2 | First letter of each word, with its nikud (מֵ·· קוֹ·· אֶ··) |
| L3 | First word of each piece (used in chains) |
| L4 | Empty card, said by heart |

Without speech recognition, honesty comes from **peeks**: tapping a hidden card shows it for 2 seconds and is counted.
A clean round passes. One peek means repeat once. Two or more steps back a hint level, and after three misses the
app runs extra practice on the hardest piece together with the one before it. The "I said it" button is locked for a few seconds so it
can't be tapped through. At the end of every mishnah, and in every perek review, a **parent check** screen shows the
parent the full text. The parent taps any words the child slipped on, then grades the recitation. The end of a perek is
the emailed test above, not an in-app check.

**Review**: known mishnayos come back after 1, 3, 7, 14, 30, 60 days (Leitner boxes). Once a perek is verified, the
whole perek is reviewed as one item. Reviews of locked perakim wait until they open. "Start today's learning" always does
due reviews first (at most 6, oldest first), then continues new learning,
and suggests stopping after the session length set by the parent (default 15 min).

**Two ways in.** The sign-in page offers "Sign in as learner" and "Sign in as parent"; both email a link and a code to
the family's account email. Learner mode is only learning: pick a child, learn, guest mode, the meaning view and an
"Aa" text-size sheet, plus a small "Parent? Sign in as parent" link. **Parent mode** is a separate area with no learning
screens, opened by a parent sign-in plus a 4-digit PIN (chosen on the first parent sign-in), and re-locked after
5 minutes idle, a minute in the background, or on leaving. It holds everything else: adding, editing and removing
children; their settings (name, picture, breaks, meanings, text size); each child's perakim, where a parent can mark a
perek verified or remove the verification, reset a perek or mark a mishnah not known; the child's activity; a change log
of every PIN change and parental edit with the time and the login that made it; backup export/import; moving guest
progress into the account; signing out and deleting the account. "Forgot PIN?" emails a link to `/parent-pin`; every PIN
change sends a notice email. Once a PIN is set, the perek-test page asks for it before "knows it" confirms.

The design spec this was built from is in [`docs/DESIGN.md`](docs/DESIGN.md).

## Data pipeline

```
data/catalog.json                  the masechtos (seder, Sefaria book, names) and each one's translation sources
scripts/fetch_sefaria.py <id>      → data/<id>/raw/perek_N.json    (Sefaria API: Hebrew Torat Emet + the masechta's sources)
scripts/chunk.py <id>              → data/<id>/chunks.json         (mechanical phrase chunking)
(LLM pass, brief in scripts/GLOSS_PROMPT.md; translated masechtos only)
                                   → data/<id>/gloss/perek_N.json  (refined chunks + kid-level meaning per piece and per word)
scripts/validate_gloss.py <id> [N…]  checks that the Hebrew matches the source byte for byte, that the Steinsaltz excerpts
                                   rebuild Steinsaltz exactly (text and bold), and that every word has a gloss and every
                                   piece names its sources
scripts/build_data.py              → public/data/m/<id>.<hash>.json   (one file per masechta, fetched when opened;
                                                                       applies data/<id>/hide.json)
                                   → src/data/index.json              (small catalog bundled into the app, by seder)
                                   → worker/data/text.json            (the Hebrew pieces, for the perek-test email)
```

All scripts read `data/catalog.json` through `scripts/catalog.py`. `fetch_sefaria.py` takes the number of perakim from
Sefaria's index API, retries Sefaria's frequent 503/504 errors with backoff (`--keep` resumes, skipping perakim already
fetched), and stops if a version is missing rather than writing an empty text.

**Translation is optional per masechta.** A masechta whose `sources` in `data/catalog.json` is `[]` ships in Hebrew
only: `build_data.py` builds it from the mechanical chunks, with an empty summary and `en: ""` on every piece and word
(the same shape as a translated masechta), and `src/data/index.json` marks it `"translated": false`. Peah and Demai are
like this, because Sefaria has neither Steinsaltz nor Silverstein's Bartenura for them. A masechta that does list
sources must be fully glossed, or the build fails.

The text is **not** in the JavaScript bundle. Each masechta is its own JSON file named by content hash, so it can be
cached forever and a fix to one masechta re-downloads only that one. The full Mishnah would be roughly 20 MB raw
(about 4 MB gzipped), which is far too much to ship to every user up front.

### Offline

`sw/sw.ts` is the service worker. `vite.config.ts` compiles it to `dist/sw.js` with the build's file list and a version
hash. It precaches the app (HTML, JS, CSS, fonts, icons, manifest) and saves each masechta the first time it's opened. Page loads go to the network first so new deploys show up; with
no connection (or after 3 s), the cached app opens. `/api` requests never go through the cache. The worker registers
only in production builds, so to try it locally use `npm run preview:worker`. Fonts are self-hosted from the Fontsource npm packages (`src/fonts.css` declares only the Hebrew and Latin files the
app uses), so nothing is loaded from Google. The Home Screen name and icon come from
`public/manifest.webmanifest`, `public/icons/` and the `apple-*` tags in `index.html`.

### Meanings and sources

There are two views of each piece's meaning. The child or parent can switch between them, and the parent sets the default.

- **Simple** is one short line for a young reader, sometimes with a short explanation. An AI wrote it by
  simplifying Steinsaltz's bold translation and checking it against Bartenura. Each piece records which source(s) it was
  based on (`basis`). Where the two differ, Steinsaltz is followed. Bartenura only fills in where Steinsaltz leaves a word
untranslated. (`docs/SOURCE_NOTES.md` lists the differences for reference only.)
- **Steinsaltz** is quoted word for word from the Koren Noé / William Davidson translation. **Bold** is the
  translation and the lighter text is his explanation. Longer explanations sit behind "more…". The validator
  guarantees the excerpts, put back together, are exactly Steinsaltz's text.

Word meanings (tap a word) follow Steinsaltz's bold translation. Sources show up only through a small ⓘ next to each meaning
(source names and a link to the mishnah on Sefaria), so there are no footnotes.

Translations used: Steinsaltz (primary) and Bartenura translated by R. Shraga Silverstein (secondary).
Not used: Open Mishnah (a community translation), Mishnah Yomit (Kulp), and De Sola & Raphall (on Sefaria it covers
only perek 1 of Brachos).

The simple lines are AI-written paraphrases of Steinsaltz. If one reads oddly, it's an easy fix in `data/<id>/gloss/`.

### Hidden content

Some mishnayos deal with topics that aren't suitable for young children (in Brachos: 2:5, the wedding night, and 3:4–3:6,
ba'al keri, niddah and similar). The simple lines already keep these vague. `data/<id>/hide.json` (here `data/berakhot/hide.json`) covers the rest at
build time:

- `hideSteinsaltz` lists mishnayos whose Steinsaltz text is left out. Those pieces show only the simple meaning, and the
  Steinsaltz toggle and "full Steinsaltz" button don't appear.
- `override` rewords single simple lines or word glosses (`ref`, `piece` (1-based), optional `word` (matched on letters,
  ignoring nikud), and the fields to `set`).

The gloss files keep the original text, so `validate_gloss.py` still checks it against the source, and removing a rule
brings it back. A rule that no longer matches the gloss stops the build. `tests/data.test.ts` fails if certain
explicit words appear in the built data. A Hebrew-only masechta has no meanings to hide, so it has no `hide.json`.

### Adding a masechta

Run everything from `apps/baalpeh`.

1. **Catalog entry.** Add the masechta to `masechtos` in `data/catalog.json`, in learning order: `id` (lowercase, used
   in file names and URLs; never rename one once shipped), `seder` (add the seder to `sedarim` if it's new), `sefaria`
   (the book, e.g. `Mishnah_Peah`), `he`, `en` (exactly Sefaria's name after `Mishnah_`, since app links are built from
   it) and `sources`: `["steinsaltz", "bartenura"]` if Sefaria has those translations for it, `[]` for Hebrew only.
2. **Fetch:** `python3 scripts/fetch_sefaria.py <id>` (rerun with `--keep` if Sefaria keeps failing).
3. **Chunk:** `python3 scripts/chunk.py <id>`.
4. **Gloss** (only if it has translation sources; Hebrew-only masechtos skip steps 4 and 5). Follow
   `scripts/GLOSS_PROMPT.md`, one agent per perek, each writing `data/<id>/gloss/perek_N.json`. A perek is done only
   when `python3 scripts/validate_gloss.py <id> N` prints OK; finish with `python3 scripts/validate_gloss.py <id>`,
   which checks every perek.
5. **Content-suitability sweep.** Read the whole gloss (simple lines, word glosses, Steinsaltz excerpts) for topics
   that aren't suitable for young children, as was done for Berakhot, and write `data/<id>/hide.json` with the same
   `hideSteinsaltz` and `override` rules (see "Hidden content" above), each with its reason.
6. **Build and test:** `npm run data`, then `npm test` and `npm run build`. The build writes the masechta's file in
   `public/data/m/`, its line in `src/data/index.json` and its text in `worker/data/text.json`; commit all of them with
   `data/<id>/`. Other masechtos' files keep their names unless their data changed.

Progress keys that don't name a masechta (`"perek:mishnah"`) mean `DEFAULT_MASECHTA_ID` in `src/data.ts`, which is fixed
to Berakhot, so adding a masechta or changing the catalog's order never changes what old progress refers to.

## Develop

```bash
cp .dev.vars.example .dev.vars   # local secrets: Turnstile test keys, a dev AUTH_SECRET, no Resend key
npx -y npm@11.6.2 install        # npm 11 is required (npm 10 crashes resolving Vitest 4)
npm run dev:api      # terminal 1: applies local D1 migrations, wrangler dev on :8787; sign-in emails are printed here
npm run dev          # terminal 2: Vite on :5173 with /api proxied → open http://localhost:5173
npm run preview:worker   # optional: production-like single server on :8787 serving the built dist/
npm test             # client + worker tests (npm run test:client / npm run test:worker)
npm run typecheck    # app and worker
npm run build        # → dist/
```

The server lives in `worker/` (API under `/api/*`), the schema in `migrations/`, and the HTTP contract shared by both
sides in `shared/api.ts`. The full design is in [`docs/SERVER_PLAN.md`](docs/SERVER_PLAN.md).

**Parent mode** ([`docs/PARENT_MODE.md`](docs/PARENT_MODE.md)) is a separate, server-enforced area: an email sign-in
"as parent" (its own 14-day session cookie) plus a 4-digit PIN (hashed, 5 tries, reset by email, every change emailed).
It holds every power: children, settings, progress edits, marking perakim verified or not, and a change log. The client
is in `src/parent/` (`ParentApp.tsx` shell, `useParent.ts` in-memory store, `pin.ts` and `log.ts` pure logic), with
`src/components/PinPad.tsx`, `src/auth/PinResetLanding.tsx` (`/parent-pin`) and the login choice in `src/auth/Login.tsx`.

| API | Session | Purpose |
|---|---|---|
| `POST /api/auth/request`, `verify-link`, `verify-code` | none | email sign-in; `as: "learner" \| "parent"` picks the session |
| `GET /api/me`, `POST /api/sync` | learner | learning; sync can't add, delete or rename children |
| `POST /api/perek-tests`, `/lookup`, `/confirm`, `/forgot-pin` | learner / none | the perek test email; confirm needs the PIN once set |
| `/api/parent/me`, `/unlock`, `/lock`, `/pin`, `/pin/forgot`, `/logout` | parent | PIN and session |
| `/api/parent/sync`, `/children/:id/{events,stats,verifications}`, `/log`, `/learner-session`, `DELETE /account` | parent, unlocked | parent powers |
| `POST /api/pin-reset/lookup`, `POST /api/pin-reset` | none (emailed token) | "Forgot PIN?" |

**Deploy**: one Cloudflare Worker serves the app and the API. First-time setup (D1 database, Turnstile widget, Resend
domain and API key, `AUTH_SECRET`, custom domain) is described step by step in
[§15 of the server plan](docs/SERVER_PLAN.md#15-deployment-steps-for-the-owner). After that, `npm run deploy` (or a push to
`main` that touches `apps/baalpeh/`, via the monorepo's
[`.github/workflows/baalpeh.yml`](../../.github/workflows/baalpeh.yml)) builds, applies remote migrations and deploys.
On iPad/iPhone, open the site and use "Add to Home Screen".

## Sources & licenses

Hebrew text: Torat Emet 357 via [Sefaria](https://www.sefaria.org) (public domain). English: William Davidson
Edition (Steinsaltz, [CC BY-NC 4.0](https://creativecommons.org/licenses/by-nc/4.0/)) and The Mishna with Obadiah
Bartenura by R. Shraga Silverstein ([CC BY 3.0](https://creativecommons.org/licenses/by/3.0/)), via Sefaria. The
"Simple" and word meanings adapt Steinsaltz, so they're CC BY-NC too. The English is used only for translated
masechtos (Berakhot); Hebrew-only masechtos (Peah, Demai) ship the public-domain Hebrew alone. Details, including what was changed, are in
[`data/LICENSES.md`](data/LICENSES.md). The app shows the attribution at `/licenses` (no sign-in needed), with links from
the sign-in screen, each meaning's ⓘ, parent mode's settings and guest settings.

The app is free and non-commercial, as the CC BY-NC source requires. The sign-in screen, parent mode and the
guest sheet say accounts may later become a small yearly family subscription (about $5–10), and that guest mode would
stay free. Before charging, get written permission from Koren or rebuild the meanings from Bartenura/public-domain
sources only (see `data/LICENSES.md`).

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
- [ ] **GitHub Actions (`.github/workflows/deploy.yml`):** add repository secrets `CLOUDFLARE_API_TOKEN` ("Edit
      Cloudflare Workers" template plus *Account → D1 → Edit*) and `CLOUDFLARE_ACCOUNT_ID`, and create a GitHub
      environment named `production`. Pushes to `main` then test and deploy.
- [ ] Smoke test: sign in by code on one device and by link on another, add a child, learn a step, check it syncs.

## How the learning works

Each mishnah is cut into child-sized **pieces** (2–6 words, split at natural phrase breaks). Pieces are grouped into
**parts** of up to 6. The child goes through a cumulative chain:

```
piece 1 → piece 2 → 1+2 → piece 3 → 1–3 → … → whole part
(long mishnah) part 2 the same way → parts 1+2 → … → whole mishnah → parent check ✓
mishnayos 1–2 in a row → 1–3 in a row → … → whole perek in one shot (parent check) = perek complete
```

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
can't be tapped through. At the end of every mishnah and every "in a row" chain, a **parent check** screen shows the
parent the full text. The parent taps any words the child slipped on, then grades the recitation.

**Review**: known mishnayos come back after 1, 3, 7, 14, 30, 60 days (Leitner boxes). Once a perek is complete, the
whole perek is reviewed as one item. "Start today's learning" always does due reviews first, then continues new learning,
and suggests stopping after the session length set by the parent (default 15 min).

Other features: a profile for each child, a parent area (hold the lock button for 2 s) with settings, backup
export/import, and per-mishnah reset. Read-aloud is off by default because device voices use Israeli pronunciation
and often ignore nikud.

The design spec this was built from is in [`docs/DESIGN.md`](docs/DESIGN.md).

## Data pipeline

```
scripts/fetch_sefaria.py     → data/raw/berakhot_N.json   (Sefaria v3 API: Hebrew Torat Emet, Steinsaltz, Bartenura/Silverstein)
scripts/chunk.py             → data/chunks.json           (mechanical phrase chunking)
(LLM pass, brief in scripts/GLOSS_PROMPT.md)
                             → data/gloss/perek_N.json    (refined chunks + kid-level meaning per piece and per word)
scripts/validate_gloss.py    checks that the Hebrew matches the source byte for byte, that the Steinsaltz excerpts rebuild
                             Steinsaltz exactly (text and bold), and that every word has a gloss and every piece names its sources
scripts/build_data.py        → public/data/m/<id>.<hash>.json   (one file per masechta, fetched when opened)
                             → src/data/index.json              (small catalog bundled into the app)
```

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

The simple lines are AI-written paraphrases of Steinsaltz. If one reads oddly, it's an easy fix in `data/gloss/`.

To add another masechta: change `BOOK` in `fetch_sefaria.py`, rerun the pipeline, generate gloss files, and add a line
to `MASECHTOS` in `build_data.py`. Note that progress keys (`"perek:mishnah"`, locally and in D1) don't name a masechta
yet, so the app currently learns the first masechta in the catalog. Learning more than one needs those keys extended.

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

**Deploy**: one Cloudflare Worker serves the app and the API. First-time setup (D1 database, Turnstile widget, Resend
domain and API key, `AUTH_SECRET`, custom domain) is described step by step in
[§15 of the server plan](docs/SERVER_PLAN.md#15-deployment-steps-for-the-owner). After that, `npm run deploy` (or a push to
`main`, via `.github/workflows/deploy.yml`) builds, applies remote migrations and deploys.
On iPad/iPhone, open the site and use "Add to Home Screen".

## Sources & licenses

Hebrew text: Torat Emet 357 via [Sefaria](https://www.sefaria.org) (public domain). English: William Davidson
Edition (Steinsaltz, CC-BY-NC) and The Mishna with Obadiah Bartenura by R. Shraga Silverstein (CC-BY), via Sefaria. This project is for
non-commercial use, in keeping with the CC-BY-NC source.

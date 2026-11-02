# Cloudflare and GitHub setup

What the owner has to do once, by hand, so the GitHub Actions in this repo can deploy the three apps
to the Cloudflare Workers that already exist. Nothing here creates a new Worker for baalpeh or
cheder-flashcards: the `name` in each `wrangler.jsonc` is the same as before, so a deploy updates the
existing Worker.

| App | Worker | URL | Deployed by |
| --- | --- | --- | --- |
| `apps/home` | `torahlearningtools-home` (does not exist yet; the first deploy creates it) | https://torahlearningtools.com | `.github/workflows/home.yml` |
| `apps/baalpeh` | `baalpeh` (+ D1 database `baalpeh`) | https://byheart.torahlearningtools.com | `.github/workflows/baalpeh.yml` |
| `apps/cheder-flashcards` | `cheder-flashcards` | https://chederflashcards.torahlearningtools.com | `.github/workflows/cheder-flashcards.yml` |

Each workflow runs only when files under its own `apps/<name>/` folder (or the workflow file itself)
change. Pull requests only test and build. Pushes to `main` test, build and deploy.

Do the steps in order. Until steps 1–3 are done, the deploy jobs on `main` fail at the
`wrangler` step (missing credentials). That failure is harmless: nothing is deployed.

## 1. Create a Cloudflare API token

Docs: <https://developers.cloudflare.com/workers/ci-cd/external-cicd/github-actions/> and
<https://developers.cloudflare.com/workers/authorization/workers/>.

1. In the Cloudflare dashboard, go to **Account API tokens** (<https://dash.cloudflare.com/?to=/:account/api-tokens>).
2. Select **Create Token**.
3. Under **Permission policies**, open the **Custom** dropdown and select **Edit Cloudflare Workers**.
4. Name it, for example `github-actions torahlearningtools`.
5. Check that the permissions include these, and add any that are missing:
   - **Account → Workers Scripts → Edit** (deploy, and create `torahlearningtools-home` the first time)
   - **Account → D1 → Edit** (baalpeh runs `wrangler d1 migrations apply baalpeh --remote`; the template
     does not include D1)
   - **Account → Account Settings → Read**
   - **Zone → Workers Routes → Edit**, scoped to the zone `torahlearningtools.com` (needed because
     `apps/home/wrangler.jsonc` adds the custom domain `torahlearningtools.com` on deploy)
6. Scope it: **Account resources** = only your account; **Zone resources** = `torahlearningtools.com`
   (or the zones you want to allow).
7. Create the token and copy the value. You see it only once.

You can reuse the token the old baalpeh repo used if it already has the permissions above, but a new
token for the new repo is cleaner.

## 2. Find your account ID

Docs: <https://developers.cloudflare.com/fundamentals/account/find-account-and-zone-ids/>.
It is shown in the dashboard on the account home / Workers & Pages overview, and `npx wrangler whoami`
prints it too.

## 3. Add secrets and the `production` environment on GitHub (repo `yringler/torahlearningtools`)

All three deploy jobs use `environment: production` and the secrets `CLOUDFLARE_API_TOKEN` and
`CLOUDFLARE_ACCOUNT_ID`.

1. On GitHub, open the repo → **Settings** → **Environments** → **New environment**, name it `production`
   (exact spelling), **Configure environment**. Optionally, under **Deployment branches and tags**, choose
   **Selected branches and tags** and allow only `main`.
2. Add the two secrets. Either:
   - as **environment secrets** on `production` (same page, **Environment secrets → Add environment secret**), or
   - as **repository secrets**: **Settings → Secrets and variables → Actions → New repository secret**.

   Names: `CLOUDFLARE_API_TOKEN` (the token from step 1) and `CLOUDFLARE_ACCOUNT_ID` (step 2).
3. **Settings → General → Default branch**: make sure it is `main` (switch it with the ⇄ button if
   GitHub picked another branch). The deploy jobs only run for `refs/heads/main`.

## 4. First deploy

Re-run the failed workflows (repo → **Actions** → pick the workflow → the failed run → **Re-run all
jobs**), or start each one with **Run workflow** (they all have `workflow_dispatch`) on `main`.
Expected result:

- **baalpeh**: tests pass, `wrangler d1 migrations apply baalpeh --remote` says no migrations to apply
  (they were already applied by the old repo), then `wrangler deploy` updates the `baalpeh` Worker.
- **cheder-flashcards**: updates the `cheder-flashcards` Worker.
- **home**: creates the `torahlearningtools-home` Worker and the custom domain `torahlearningtools.com`.

Check each URL in the table above afterwards.

### Apex custom domain for home

`apps/home/wrangler.jsonc` has `"routes": [{ "pattern": "torahlearningtools.com", "custom_domain": true }]`,
so `wrangler deploy` creates the DNS record and certificate. Docs:
<https://developers.cloudflare.com/workers/configuration/routing/custom-domains/>.

- Before the first deploy, look at **DNS → Records** for `torahlearningtools.com`. Cloudflare says:
  "You cannot create a Custom Domain on a hostname with an existing CNAME DNS record." If there is an
  existing `CNAME`/`A`/`AAAA` record for the apex `torahlearningtools.com` (not the `byheart` /
  `chederflashcards` subdomains, leave those alone), delete it first.
- To check afterwards: **Workers & Pages** → `torahlearningtools-home` → **Settings** → **Domains & Routes**.
- `www.torahlearningtools.com` is not covered. If you want it, add a redirect rule (see "Redirect
  between www and root domain" on the same docs page).

### Custom domains for baalpeh and cheder-flashcards

Their `wrangler.jsonc` files have no `routes`, the same as in the old repos: the custom domains
`byheart.torahlearningtools.com` and `chederflashcards.torahlearningtools.com` were attached in the
dashboard. A `wrangler deploy` without `routes` leaves them as they are. Confirm under
**Workers & Pages** → the Worker → **Settings** → **Domains & Routes**.

## 5. Stop the old pipelines (only after step 4 worked)

Two pipelines must not deploy the same Worker. Do this only after the monorepo deploys succeeded and
the sites look right.

**baalpeh (old repo `yringler/baalpeh`)**: it deploys from `.github/workflows/deploy.yml` on pushes to
its `main`.
1. In that repo: **Actions** → "Test and deploy to Cloudflare" → **⋯** → **Disable workflow**.
2. Optionally remove its `CLOUDFLARE_API_TOKEN` secret (or revoke that token in Cloudflare if no
   longer used anywhere).
3. Archive the repo: **Settings → General → Danger Zone → Archive this repository**. It stays readable;
   its history is already in `apps/baalpeh` here.

**cheder-flashcards (old repo `yringler/cheder-flashcards`)**: it has no GitHub workflow. It was deployed
by hand (`npm run deploy`) or by Cloudflare Workers Builds.
1. In Cloudflare: **Workers & Pages** → `cheder-flashcards` → **Settings** → **Builds**. If a Git
   repository is connected, select **Disconnect**
   (docs: <https://developers.cloudflare.com/workers/ci-cd/builds/>). Otherwise there is nothing to do here.
2. Archive the repo on GitHub as above.

Stop running `npm run deploy` from old local clones; deploy from `apps/<name>/` in this repo instead
(or let the workflow do it).

## Alternative: deploy cheder-flashcards (or home) with Workers Builds instead

The default here is GitHub Actions for all three apps: one place for logs, one set of secrets, and the
same path filtering for every app. If you would rather have Cloudflare build cheder-flashcards from git:

1. Remove the `deploy` job from `.github/workflows/cheder-flashcards.yml` (keep the `test` job for PR checks).
2. Cloudflare dashboard → **Workers & Pages** → `cheder-flashcards` → **Settings** → **Builds**.
   If the old repo is connected, **Disconnect** it. Then **Connect**, choose GitHub and
   `yringler/torahlearningtools`, and set:
   - **Git branch**: `main`
   - **Root directory**: `apps/cheder-flashcards` (the folder holding its `wrangler.jsonc`;
     docs: <https://developers.cloudflare.com/workers/ci-cd/builds/advanced-setups/>)
   - **Build command**: `npm run build`
   - **Deploy command**: `npx wrangler deploy`
   - **Build watch paths** (Settings → Build → Build watch paths): Include `apps/cheder-flashcards/*`,
     Exclude empty (docs: <https://developers.cloudflare.com/workers/ci-cd/builds/build-watch-paths/>).
     Without it, every push to the monorepo rebuilds this app.
3. The Worker name in the dashboard must match `name` in `apps/cheder-flashcards/wrangler.jsonc`
   (`cheder-flashcards`), or the build fails. It already does.

The same steps work for `torahlearningtools-home` (root directory `apps/home`, watch path `apps/home/*`,
build command `npm run build`) once the Worker exists. Baalpeh stays on GitHub Actions because it also
has to apply D1 migrations before deploying.

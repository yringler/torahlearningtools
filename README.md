# Torah Learning Tools

A monorepo of small Torah-learning projects hosted on [torahlearningtools.com](https://torahlearningtools.com).

## Apps

| App | What it is | URL | Cloudflare Worker |
| --- | --- | --- | --- |
| [`apps/home`](apps/home) | Landing page | https://torahlearningtools.com | `torahlearningtools-home` (static assets) |
| [`apps/baalpeh`](apps/baalpeh) | Mishnah Ba'al Peh: learn mishnayos by heart (React client, Worker API, D1) | https://byheart.torahlearningtools.com | `baalpeh` + D1 `baalpeh` |
| [`apps/cheder-flashcards`](apps/cheder-flashcards) | Hebrew → English vocabulary flashcards for kids | https://chederflashcards.torahlearningtools.com | `cheder-flashcards` (static assets) |

`apps/baalpeh` and `apps/cheder-flashcards` were merged in from
[yringler/baalpeh](https://github.com/yringler/baalpeh) and
[yringler/cheder-flashcards](https://github.com/yringler/cheder-flashcards) with their full git history
(`git log -- apps/baalpeh` shows it).

## Layout

```
apps/<name>/               one app per folder: own package.json, package-lock.json, wrangler.jsonc
.github/workflows/<name>.yml   one workflow per app
docs/cloudflare-setup.md   one-time Cloudflare + GitHub setup for deploys
```

## Dependencies: one lockfile per app

There are no npm workspaces. Each app installs on its own:

```sh
cd apps/baalpeh
npm ci
npm test
npm run build
```

Why: the apps pin different, incompatible toolchains (baalpeh uses Vite 7, Vitest 4 and the Cloudflare
Vitest pool; cheder-flashcards uses Vite 6, Vitest 3 and Playwright). A shared, hoisted `node_modules`
could hand one app the other app's Vite or Vitest. Separate lockfiles keep exactly the dependency trees
each app was already tested with, and a CI job for one app installs only that app's packages.

Root shortcuts (they just loop over `apps/*`): `npm run install:all`, `npm run test:all`,
`npm run build:all`.

## CI and deploy

Each app has its own GitHub Actions workflow in `.github/workflows/`, filtered by path:

- It runs only when something under `apps/<name>/` or the workflow file itself changes.
- Pull requests: install, test, build (baalpeh also type-checks; cheder-flashcards also runs the
  Playwright offline test).
- Pushes to `main`: the same, then deploy with `wrangler deploy` (baalpeh first applies D1 migrations
  with `wrangler d1 migrations apply baalpeh --remote`). Deploy jobs use the GitHub environment
  `production` and the secrets `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID`.
- Each workflow has its own concurrency group, so deploys of different apps don't cancel each other.

One-time setup (token, secrets, environment, custom domains, switching off the old repos' pipelines)
is in [`docs/cloudflare-setup.md`](docs/cloudflare-setup.md).

## Adding an app

Create `apps/<name>/` with its own `package.json` (with `test` and `build` scripts), `package-lock.json`
and `wrangler.jsonc`, then copy `.github/workflows/home.yml` to `.github/workflows/<name>.yml` and
change the paths, working directory and concurrency group.

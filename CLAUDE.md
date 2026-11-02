# torahlearningtools monorepo

Small Torah-learning web apps, each deployed as its own Cloudflare Worker.

- `apps/home` — landing page for torahlearningtools.com (static assets).
- `apps/baalpeh` — Mishnah Ba'al Peh (Vite + React client, Worker API in `worker/`, D1 migrations). See its `README.md` and `docs/`.
- `apps/cheder-flashcards` — kids' Hebrew vocabulary flashcards. Read `apps/cheder-flashcards/CLAUDE.md` before changing it.

Rules:
- No npm workspaces: run `npm ci`, `npm test`, `npm run build` inside the app's folder. Each app has its own `package-lock.json`.
- One GitHub Actions workflow per app in `.github/workflows/<app>.yml`, path-filtered to `apps/<app>/**`; deploys only from `main`.
- Never change a Worker `name`, D1 database name/id, or routes in a `wrangler.jsonc`: deploys must keep updating the existing Workers.
- Deploy setup is documented in `docs/cloudflare-setup.md`.

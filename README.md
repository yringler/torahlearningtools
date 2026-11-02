# Torah Learning Tools

A monorepo of small Torah-learning projects hosted on [torahlearningtools.com](https://torahlearningtools.com).

## Layout

```
apps/
  <name>/      one app per folder, each deployed independently
```

Each app has its own `package.json` and deploy config. The root `package.json` only
ties them together with npm workspaces.

| App | What it is | Deployed as |
| --- | --- | --- |
| [`apps/home`](apps/home) | Landing page for torahlearningtools.com | Cloudflare Worker `torahlearningtools-home` (static assets) |

## Working on an app

```sh
npm install                                   # once, at the repo root
npm run dev -w @torahlearningtools/home       # local dev server (wrangler dev)
npm run deploy -w @torahlearningtools/home    # deploy to Cloudflare
```

## Adding an app

Create `apps/<name>/` with its own `package.json` (name it `@torahlearningtools/<name>`)
and run `npm install` at the root.

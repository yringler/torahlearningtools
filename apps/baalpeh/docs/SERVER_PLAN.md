# Server plan: accounts, sync and a Cloudflare Worker

Status: approved for implementation. Written 2026-11-01.

This document is self-contained. It is handed to three agents: **SERVER**, **CLIENT** and **REVIEW**. Read §0 and §13 before
anything else. Everything marked *verbatim* must be copied exactly.

---

## 0. Summary of decisions

| Topic | Decision |
|---|---|
| Hosting | One Cloudflare Worker (`baalpeh`). Workers Static Assets serves `dist/` (SPA fallback). The Worker runs first only for `/api/*`. |
| Framework | Hono `4.13.13`. No other runtime dependency on the server. |
| Database | D1 database `baalpeh`, binding `DB`. Five SQL migrations in `migrations/`. |
| Accounts | Parent accounts identified by email. Passwordless. The account is created on first successful verification. |
| Login email | One email with a magic link **and** a 6-digit code. Both expire in 15 min. Both consume the same single-use login request. A new request supersedes older ones. |
| Email | Resend HTTP API (`fetch` to `https://api.resend.com/emails`). Behind a tiny `EmailSender` interface. Without `RESEND_API_KEY`, a console logger prints link and code, but only when `APP_ORIGIN` is localhost. |
| Bot protection | Cloudflare Turnstile on `POST /api/auth/request`, verified server-side. |
| Link scanners | The link carries the token in the URL **fragment** (`/auth/verify#token=…`). The landing page needs a tap that POSTs it. A GET never consumes anything. |
| Session | Random 32-byte token in an HttpOnly, Secure, SameSite=Lax cookie (`__Host-bp_session`). D1 stores only its SHA-256. Valid 30 days, sliding (refreshed on use, at most once per 5 min). |
| CSRF | SameSite=Lax, plus an `Origin` check (must equal `APP_ORIGIN`) on every non-GET `/api` request, plus `Content-Type: application/json` required for bodies. |
| Rate limits | Fixed-window counters in a D1 table, keyed by HMAC of IP or email. |
| Parent area | Stays behind the existing 2-second hold gate. **No re-authentication.** The device is the parent's and they handed it over on purpose. Destructive actions keep their confirmations. Account deletion requires typing the email. |
| Sync model | **Local-first, per-row last-write-wins with a server revision cursor, plus an append-only event log.** See §6. |
| Child sign-out | The child's "‹ Switch" button returns to the picker, the account main screen. The real sign-out is in the parent area. |
| Legacy data | v1 `localStorage` profiles can be imported into the account, from the same origin automatically and from a backup file anywhere. |
| Build | Vite `base: "/"`. `build:single` and `vite-plugin-singlefile` are removed. The GitHub Pages workflow is replaced by a Cloudflare deploy workflow. |
| Toolchain | Vite 7.3.7, Vitest 4.1.11, `@cloudflare/vitest-plugin` 1.3.7, Wrangler 4.148.0, TypeScript 5.9.3. React stays on 18.3.1. |

Versions were verified with `npm view` on 2026-11-01. The whole set was installed and smoke-tested together: a worker test
with D1 migrations, `wrangler deploy --dry-run`, the existing client tests and `vite build` all passed.

> **npm caveat:** npm 10.9.x (bundled with Node 22) crashes resolving Vitest 4 (`Cannot read properties of null (reading
> 'edgesOut')`). Use npm 11: `npx -y npm@11.6.2 install` locally. CI installs `npm@11.6.2` globally first.

---

## 1. Architecture

```
Browser (tablet)                                    Cloudflare
┌───────────────────────────────┐   HTTPS   ┌───────────────────────────────────────────┐
│ React SPA                     │──────────▶│ Worker "baalpeh"                          │
│  ├ auth screens               │           │  ├ /api/*  → Hono app (worker/)           │
│  ├ learning UI (unchanged)    │           │  └ else    → Static Assets (dist/),       │
│  ├ AccountStore (localStorage)│           │             SPA fallback to index.html    │
│  └ SyncEngine ── POST /api/sync           │  D1 "baalpeh": users, login_requests,     │
└───────────────────────────────┘           │   sessions, children, progress, events,   │
                                            │   rate_limits                             │
         Resend API ◀── login email ────────│  Cron 03:17 UTC: delete expired rows      │
         Turnstile siteverify ◀─────────────│                                           │
                                            └───────────────────────────────────────────┘
```

The client always reads and writes its local `AccountStore` first, so the learning UI never waits on the network. A
background `SyncEngine` pushes pending rows and events and pulls newer rows through one endpoint.

---

## 2. Repository layout after the change

```
shared/api.ts                 # FIXED contract (verbatim, §5). Imported by worker/ and src/.
migrations/0001_users_auth.sql
migrations/0002_sessions.sql
migrations/0003_children_progress.sql
migrations/0004_events.sql
migrations/0005_rate_limits.sql
worker/
  index.ts                    # Hono app + default export {fetch, scheduled}
  env.ts                      # Env interface + Hono AppEnv type
  tsconfig.json
  vitest.config.ts            # worker test project
  lib/
    crypto.ts                 # randomToken, sha256Hex, hmacHex, randomCode, safeEqual
    http.ts                   # apiError(), readJson(), noStore + security headers middleware
    origin.ts                 # CSRF origin middleware
    rateLimit.ts              # hit(db, name, subject, limit, windowSec)
    turnstile.ts              # verifyTurnstile()
    session.ts                # createSession, requireUser middleware (sliding), clearSession
    validate.ts               # hand-written validators for every request body
    time.ts                   # now() = Date.now() (single seam for tests)
  email/
    sender.ts                 # EmailSender interface + pickSender(env)
    resend.ts                 # ResendSender
    log.ts                    # LogSender + exported devOutbox (tests read it)
    loginEmail.ts             # subject/text/html for the login email
  routes/
    config.ts                 # GET /api/config
    auth.ts                   # request, verify-link, verify-code, logout
    me.ts                     # GET /api/me, DELETE /api/account
    sync.ts                   # POST /api/sync
    children.ts               # GET /api/children/:id/events, /stats
  cron.ts                     # scheduled cleanup
  test/
    env.d.ts  setup.ts  helpers.ts
    auth.test.ts  session.test.ts  sync.test.ts  children.test.ts  account.test.ts  cron.test.ts  email.test.ts
src/                          # client (see §9)
tests/                        # client tests
public/_headers               # static security headers (client)
wrangler.jsonc
vitest.config.ts              # root: two projects (client, worker)
.dev.vars.example
.github/workflows/deploy.yml  # replaces pages.yml
```

---

## 3. Security design

### 3.1 Login request (`POST /api/auth/request`)

1. Origin check (§3.6) and JSON body check.
2. Validate: `email` trimmed, NFC, lowercased, ≤ 254 chars, matches `/^[^\s@]+@[^\s@]+\.[^\s@]+$/`. `turnstileToken`
   is a non-empty string ≤ 2048 chars. Anything else returns `400 bad_request`.
3. Rate limits (§3.5): `req-ip` 10 per hour per IP, then `req-email` 5 per hour per email. Over the limit returns
   `429 rate_limited` with `retryAfterSec`. The limit is the same for every email, so it reveals nothing.
4. Turnstile siteverify (§3.7). Failure returns `400 turnstile_failed`.
5. Supersede: `UPDATE login_requests SET consumed_at = :now WHERE email = :email AND consumed_at IS NULL`.
6. Create the request:
   - `id = crypto.randomUUID()`
   - `token` = 32 bytes from `crypto.getRandomValues`, base64url (43 chars, 256 bits).
     Stored as `token_hash = sha256Hex(token)`. A plain hash is fine at this entropy.
   - `code` = 6 decimal digits, uniform via rejection sampling (below). Stored as
     `code_hash = hmacHex(AUTH_SECRET, "code:" + id + ":" + code)`. The HMAC with a server secret keeps a leaked
     database from being brute-forced over the 10⁶ code space.
   - `expires_at = now + 15 min`, `attempts = 0`, `ip_hash = hmacHex(AUTH_SECRET, "ip:" + ip)`.
7. Send the email (§4) and `await` it. On a provider error return `502 email_failed`. The request row stays and simply
   expires. Every well-formed email address gets an email, so awaiting the send leaks nothing.
8. Respond `200 { ok: true, expiresInSec: 900 }`. This response is identical for new and existing users. Users are
   only created at verification.

```ts
// worker/lib/crypto.ts (essentials)
export function randomCode(): string {
  const buf = new Uint32Array(1);
  for (;;) {
    crypto.getRandomValues(buf);
    const v = buf[0]!;
    if (v < 4_294_000_000) return String(v % 1_000_000).padStart(6, "0"); // 4294 * 10^6: no modulo bias
  }
}
export async function safeEqualHex(a: string, b: string): Promise<boolean> {
  const ea = new TextEncoder().encode(a), eb = new TextEncoder().encode(b);
  return ea.byteLength === eb.byteLength && crypto.subtle.timingSafeEqual(ea, eb);
}
```

### 3.2 Magic link (`POST /api/auth/verify-link`)

- Link format: `${APP_ORIGIN}/auth/verify#token=<token>`. The fragment never reaches the server, logs or the
  `Referer` header. Email scanners that GET the URL only download the SPA shell.
- The landing page (`/auth/verify`, served by the SPA fallback) reads the fragment, immediately runs
  `history.replaceState(null, "", "/auth/verify")`, and shows **"Sign in on this device"**. The token is POSTed
  only when that button is tapped, which also stops scanners that run JavaScript.
- Server: rate limit `link-ip` 20 per 15 min per IP. Then run this single atomic statement:

```sql
UPDATE login_requests SET consumed_at = ?1
WHERE token_hash = ?2 AND consumed_at IS NULL AND expires_at > ?1
RETURNING email;
```

  No row returns `400 invalid_link` (unknown, used, superseded or expired all look the same). Otherwise continue with
  §3.4.
- The link signs in **whichever browser opens it**. That covers "clicked on the phone, wants the phone".

### 3.3 Code (`POST /api/auth/verify-code`)

- The code is for "the link opened on another device". The parent types it on the device that asked for it.
- Validate `email` (same normalization) and `code` (`/^\d{6}$/`; strip spaces first).
- Rate limits: `code-ip` 20 per 15 min per IP and `code-email` 10 per hour per email.
- Load the live request: `SELECT id, code_hash, attempts FROM login_requests WHERE email = ? AND consumed_at IS NULL
  AND expires_at > ? ORDER BY created_at DESC LIMIT 1`. No row returns `400 invalid_code`.
- `attempts >= 5`: mark it consumed and return `400 too_many_attempts`.
- Compare `hmacHex(AUTH_SECRET, "code:"+id+":"+code)` with `code_hash` using `safeEqualHex`.
  - Mismatch: `UPDATE … SET attempts = attempts + 1 … RETURNING attempts`. If the new value is ≥ 5, also set
    `consumed_at` and return `too_many_attempts`. Otherwise return `400 invalid_code` with `attemptsLeft = 5 - attempts`.
  - Match: `UPDATE login_requests SET consumed_at = ?now WHERE id = ? AND consumed_at IS NULL RETURNING email`. This
    guards the race. No row returns `invalid_code`.
- Guessing odds: 5 tries per request and 5 requests per hour per email give at most 25 guesses an hour against 10⁶
  codes, i.e. 2.5·10⁻⁵ per hour, and Turnstile and the IP limits on top. Acceptable for this app.

### 3.4 Finishing a login (shared by link and code)

```sql
INSERT INTO users (id, email, created_at, last_login_at, rev) VALUES (?1, ?2, ?3, ?3, 0)
ON CONFLICT(email) DO UPDATE SET last_login_at = excluded.last_login_at
RETURNING id, email, created_at;
```

`newUser = created_at === now`. Then call `createSession` (§3.8) and return `200 AuthSuccessResponse` with `Set-Cookie`.

### 3.5 Rate limiting (D1)

```ts
// worker/lib/rateLimit.ts
export async function hit(env: Env, name: string, subject: string, limit: number, windowSec: number, now: number)
  : Promise<{ ok: true } | { ok: false; retryAfterSec: number }> {
  const windowMs = windowSec * 1000;
  const windowStart = Math.floor(now / windowMs) * windowMs;
  const key = `${name}:${(await hmacHex(env.AUTH_SECRET, "rl:" + subject)).slice(0, 32)}`;
  const row = await env.DB.prepare(
    `INSERT INTO rate_limits (key, window_start, count) VALUES (?1, ?2, 1)
     ON CONFLICT(key) DO UPDATE SET
       count = CASE WHEN rate_limits.window_start = excluded.window_start THEN rate_limits.count + 1 ELSE 1 END,
       window_start = excluded.window_start
     RETURNING count`).bind(key, windowStart).first<{ count: number }>();
  if ((row?.count ?? 0) <= limit) return { ok: true };
  return { ok: false, retryAfterSec: Math.ceil((windowStart + windowMs - now) / 1000) };
}
```

The IP comes from `CF-Connecting-IP` (fallback `"unknown"`). Raw IPs and emails are never stored in `rate_limits`.

| name | subject | limit | window |
|---|---|---|---|
| `req-ip` | IP | 10 | 3600 s |
| `req-email` | email | 5 | 3600 s |
| `link-ip` | IP | 20 | 900 s |
| `code-ip` | IP | 20 | 900 s |
| `code-email` | email | 10 | 3600 s |

### 3.6 CSRF and request hygiene (`worker/lib/origin.ts`, `worker/lib/http.ts`)

- For every `/api/*` request whose method is not GET, HEAD or OPTIONS:
  - The `Origin` header must equal `env.APP_ORIGIN` exactly. If `Origin` is absent, accept only
    `Sec-Fetch-Site: same-origin`. Otherwise return `403 forbidden`.
  - If the method carries a body (POST, DELETE with body), `Content-Type` must start with `application/json`, else
    `400 bad_request`. A cross-site HTML form cannot send JSON.
  - The body may be at most 1,000,000 bytes (check `Content-Length` and the read text length), else `413`.
- Every `/api` response sets `Cache-Control: no-store`, `X-Content-Type-Options: nosniff` and
  `Referrer-Policy: no-referrer`.
- No CORS headers at all. The API is same-origin only.
- The session cookie is `SameSite=Lax`, so it is not sent on cross-site POSTs.

### 3.7 Turnstile

```ts
// worker/lib/turnstile.ts
export async function verifyTurnstile(env: Env, token: string, ip: string): Promise<boolean> {
  const form = new FormData();
  form.append("secret", env.TURNSTILE_SECRET_KEY);
  form.append("response", token);
  if (ip !== "unknown") form.append("remoteip", ip);
  const r = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body: form });
  if (!r.ok) return false;
  const j = await r.json<{ success?: boolean }>();
  return j.success === true;
}
```

Dev and test keys (documented by Cloudflare):

| Purpose | Site key | Secret key |
|---|---|---|
| Always passes (use for dev) | `1x00000000000000000000AA` | `1x0000000000000000000000000000000AA` |
| Always fails | `2x00000000000000000000AB` | `2x0000000000000000000000000000000AA` |
| Forces an interactive challenge | `3x00000000000000000000FF` | — |
| Token already spent | — | `3x0000000000000000000000000000000AA` |

### 3.8 Sessions (`worker/lib/session.ts`)

- `createSession(c, userId)`: token = 32 random bytes base64url. Insert
  `sessions(token_hash = sha256Hex(token), user_id, created_at = now, last_seen_at = now, expires_at = now + 30 d,
  user_agent = first 200 chars of User-Agent)`. Set the cookie.
- Cookie:
  - Name: `__Host-bp_session` when `APP_ORIGIN` starts with `https://`, otherwise `bp_session` (local http dev).
  - Attributes: `HttpOnly; Path=/; SameSite=Lax; Max-Age=2592000`, plus `Secure` for https. No `Domain`.
  - Use `setCookie`/`getCookie`/`deleteCookie` from `hono/cookie`.
- `requireUser` middleware:
  1. Read the cookie. If it is missing, return `401 unauthorized`.
  2. `SELECT s.user_id, s.expires_at, s.last_seen_at, u.email, u.created_at FROM sessions s JOIN users u ON u.id =
     s.user_id WHERE s.token_hash = ?`.
  3. If there is no row, or `expires_at <= now`: delete the row if present, clear the cookie, return `401`.
  4. **Sliding window:** if `now - last_seen_at >= 5 min`, run `UPDATE sessions SET last_seen_at = now, expires_at =
     now + 30 d WHERE token_hash = ?` and re-set the cookie with a fresh `Max-Age`. Throttling to once per 5 minutes
     keeps D1 writes low, so the effective expiry is "30 days after the last use", give or take 5 minutes.
  5. Set `c.var.user: User` and `c.var.sessionHash`.
- `POST /api/auth/logout`: delete the row (if the cookie is valid) and clear the cookie. Always return `204`.
- `DELETE /api/account`: delete all sessions of the user (§7).

### 3.9 Other notes

- `AUTH_SECRET` is a Worker secret of at least 32 random bytes. It keys the code HMAC, the rate-limit keys and the IP
  hashes. Rotating it invalidates live codes, nothing else.
- Never log tokens, codes, cookies or email bodies. The only exception is the localhost log sender.
- The login email says "only the newest email works" (because of supersede).
- `public/_headers` (static assets) sets `Referrer-Policy: no-referrer`, `X-Content-Type-Options: nosniff` and
  `X-Frame-Options: DENY` on `/*`. A CSP is later work because Google Fonts and Turnstile need careful allow-listing.

---

## 4. Email

The owner chose **Resend**.

```ts
// worker/email/sender.ts
export interface EmailMessage { to: string; subject: string; text: string; html: string; idempotencyKey: string }
export interface EmailSender { readonly kind: "resend" | "log"; send(msg: EmailMessage): Promise<void> } // throws on failure

export function isLocalOrigin(origin: string): boolean {
  return /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
}

export function pickSender(env: Env): EmailSender {
  if (env.RESEND_API_KEY) return new ResendSender(env.RESEND_API_KEY, env.EMAIL_FROM);
  return new LogSender(isLocalOrigin(env.APP_ORIGIN)); // printSecrets only on localhost
}
```

- `ResendSender.send`: `fetch("https://api.resend.com/emails", { method: "POST", headers: { Authorization:
  "Bearer " + key, "Content-Type": "application/json", "Idempotency-Key": msg.idempotencyKey }, body:
  JSON.stringify({ from, to: [msg.to], subject, text, html }) })`. On a non-2xx response, throw
  `Error("resend " + status)` and log the status and response body, but not the email content.
  `idempotencyKey = "login-" + requestId`.
- `LogSender(printSecrets)`: pushes the message onto an exported `devOutbox: EmailMessage[]` (tests read it; cap at
  50 entries). If `printSecrets`, it prints `[dev email] to=… subject=…` plus the text body via `console.log`.
  Otherwise it logs `console.error("RESEND_API_KEY is not set; login email NOT sent")` and **throws**, so a
  misconfigured production returns `502 email_failed` instead of silently succeeding.
- `GET /api/config` returns `devEmail: sender.kind === "log" && isLocalOrigin(APP_ORIGIN)`. The client then shows
  "Dev mode: the link and code are in the wrangler console".

Login email (`worker/email/loginEmail.ts`):

- Subject: `${code} is your Mishnah Ba'al Peh sign-in code`
- Text:
  ```
  Sign in to Mishnah Ba'al Peh

  Tap this link to sign in on the device where you open it:
  ${link}

  Or type this code in the app:  ${code.slice(0,3)} ${code.slice(3)}

  The link and code work once and expire in 15 minutes. Only the newest email works.
  If you didn't ask to sign in, you can ignore this email.
  ```
- HTML: the same content, with a large button for the link and the code in a 28px monospace box. Inline styles only,
  no images, `dir="ltr"`, and a heading of `משנה בעל פה` plus "Mishnah Ba'al Peh". HTML-escape everything
  interpolated.

---

## 5. `shared/api.ts` (verbatim, fixed)

Whichever agent needs it first creates this file with exactly this content. After that, **nobody edits it**. If a
change seems necessary, stop and report it to the coordinator.

```ts
/**
 * shared/api.ts — the HTTP contract between the Worker (worker/) and the SPA (src/).
 * FIXED FILE: both sides import it; neither implementation agent may edit it.
 * Environment-neutral: no DOM or Workers types, no runtime imports.
 */

/** Epoch milliseconds. */
export type Ms = number;
/** Local calendar date, "yyyy-mm-dd". */
export type IsoDate = string;

// ───────────────────────── Errors ─────────────────────────

export type ErrorCode =
  | "bad_request" // 400 malformed body / failed validation
  | "unauthorized" // 401 no or expired session
  | "forbidden" // 403 Origin check failed, or resource belongs to another account
  | "not_found" // 404
  | "payload_too_large" // 413
  | "rate_limited" // 429 (retryAfterSec set)
  | "turnstile_failed" // 400 Turnstile token missing/invalid
  | "invalid_link" // 400 magic link unknown, used, or expired
  | "invalid_code" // 400 code wrong, or no live request for this email
  | "too_many_attempts" // 400 code locked after MAX_CODE_ATTEMPTS
  | "email_failed" // 502 email provider rejected the send
  | "server_error"; // 500

/** Body of every non-2xx JSON response. */
export interface ApiError {
  error: ErrorCode;
  message: string;
  /** Present on rate_limited. */
  retryAfterSec?: number;
  /** Present on invalid_code while the request is still live. */
  attemptsLeft?: number;
}

// ───────────────────────── Constants ─────────────────────────

export const AUTH = {
  CODE_LENGTH: 6,
  LOGIN_TTL_SEC: 15 * 60,
  MAX_CODE_ATTEMPTS: 5,
  SESSION_TTL_SEC: 30 * 24 * 60 * 60,
} as const;

export const SYNC_LIMITS = {
  /** Max children + records in one SyncRequest. */
  MAX_ROWS: 500,
  /** Max events in one SyncRequest. */
  MAX_EVENTS: 500,
  /** Max JSON size of one ChildMeta / record data / event, in bytes (UTF-8). */
  MAX_ITEM_BYTES: 4096,
  /** Max children per account (tombstones excluded). */
  MAX_CHILDREN: 50,
} as const;

// ───────────────────────── Config ─────────────────────────

/** GET /api/config — public, no auth. */
export interface ConfigResponse {
  turnstileSiteKey: string;
  /** True when no email provider is configured: the link and code are printed in the Worker log. */
  devEmail: boolean;
}

// ───────────────────────── Auth ─────────────────────────

export interface User {
  id: string;
  email: string;
  createdAt: Ms;
}

/** POST /api/auth/request — always 200 for a well-formed request (no account enumeration). */
export interface AuthRequestBody {
  email: string;
  turnstileToken: string;
}
export interface AuthRequestResponse {
  ok: true;
  expiresInSec: number;
}

/** POST /api/auth/verify-link — token comes from the link's URL fragment. Sets the session cookie. */
export interface VerifyLinkBody {
  token: string;
}

/** POST /api/auth/verify-code — sets the session cookie. */
export interface VerifyCodeBody {
  email: string;
  code: string;
}

/** 200 response of verify-link and verify-code. */
export interface AuthSuccessResponse {
  user: User;
  /** True when this login created the account. */
  newUser: boolean;
}

/** GET /api/me */
export interface MeResponse {
  user: User;
}

// POST /api/auth/logout → 204, clears cookie. No body.

/** DELETE /api/account — body must repeat the account email. 204, clears cookie. */
export interface DeleteAccountBody {
  email: string;
}

// ───────────────────────── Progress data (mirrors src/types.ts) ─────────────────────────

export type Grade = "pass" | "help" | "notyet";
export type MishnahState = "new" | "learning" | "known" | "solid";
export type MeaningView = "simple" | "steinsaltz";

export interface ReviewItemData {
  box: number;
  due: IsoDate;
  passes: number;
}

export interface MishnahProgressData {
  stepIndex: number;
  state: MishnahState;
  review?: ReviewItemData;
  fails: Record<string, number>;
}

export interface PerekProgressData {
  chainedThrough: number;
  complete: boolean;
  review?: ReviewItemData;
}

export interface ChildSettings {
  fontScale: number;
  tts: boolean;
  dailyMinutes: number;
  meaningView?: MeaningView;
}

export interface ChildMeta {
  name: string;
  color: string;
  emoji: string;
  settings: ChildSettings;
  /** Position in the picker (0-based). */
  sort: number;
}

// ───────────────────────── Sync rows ─────────────────────────

/** One child. `id` is client-generated (crypto.randomUUID()). Deletion is a tombstone and is final. */
export interface ChildRow {
  id: string;
  /** Client clock when this value was produced; server clamps to its own clock. Last write wins. */
  updatedAt: Ms;
  deleted: boolean;
  meta: ChildMeta;
}

interface RecordBase {
  childId: string;
  updatedAt: Ms;
}
/** key "perek:mishnah", e.g. "1:3". */
export interface MishnahRecord extends RecordBase {
  kind: "m";
  key: string;
  data: MishnahProgressData;
}
/** key "perek", e.g. "1". */
export interface PerekRecord extends RecordBase {
  kind: "p";
  key: string;
  data: PerekProgressData;
}
/** key IsoDate: a day with any learning. Insert-only. */
export interface DayRecord extends RecordBase {
  kind: "d";
  key: IsoDate;
  data: Record<string, never>;
}
export type RecordRow = MishnahRecord | PerekRecord | DayRecord;
export type RecordKind = RecordRow["kind"];

// ───────────────────────── Events (append-only practice log) ─────────────────────────

export type ReciteTask = "learn" | "chain" | "detour" | "review-m" | "perek-chain" | "review-p";

export interface ReciteEvent {
  type: "recite";
  task: ReciteTask;
  perek: number;
  /** null for perek-level tasks. */
  mishnah: number | null;
  /** Step index within the mishnah for learn/chain/detour; null otherwise. */
  step: number | null;
  grade: Grade;
  /** Total peeks during this recitation. */
  peeks: number;
  /** Time spent on this recitation. */
  ms: number;
}

export interface CheckEvent {
  type: "check";
  scope: "mishnah" | "chain" | "review-p";
  perek: number;
  /** Set for scope "mishnah". */
  mishnah: number | null;
  /** Set for scope "chain" (mishnayos 1..through). */
  through: number | null;
  grade: Grade;
  /** Slipped units: chunk indices (scope mishnah) or mishnah numbers (chain / review-p). */
  slipped: number[];
  /** Number of words the parent tapped. */
  slipWords: number;
}

export interface SessionEvent {
  type: "session";
  startedAt: Ms;
  /** Duration, capped at 3 h by the client. */
  ms: number;
  steps: number;
}

export interface ResetEvent {
  type: "reset";
  perek: number;
  mishnah: number;
}

export type LearningEventBody = ReciteEvent | CheckEvent | SessionEvent | ResetEvent;

export interface EventEnvelope {
  /** Client-generated UUID; the server ignores duplicates. */
  id: string;
  childId: string;
  at: Ms;
  /** Child's local date at `at`. */
  day: IsoDate;
}

export type LearningEvent = EventEnvelope & LearningEventBody;

// ───────────────────────── Sync ─────────────────────────

/**
 * POST /api/sync — push local changes and pull everything newer than `cursor`, in one call.
 * Server applies children, then records, then events, atomically.
 */
export interface SyncRequest {
  /** Last `cursor` received from the server; 0 on a fresh device. */
  cursor: number;
  children: ChildRow[];
  records: RecordRow[];
  events: LearningEvent[];
}

/**
 * Contains (a) every row whose server revision is > request.cursor, including tombstoned children,
 * and (b) the current server version of every row pushed in this request (so a push that lost
 * last-write-wins is corrected). Rows of deleted children are never returned.
 */
export interface SyncResponse {
  cursor: number;
  children: ChildRow[];
  records: RecordRow[];
  serverTime: Ms;
}

// ───────────────────────── Parent views ─────────────────────────

/** GET /api/children/:id/events?before=<Ms>&limit=<1..100, default 50> — newest first. */
export interface EventsResponse {
  events: LearningEvent[];
  /** Pass as `before` to get the next page; null when there are no more. */
  nextBefore: Ms | null;
}

/** One row per (perek, mishnah) with recite/check events in the window; mishnah null = perek-level. */
export interface StruggleRow {
  perek: number;
  mishnah: number | null;
  attempts: number;
  pass: number;
  help: number;
  notyet: number;
  peeks: number;
  slips: number;
  lastAt: Ms;
  /** notyet*3 + help + peeks*0.5 + slips. Higher = harder. */
  struggle: number;
}

export interface DayActivity {
  day: IsoDate;
  /** Sum of session durations, rounded to whole minutes. */
  minutes: number;
  recites: number;
}

/** GET /api/children/:id/stats?days=<1..365, default 30> */
export interface ChildStatsResponse {
  childId: string;
  since: Ms;
  /** Sorted by struggle, descending. */
  items: StruggleRow[];
  /** Ascending by day; days without events are omitted. */
  days: DayActivity[];
}
```

This file compiles under both the worker tsconfig (no DOM) and the client tsconfig. `MishnahProgressData`,
`PerekProgressData` and `ChildSettings` are structurally identical to `MishnahProgress`, `PerekProgress` and `Settings`
in `src/types.ts`. The CLIENT agent adds a compile-time assertion for this (§9.1).

---

## 6. Sync model

### 6.1 Choice and justification

**Per-row last-write-wins (LWW) with a server revision cursor, plus an append-only event log.** The rejected
alternative is one JSON document per child with a version number and optimistic concurrency.

- The natural unit of change is small: one mishnah's progress, one perek's progress, a day, or a child's settings. Two
  devices editing the same child usually touch *different* mishnayos, and per-row LWW merges that automatically. A
  per-child document would reject the whole push with a 409 and still need a per-key merge on the client.
- Pushes are tiny and idempotent, so a flaky tablet connection can retry blindly.
- LWW can lose an edit only when two devices changed the *same* mishnah while offline. In that case the later edit
  wins, which matches what the parent saw most recently. The event log keeps the full history anyway.
- Clock skew: the server clamps `updatedAt` to `min(clientUpdatedAt, serverNow)`, so a tablet with a clock set in the
  future cannot win forever.

### 6.2 Server rows

- `children(id, user_id, data=ChildMeta JSON, deleted, updated_at, rev)`. Deletion is a tombstone and is **final**.
  The upsert never resurrects a deleted child.
- `progress(child_id, user_id, kind ∈ {m,p,d}, key, data JSON, updated_at, rev)`, primary key
  `(child_id, kind, key)`.
- `users.rev` is a per-account monotonically increasing counter. Each sync that writes increments it once, and every
  row written in that sync gets that `rev`. Pulls return rows with `rev > cursor`.

### 6.3 `POST /api/sync` algorithm (one `db.batch`, so atomic and one query for the per-invocation limit)

Pre-checks, outside the batch:

1. Validate the body (§7.3 limits). Clamp each `updatedAt` to `min(updatedAt, now)`. Reject `updatedAt <= 0`.
2. Ownership: `SELECT id FROM children WHERE id IN (SELECT value FROM json_each(?1)) AND user_id != ?2`, with the
   pushed child ids plus the `childId`s of records and events. Any hit returns `403 forbidden`.
3. Child cap: if the number of live children after the push would exceed 50, return `400 bad_request`.

Batch statements, in order (`?U` = user id, `?C` = request cursor):

```sql
-- only if anything is pushed (children, records or events non-empty):
UPDATE users SET rev = rev + 1 WHERE id = ?U;

-- per child row:
INSERT INTO children (id, user_id, data, deleted, updated_at, rev, created_at)
VALUES (?1, ?U, ?2, ?3, ?4, (SELECT rev FROM users WHERE id = ?U), ?now)
ON CONFLICT(id) DO UPDATE SET
  data = excluded.data, deleted = excluded.deleted, updated_at = excluded.updated_at, rev = excluded.rev
WHERE children.user_id = excluded.user_id
  AND children.deleted = 0
  AND excluded.updated_at > children.updated_at;

-- per record row:
INSERT INTO progress (child_id, user_id, kind, key, data, updated_at, rev)
SELECT ?1, ?U, ?2, ?3, ?4, ?5, u.rev FROM users u
WHERE u.id = ?U
  AND EXISTS (SELECT 1 FROM children c WHERE c.id = ?1 AND c.user_id = ?U AND c.deleted = 0)
ON CONFLICT(child_id, kind, key) DO UPDATE SET
  data = excluded.data, updated_at = excluded.updated_at, rev = excluded.rev
WHERE excluded.updated_at > progress.updated_at;

-- per event:
INSERT OR IGNORE INTO events
  (id, user_id, child_id, at, day, type, task, perek, mishnah, grade, peeks, slips, ms, data, received_at)
SELECT ?1, ?U, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?now
WHERE EXISTS (SELECT 1 FROM children c WHERE c.id = ?2 AND c.user_id = ?U AND c.deleted = 0);

-- purge data of tombstoned children (cheap; usually no rows):
DELETE FROM progress WHERE user_id = ?U AND child_id IN (SELECT id FROM children WHERE user_id = ?U AND deleted = 1);
DELETE FROM events   WHERE user_id = ?U AND child_id IN (SELECT id FROM children WHERE user_id = ?U AND deleted = 1);

-- reads (results come back from the same batch):
SELECT rev FROM users WHERE id = ?U;                                                          -- new cursor
SELECT id, data, deleted, updated_at FROM children WHERE user_id = ?U AND rev > ?C;
SELECT child_id, kind, key, data, updated_at FROM progress WHERE user_id = ?U AND rev > ?C;
SELECT id, data, deleted, updated_at FROM children
  WHERE user_id = ?U AND id IN (SELECT value FROM json_each(?pushedChildIds));
SELECT child_id, kind, key, data, updated_at FROM progress
  WHERE user_id = ?U AND (child_id || '|' || kind || '|' || key) IN (SELECT value FROM json_each(?pushedRecordKeys));
```

Event columns: `task`, `perek`, `mishnah`, `grade`, `peeks`, `ms` come from the event when present and are NULL
otherwise. `slips` is `slipped.length` for check events. For session events, `ms` is the session duration. `data` is
the full event JSON. Every statement stays below D1's 100 bound parameters.

Response: `cursor` from the rev read. `children` and `records` are the union of the "rev > cursor" reads and the
pushed-key reads, de-duplicated by key. Tombstoned children are returned with `deleted: true`. `serverTime = now`.

Pull size is unbounded in the MVP: about 60 rows per child for Berakhot. Paging is later work (§14).

### 6.4 Client algorithm

Local state per account (`AccountStore`, §9.2) holds `profiles`, `cursor`, and `pending`. `pending` contains
`children: Record<childId, ChildRow>`, `records: Record<"childId|kind|key", RecordRow>` and `events: LearningEvent[]`.

**Local edit:** `next = applyLocalEdit(store, nextProfiles, now)`

1. Compute `diffProfiles(store.profiles, nextProfiles, now)`:
   - A child is new, or its meta changed (`name`, `color`, `emoji`, `settings`, or `sort` = array index): emit a
     `ChildRow`.
   - A child was removed: emit a `ChildRow` with `deleted: true` and its last meta.
   - A `mishnayos[key]` or `perakim[key]` value differs by `JSON.stringify`: emit an `m` or `p` record.
   - A date in `days` is not in the previous `days`: emit a `d` record with `data: {}`.
   - Removed map keys and removed days produce nothing.
2. Put each row into `pending`, overwriting by key (coalescing: only the latest value per key is sent).
3. Set `profiles = nextProfiles` and persist synchronously to localStorage.

**Sync round:** `SyncEngine.syncNow()`. Single-flight: if a round is running, mark "again" and return its promise.

1. Take up to `MAX_ROWS` rows (children first, then records) and up to `MAX_EVENTS` events from `pending`. Remember
   exactly what was sent (`sent`).
2. `POST /api/sync { cursor, children, records, events }`.
3. On 200: `store = applyServerResponse(store, sent, response)`:
   a. For each sent child or record, remove its `pending` entry **only if** the entry's `updatedAt` still equals the
      sent one. Edits made during the request stay pending. Remove the sent events by id.
   b. For each returned `ChildRow`, skip it if `pending.children[id]` exists. If `deleted`, remove the profile.
      Otherwise update the profile's meta or create a blank profile (`mishnayos: {}`, `perakim: {}`, `days: []`).
      Reorder profiles by `meta.sort`, keeping ties stable.
   c. For each returned `RecordRow`, skip it if `pending.records[key]` exists or the profile is missing. `m` and `p`
      set the map entry. `d` adds the day to `days` (union, sorted, `slice(-60)`).
   d. `cursor = response.cursor`, `lastSyncAt = now`. Persist.
   e. If `pending` is still non-empty, loop.
4. Errors:
   - `401`: status `signedOut`. Keep everything and stop the timers.
   - Network error or 5xx: status `offline`/`error`. Retry with backoff of 5 s, 15 s, 60 s, then 5 min (cap).
   - `413` or `400`: log it. Drop the offending batch from `pending` (it can never succeed) and surface `error`.
   - `403`: same as 400.
5. Triggers: app start (after `/api/me` succeeds), 2 s after any local edit (debounced), `window` `online` event,
   `visibilitychange` to visible, a 60 s interval while visible, the parent's "Sync now" button, and before sign-out.

Server results are applied **without** going through `diffProfiles`, so they never create new pending rows.

---

## 7. API specification

All routes are under `/api`. Non-2xx responses have an `ApiError` body. "Auth" means `requireUser` (401 if missing).
"Origin" means the §3.6 check applies.

| Method & path | Auth | Origin | Request | 200 response | Errors |
|---|---|---|---|---|---|
| `GET /api/config` | – | – | – | `ConfigResponse` | 500 |
| `POST /api/auth/request` | – | ✓ | `AuthRequestBody` | `AuthRequestResponse` | 400 bad_request, 400 turnstile_failed, 403, 413, 429 rate_limited, 502 email_failed |
| `POST /api/auth/verify-link` | – | ✓ | `VerifyLinkBody` | `AuthSuccessResponse` + Set-Cookie | 400 bad_request, 400 invalid_link, 403, 429 |
| `POST /api/auth/verify-code` | – | ✓ | `VerifyCodeBody` | `AuthSuccessResponse` + Set-Cookie | 400 bad_request, 400 invalid_code (`attemptsLeft`), 400 too_many_attempts, 403, 429 |
| `POST /api/auth/logout` | optional | ✓ | – (empty or `{}`) | **204** + cookie cleared | 403 |
| `GET /api/me` | ✓ | – | – | `MeResponse` (may refresh the cookie) | 401 |
| `DELETE /api/account` | ✓ | ✓ | `DeleteAccountBody` | **204** + cookie cleared | 400 bad_request (email mismatch), 401, 403 |
| `POST /api/sync` | ✓ | ✓ | `SyncRequest` | `SyncResponse` | 400 bad_request, 401, 403 forbidden, 413 payload_too_large |
| `GET /api/children/:id/events` | ✓ | – | query `before?`, `limit?` | `EventsResponse` | 400, 401, 404 (missing, deleted or not yours) |
| `GET /api/children/:id/stats` | ✓ | – | query `days?` | `ChildStatsResponse` | 400, 401, 404 |
| any other `/api/*` | – | – | – | – | 404 not_found |

### 7.1 Details

- `logout` accepts a missing or invalid session silently (it is idempotent).
- `DELETE /api/account`: the email must match the user's email (normalized). Then run one batch that deletes events,
  progress, children, sessions and login_requests (by email) for the user, then users. The deletes are explicit and
  do not rely on cascades. Clear the cookie.
- `GET /api/children/:id/events`: `before` defaults to `now + 1`, `limit` is 1..100 (default 50).
  `SELECT data, at FROM events WHERE child_id = ? AND user_id = ? AND at < ? ORDER BY at DESC, id DESC LIMIT ?+1`.
  If `limit+1` rows come back, `nextBefore = at` of the last returned event. Ties at the same ms can be skipped across
  pages, which is acceptable. `events` are the parsed `data` values.
- `GET /api/children/:id/stats`: `since = now - days*86400000`.

```sql
SELECT perek, mishnah, count(*) AS attempts,
  sum(grade = 'pass') AS pass, sum(grade = 'help') AS help, sum(grade = 'notyet') AS notyet,
  sum(coalesce(peeks, 0)) AS peeks, sum(coalesce(slips, 0)) AS slips, max(at) AS last_at
FROM events
WHERE child_id = ?1 AND user_id = ?2 AND at >= ?3 AND type IN ('recite', 'check') AND perek IS NOT NULL
GROUP BY perek, mishnah;

SELECT day, sum(CASE WHEN type = 'session' THEN coalesce(ms, 0) ELSE 0 END) AS ms, sum(type = 'recite') AS recites
FROM events WHERE child_id = ?1 AND user_id = ?2 AND at >= ?3
GROUP BY day ORDER BY day;
```

  `struggle = notyet*3 + help + peeks*0.5 + slips`. Sort by it descending. `minutes = round(ms / 60000)`.

### 7.2 Hono wiring (`worker/index.ts`)

```ts
import { Hono } from "hono";
import type { AppEnv, Env } from "./env";
// ...route modules

const app = new Hono<AppEnv>();
app.use("/api/*", securityHeaders, originCheck);  // lib/http.ts, lib/origin.ts
app.route("/api", configRoutes);                  // GET /config
app.route("/api/auth", authRoutes);               // request, verify-link, verify-code, logout
app.route("/api", meRoutes);                      // GET /me, DELETE /account (requireUser inside)
app.route("/api", syncRoutes);                    // POST /sync
app.route("/api/children", childrenRoutes);       // GET /:id/events, /:id/stats
app.all("/api/*", (c) => apiError(c, 404, "not_found", "No such endpoint"));
app.all("*", (c) => c.env.ASSETS.fetch(c.req.raw)); // only reached if run_worker_first matched; defensive
app.onError((err, c) => { console.error(err); return apiError(c, 500, "server_error", "Something went wrong"); });

export { app };
export default {
  fetch: app.fetch,
  scheduled: (_ctl, env, ctx) => ctx.waitUntil(cleanup(env, Date.now())),
} satisfies ExportedHandler<Env>;
```

```ts
// worker/env.ts
export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  APP_ORIGIN: string;           // var, e.g. "https://mishnah.example.com" (no trailing slash)
  EMAIL_FROM: string;           // var, e.g. "Mishnah Ba'al Peh <login@example.com>"
  TURNSTILE_SITE_KEY: string;   // var (public)
  TURNSTILE_SECRET_KEY: string; // secret
  AUTH_SECRET: string;          // secret, >= 32 random bytes
  RESEND_API_KEY?: string;      // secret; unset => LogSender
}
export type AppEnv = { Bindings: Env; Variables: { user: import("../shared/api").User; sessionHash: string } };
```

`cleanup(env, now)` (in `worker/cron.ts`) runs one batch:
`DELETE FROM login_requests WHERE expires_at < now - 86400000`, `DELETE FROM sessions WHERE expires_at < now`, and
`DELETE FROM rate_limits WHERE window_start < now - 86400000`.

### 7.3 Validation (`worker/lib/validate.ts`, hand-written, no zod)

Each validator returns `{ ok: true, value } | { ok: false, message }`. Rules:

- ids (child, event): `/^[A-Za-z0-9_-]{8,64}$/`. Client UUIDs pass.
- `updatedAt`, `at`, `startedAt`: integers in `(0, 1e13)`. `ms`: integer 0..10_800_000. `peeks`, `steps`,
  `slipWords`: integer 0..10_000. `perek`, `mishnah`, `through`, `step`: integer 0..999 (or null where typed).
- `IsoDate`: `/^\d{4}-\d{2}-\d{2}$/`.
- `ChildMeta`: name trimmed 1..40 chars; color `/^#[0-9a-fA-F]{6}$/`; emoji 1..16 chars; settings `fontScale` 0.5..3,
  `dailyMinutes` 1..180 (integer), `tts` boolean, `meaningView` absent or one of the enum; `sort` integer 0..999.
- `m` record: key `/^\d{1,3}:\d{1,3}$/`; data `stepIndex` integer 0..10_000, `state` enum, `fails` an object of at
  most 200 integer values, `review` absent or `{box 0..20 integer, due IsoDate, passes integer ≥ 0}`.
- `p` record: key `/^\d{1,3}$/`; `chainedThrough` integer 0..999, `complete` boolean, `review` as above.
- `d` record: key IsoDate; data must be `{}`.
- Events: `type`-specific fields as in `shared/api.ts`; `grade` enum; `task` and `scope` enums; `slipped` an array of
  at most 200 integers.
- Each item, `JSON.stringify`'d, is ≤ `MAX_ITEM_BYTES`. `children.length + records.length ≤ MAX_ROWS` and
  `events.length ≤ MAX_EVENTS`, else `413 payload_too_large`.
- Unknown extra properties are dropped (the server re-serializes validated values, never the raw input).

---

## 8. D1 schema (full migration files)

The SERVER agent creates these files verbatim. D1 enforces foreign keys. Timestamps are epoch ms integers.

**`migrations/0001_users_auth.sql`**

```sql
-- Parent accounts and passwordless login requests.
CREATE TABLE users (
  id            TEXT PRIMARY KEY,               -- crypto.randomUUID()
  email         TEXT NOT NULL UNIQUE,           -- trimmed, NFC, lowercased
  created_at    INTEGER NOT NULL,
  last_login_at INTEGER,
  rev           INTEGER NOT NULL DEFAULT 0      -- per-account sync revision counter
);

CREATE TABLE login_requests (
  id          TEXT PRIMARY KEY,                 -- crypto.randomUUID()
  email       TEXT NOT NULL,                    -- normalized; user may not exist yet
  token_hash  TEXT NOT NULL UNIQUE,             -- sha256 hex of the magic-link token
  code_hash   TEXT NOT NULL,                    -- HMAC(AUTH_SECRET, "code:"+id+":"+code) hex
  created_at  INTEGER NOT NULL,
  expires_at  INTEGER NOT NULL,                 -- created_at + 15 min
  consumed_at INTEGER,                          -- set on success, supersede, or lockout
  attempts    INTEGER NOT NULL DEFAULT 0,       -- wrong code attempts
  ip_hash     TEXT
);
CREATE INDEX login_requests_email_created ON login_requests (email, created_at);
CREATE INDEX login_requests_expires ON login_requests (expires_at);
```

**`migrations/0002_sessions.sql`**

```sql
CREATE TABLE sessions (
  token_hash   TEXT PRIMARY KEY,                -- sha256 hex of the cookie token; the token itself is never stored
  user_id      TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at   INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  expires_at   INTEGER NOT NULL,                -- sliding: last use + 30 days
  user_agent   TEXT
);
CREATE INDEX sessions_user ON sessions (user_id);
CREATE INDEX sessions_expires ON sessions (expires_at);
```

**`migrations/0003_children_progress.sql`**

```sql
CREATE TABLE children (
  id         TEXT PRIMARY KEY,                  -- client-generated UUID
  user_id    TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  data       TEXT NOT NULL,                     -- ChildMeta JSON
  deleted    INTEGER NOT NULL DEFAULT 0 CHECK (deleted IN (0, 1)),
  updated_at INTEGER NOT NULL,                  -- LWW clock (client ms, clamped to server now)
  rev        INTEGER NOT NULL,                  -- users.rev at last write
  created_at INTEGER NOT NULL
);
CREATE INDEX children_user_rev ON children (user_id, rev);

CREATE TABLE progress (
  child_id   TEXT NOT NULL REFERENCES children (id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL,                     -- denormalized owner for pull queries
  kind       TEXT NOT NULL CHECK (kind IN ('m', 'p', 'd')),
  key        TEXT NOT NULL,                     -- "p:m" | "p" | "yyyy-mm-dd"
  data       TEXT NOT NULL,                     -- JSON (MishnahProgressData | PerekProgressData | {})
  updated_at INTEGER NOT NULL,
  rev        INTEGER NOT NULL,
  PRIMARY KEY (child_id, kind, key)
);
CREATE INDEX progress_user_rev ON progress (user_id, rev);
```

**`migrations/0004_events.sql`**

```sql
-- Append-only practice log. Denormalized columns support parent stats; `data` holds the full event JSON.
CREATE TABLE events (
  id          TEXT PRIMARY KEY,                 -- client UUID (idempotent inserts)
  user_id     TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  child_id    TEXT NOT NULL REFERENCES children (id) ON DELETE CASCADE,
  at          INTEGER NOT NULL,                 -- client ms
  day         TEXT NOT NULL,                    -- child's local yyyy-mm-dd
  type        TEXT NOT NULL CHECK (type IN ('recite', 'check', 'session', 'reset')),
  task        TEXT,
  perek       INTEGER,
  mishnah     INTEGER,
  grade       TEXT CHECK (grade IS NULL OR grade IN ('pass', 'help', 'notyet')),
  peeks       INTEGER,
  slips       INTEGER,
  ms          INTEGER,
  data        TEXT NOT NULL,
  received_at INTEGER NOT NULL
);
CREATE INDEX events_child_at ON events (child_id, at);
CREATE INDEX events_user ON events (user_id);
```

**`migrations/0005_rate_limits.sql`**

```sql
CREATE TABLE rate_limits (
  key          TEXT PRIMARY KEY,                -- "<name>:<hmac(subject) prefix>"
  window_start INTEGER NOT NULL,
  count        INTEGER NOT NULL
);
CREATE INDEX rate_limits_window ON rate_limits (window_start);
```

---

## 9. Client changes

**The learning UI stays as it is.** `Home`, `MishnahScreen`, `Session` and the components keep their behavior and
look. The only additions are the event callbacks described in §9.5 and the topbar label noted below.

### 9.1 Types and storage

- `src/types.ts`: keep everything. Append a compile-time equality check against `shared/api.ts`:

```ts
import type { ChildSettings, MishnahProgressData, PerekProgressData } from "../shared/api";
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
export const _typesMatchShared: [Same<MishnahProgress, MishnahProgressData>, Same<PerekProgress, PerekProgressData>,
  Same<Settings, ChildSettings>] = [true, true, true];
```

- `src/storage.ts`: becomes **legacy and helpers only**.
  - Keep `KEY = "baalpeh:v1"`, `load()` (renamed `loadLegacy()`), `emptyState`, `isAppState`, `requestPersist`,
    `COLORS`, `EMOJIS`, `blankMishnah`, `blankPerek`.
  - Remove `save()`. The app never writes v1 again, and v1 data is never deleted automatically.
  - `newProfile(name, index)` now uses `crypto.randomUUID()` for `id`.

### 9.2 Account store (`src/sync/store.ts`)

```ts
import type { ChildRow, LearningEvent, Ms, RecordRow, User } from "../../shared/api";
import type { Profile } from "../types";

export interface Pending {
  children: Record<string, ChildRow>;           // by child id
  records: Record<string, RecordRow>;           // by `${childId}|${kind}|${key}`
  events: LearningEvent[];
}
export interface AccountStore {
  version: 2;
  user: User;
  cursor: number;
  profiles: Profile[];
  pending: Pending;
  lastSyncAt: Ms | null;
  /** v1 localStorage import prompt state for this account on this device. */
  importDecision: "none" | "imported" | "dismissed";
}

export const CURRENT_KEY = "baalpeh:v2:current";              // JSON User of the signed-in account (offline boot)
export const storeKey = (userId: string) => `baalpeh:v2:acct:${userId}`;

export interface KV { getItem(k: string): string | null; setItem(k: string, v: string): void; removeItem(k: string): void }

export function loadStore(kv: KV, user: User): AccountStore;   // creates an empty store if missing or corrupt
export function saveStore(kv: KV, s: AccountStore): void;      // try/catch like today
export function loadCurrentUser(kv: KV): User | null;
export function setCurrentUser(kv: KV, u: User | null): void;
export function pendingCount(s: AccountStore): number;
export function applyLocalEdit(s: AccountStore, next: Profile[], now: Ms): AccountStore;      // §6.4
export function applyServerResponse(s: AccountStore, sent: SentBatch, r: SyncResponse, now: Ms): AccountStore;
export function enqueueEvent(s: AccountStore, e: LearningEvent): AccountStore;
```

All functions are pure apart from `loadStore` and `saveStore`. `KV` is injected (`localStorage` in the app, an
in-memory map in tests). Pending events are capped at 5,000; the oldest are dropped first.

`src/sync/mapping.ts`: `metaOf(p: Profile, sort: number): ChildMeta`, `profileToRows(p, sort, now)` (all rows, used
by import), `diffProfiles(prev, next, now): { children: ChildRow[]; records: RecordRow[] }`, and
`blankProfileFromRow(row: ChildRow): Profile`.

### 9.3 API client (`src/api/client.ts`)

```ts
export class ApiFailure extends Error {
  constructor(readonly status: number, readonly body: ApiError | null) { super(body?.message ?? `HTTP ${status}`); }
}
export class NetworkFailure extends Error {}

async function call<T>(method: "GET" | "POST" | "DELETE", path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method, credentials: "same-origin",
      headers: body === undefined ? {} : { "Content-Type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  } catch (e) { throw new NetworkFailure(String(e)); }
  if (res.status === 204) return undefined as T;
  const json: unknown = await res.json().catch(() => null);
  if (!res.ok) throw new ApiFailure(res.status, (json as ApiError | null) ?? null);
  return json as T;
}

export const api = {
  config: () => call<ConfigResponse>("GET", "/config"),
  requestLogin: (b: AuthRequestBody) => call<AuthRequestResponse>("POST", "/auth/request", b),
  verifyLink: (b: VerifyLinkBody) => call<AuthSuccessResponse>("POST", "/auth/verify-link", b),
  verifyCode: (b: VerifyCodeBody) => call<AuthSuccessResponse>("POST", "/auth/verify-code", b),
  logout: () => call<void>("POST", "/auth/logout", {}),
  me: () => call<MeResponse>("GET", "/me"),
  deleteAccount: (b: DeleteAccountBody) => call<void>("DELETE", "/account", b),
  sync: (b: SyncRequest) => call<SyncResponse>("POST", "/sync", b),
  events: (childId: string, before?: number) => call<EventsResponse>("GET", `/children/${encodeURIComponent(childId)}/events${before ? `?before=${before}` : ""}`),
  stats: (childId: string, days = 30) => call<ChildStatsResponse>("GET", `/children/${encodeURIComponent(childId)}/stats?days=${days}`),
};
export type Api = typeof api;
```

The browser sends `Origin` automatically on these same-origin POST and DELETE requests.

### 9.4 Sync engine (`src/sync/engine.ts`) and hook (`src/sync/useAccount.ts`)

```ts
export type SyncState = "idle" | "syncing" | "offline" | "error" | "signedOut";
export interface SyncStatus { state: SyncState; pending: number; lastSyncAt: Ms | null }

export class SyncEngine {
  constructor(deps: { api: Pick<Api, "sync">; get(): AccountStore; set(s: AccountStore): void;
                      onStatus(s: SyncStatus): void; now?: () => number; setTimer?: typeof setTimeout });
  kick(delayMs?: number): void;    // debounce, default 2000
  syncNow(): Promise<void>;        // single-flight; loops while pending remains
  start(): void;                   // online/visibility listeners + 60 s interval
  stop(): void;
}
```

The `useAccount(user)` hook owns the `AccountStore` in React state, persists it with `saveStore` on every change, and
exposes:

```ts
{ profiles, setProfiles(next: Profile[]): void /* applyLocalEdit + kick */, addEvent(childId, body: LearningEventBody): void,
  status: SyncStatus, syncNow(), importLegacy(selected: Profile[]): void, setImportDecision(d), store }
```

`addEvent` builds the envelope: `id = crypto.randomUUID()`, `at = Date.now()`, `day = today()` from `src/srs.ts`.

### 9.5 Screens and flow

```
boot ─┬─ path "/auth/verify" ─────────────▶ VerifyLanding ──ok──▶ (account) ──▶ Picker
      ├─ cached current user ─────────────▶ Picker immediately (offline-first); GET /api/me in background
      │                                     ├ 200 → online; start SyncEngine
      │                                     ├ 401 → Login (store kept; "Your sign-in expired")
      │                                     └ network error → stay, status offline
      └─ no cached user ─▶ GET /api/me ─┬ 200 → set current user → Picker
                                        ├ 401 → Login
                                        └ network error → "You're offline. Connect to sign in." + Retry
Login (email + Turnstile) ──request──▶ CheckEmail (code box; "open the link on any device") ──ok──▶ Picker
Picker ("Who's learning?") ─tap child─▶ Home ─▶ (MishnahScreen | Session) ; Home "‹ Switch" ─▶ Picker
Picker ─hold 2 s─▶ Parent area (children, history, backup, account: sync status, Sign out, Delete account)
```

Files:

- `src/App.tsx`: becomes the **auth shell**. Its state is
  `{ phase: "boot" } | { phase: "verify"; token: string } | { phase: "login"; reason?: "expired" } | { phase: "checkEmail"; email: string } | { phase: "offlineNoAccount" } | { phase: "app"; user: User }`.
  It renders `LearningApp` for `app`. On `phase: "app"` it calls `setCurrentUser`.
- `src/LearningApp.tsx`: the **current** `App.tsx` screen machine moved here almost unchanged. Differences:
  - `state` and `setState` become `profiles` and `setProfiles` from `useAccount(user)`. The `save` effect and
    `load()` are gone.
  - `Screen` keeps `profiles | parent | home | mishnah | session`. Start on `profiles` always, even with 0 children.
  - It passes `onEvent={(body) => addEvent(profile.id, body)}` to `Session`, and `onEvent` to `Parent` (for resets).
  - It passes `status`, `syncNow`, `user` and `onSignOut` to `Parent`.
- `src/auth/Login.tsx`: an email input (`type="email"`, `autoComplete="email"`), the Turnstile widget and a
  "Send me a sign-in email" button. It is disabled until there is a token and a plausible email. On
  `turnstile_failed`, it resets the widget and shows "Please try the check again". On `rate_limited`, it shows "Too
  many tries. Wait N minutes". On `email_failed`, it shows "We couldn't send the email. Try again later". After a
  successful request, the widget is reset (tokens are single-use). If `config.devEmail`, it shows a small dev notice.
- `src/auth/Turnstile.tsx`: loads `https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit` once (a
  module-level promise, `<script async defer>`). It calls
  `window.turnstile.render(el, { sitekey, action: "login", callback, "expired-callback", "error-callback" })` and
  `turnstile.reset(id)` / `turnstile.remove(id)` on unmount. It declares a minimal `Window.turnstile` type locally.
  The site key comes from `api.config()`.
- `src/auth/CheckEmail.tsx`: "We sent an email to **x**. Tap the link in it, or type the 6-digit code here." It has an
  `<input inputMode="numeric" autoComplete="one-time-code" maxLength={7} pattern="[0-9 ]*">` that auto-submits at 6
  digits. Errors: `invalid_code` shows "That code isn't right (N tries left)"; `too_many_attempts` and an expired
  request show "Request a new email". There is a "Send a new email" link (back to Login with the email prefilled; a
  30 s cooldown) and a "Use a different email" link.
- `src/auth/VerifyLanding.tsx`: parses `location.hash` (`token=`), then `history.replaceState(null, "",
  "/auth/verify")`. It shows "Sign in to Mishnah Ba'al Peh on this device?" and a primary button. On success it
  calls `history.replaceState(null, "", "/")` and goes to the app. On `invalid_link` it shows "This link has expired or
  was already used" plus a button to Login. A missing token shows the same message.
- `src/screens/Profiles.tsx` (picker), changes:
  - With 0 children: "No children yet." plus an inline name field and a primary **Add child** button, no gate (a
    parent just signed in). This is "the empty home with Add child".
  - With ≥ 1 child: unchanged tiles, plus the existing `HoldButton` to the parent area. Adding more children happens
    in the parent area.
  - While the first sync of a fresh device runs (`cursor === 0 && status.state === "syncing"`), it shows "Loading
    your children…" instead of the empty state.
  - The import banner (§9.6) goes above the grid.
  - A small sync dot in a corner shows `idle`, `syncing`, `offline` or `signedOut`, with no text for children.
- `src/screens/Home.tsx`: no logic change. The topbar button "‹ Switch" stays and goes back to the picker. This is
  the child's "sign out / switch to a sibling".
- `src/screens/Parent.tsx`, changes:
  - The **Children** section works as today but uses `setProfiles`. Deleting asks for `confirm()` as today. "Reset a
  mishnah" also calls `onEvent({ type: "reset", … })`.
  - Each `ChildCard` gets a **History** toggle that renders `ChildHistory`.
  - **Backup**: Export as today (AppState v1 JSON of the current profiles). Import now *adds* the file's profiles as
    new children with new UUIDs (confirm "Add N children from this backup?"). The hint text changes to "Progress is
    saved to your account and on this device."
  - **Move from this device**: shown when v1 data exists. It reopens the import prompt.
  - **New Account** section: the signed-in email; sync status ("Synced 2 min ago" / "Offline: 12 changes waiting" /
    "Sign in again to sync") with a **Sync now** button; **Sign out of this device**; **Delete account**.
  - **Sign out**: run `syncNow()` first. If anything is still pending, `confirm("N changes haven't reached the server
    and will be lost. Sign out anyway?")`. Then `api.logout()` (ignore network errors), remove `storeKey(user.id)`,
    `setCurrentUser(null)`, and go to Login.
  - **Delete account**: a text field where the email must be typed, then a button. Call `api.deleteAccount`, then
    clear local data as for sign-out.
- `src/screens/ChildHistory.tsx`: shown online only; offline it says "Connect to the internet to see history".
  - **Due now**: computed locally with `dueReviews(profile)`. Lists "Review 1:3", "Perek 2 review".
  - **Needs attention**: `stats.items` with `struggle > 0`, top 5. Shows "Perek 1 · Mishnah 3 — 4 tries, 2 needed more
    practice, 9 peeks"; a perek-level row shows "Perek 2 in a row".
  - **Last 14 days**: one bar per day from `stats.days` (minutes), simple divs, and the Shabbos styling of `WeekDots`
    if easy.
  - **Recent activity**: the first page of `api.events`, as human-readable lines with time, and "Load more" using
    `nextBefore`.
- `src/screens/ImportPrompt.tsx`: §9.6.
- `src/screens/Session.tsx`: **instrumentation only**, with no visual change.
  - It gets a new optional prop `onEvent?: (e: LearningEventBody) => void`.
  - `LearnTask` records `stepStart = useRef(Date.now())`, reset whenever the step, phase or attempt changes.
  - Piece recall `Recite.onDone(g, peeks)` emits `{type:"recite", task:"learn", perek, mishnah, step: stepIndex, grade: g, peeks: sum(peeks), ms}`.
  - Chain `Recite.onDone` emits task `detour ? "detour" : "chain"`.
  - The mishnah `ParentCheck.onDone` emits `{type:"check", scope:"mishnah", mishnah, through:null, slipped, slipWords}`.
  - The review-m `Recite.onDone` emits task `"review-m"`, step null.
  - `PerekChainTask`: `Recite.onDone(g, peeks)` emits task `review ? "review-p" : "perek-chain"`, mishnah null.
    `ParentCheck.onDone` emits scope `review ? "review-p" : "chain"`, `through`, `slipped` = mishnah numbers.
  - Session: a `useEffect` cleanup on unmount emits `{type:"session", startedAt, ms: min(now-startedAt, 3h), steps}`
    when `ms >= 5000`.
  - `src/components/ParentCheck.tsx`: `onDone` gets a third argument `slipWords: number` (= `slips.size`). Existing
    callers are updated.

### 9.6 Importing v1 localStorage data

- Condition: `loadLegacy().profiles.length > 0 && store.importDecision === "none"`, checked when the picker mounts.
- `ImportPrompt` (a modal on the picker) says: "This device has saved progress from before accounts:", then one
  checkbox per legacy profile (emoji, name, "N mishnayos known"). A box is pre-checked unless a child with the same
  name already exists in the account (then it says "(already in your account?)"). The buttons are **Add to my
  account** / **Not now** (asks again next app start; kept in memory only) / **Don't ask again** (`dismissed`).
- `importLegacy(selected)` (`src/legacy/import.ts`): for each selected profile, make a copy with
  `id = crypto.randomUUID()`, append it to `profiles` and put all of its rows (`profileToRows`) into `pending` with
  `updatedAt = now`. Set `importDecision = "imported"`. The v1 key is left untouched.
- **Origin caveat (tell the owner):** the old app ran on GitHub Pages (`…github.io/Baalpeh/`). Its localStorage
  belongs to that origin and **cannot be read from the new domain**. To move existing progress, open the old site,
  use *Parent → Export backup*, then on the new site use *Parent → Import backup*. The automatic prompt covers devices
  that ran the app on the new origin before signing in (e.g. dev). Keep the old Pages site up until the move is done.

### 9.7 `public/_headers` (new, verbatim)

```
/*
  Referrer-Policy: no-referrer
  X-Content-Type-Options: nosniff
  X-Frame-Options: DENY
/assets/*
  Cache-Control: public, max-age=31536000, immutable
```

---

## 10. Build, config and dev

### 10.1 `package.json` (verbatim; SERVER agent writes it and runs the install)

```json
{
  "name": "baalpeh",
  "private": true,
  "version": "0.2.0",
  "type": "module",
  "scripts": {
    "data": "python3 scripts/build_data.py",
    "dev": "vite",
    "dev:api": "mkdir -p dist && wrangler d1 migrations apply baalpeh --local && wrangler dev --port 8787",
    "preview:worker": "npm run build && wrangler d1 migrations apply baalpeh --local && wrangler dev --port 8787 --var APP_ORIGIN:http://localhost:8787",
    "build": "tsc -b && tsc -p worker/tsconfig.json && vite build",
    "typecheck": "tsc -b && tsc -p worker/tsconfig.json",
    "test": "vitest run",
    "test:client": "vitest run --project client",
    "test:worker": "vitest run --project worker",
    "db:migrate:local": "wrangler d1 migrations apply baalpeh --local",
    "db:migrate:remote": "wrangler d1 migrations apply baalpeh --remote",
    "deploy": "npm run build && wrangler d1 migrations apply baalpeh --remote && wrangler deploy"
  },
  "dependencies": {
    "hono": "4.13.13",
    "react": "18.3.1",
    "react-dom": "18.3.1"
  },
  "devDependencies": {
    "@cloudflare/vitest-plugin": "1.3.7",
    "@cloudflare/workers-types": "5.20261010.1",
    "@types/react": "18.3.12",
    "@types/react-dom": "18.3.1",
    "@vitejs/plugin-react": "5.2.0",
    "typescript": "5.9.3",
    "vite": "7.3.7",
    "vitest": "4.1.11",
    "wrangler": "4.148.0"
  }
}
```

Install with `rm -rf node_modules package-lock.json && npx -y npm@11.6.2 install`. `vite-plugin-singlefile` and
`build:single` are gone. (`@cloudflare/vitest-pool-workers` is deprecated and renamed to `@cloudflare/vitest-plugin`;
use the new name.)

### 10.2 `wrangler.jsonc` (verbatim, except the owner fills the placeholders)

```jsonc
{
  "$schema": "./node_modules/wrangler/config-schema.json",
  "name": "baalpeh",
  "main": "worker/index.ts",
  "compatibility_date": "2026-10-01",
  "compatibility_flags": ["nodejs_compat"],
  "assets": {
    "directory": "./dist",
    "binding": "ASSETS",
    "not_found_handling": "single-page-application",
    "run_worker_first": ["/api/*"]
  },
  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "baalpeh",
      "database_id": "00000000-0000-0000-0000-000000000000", // OWNER: replace with the id from `wrangler d1 create baalpeh`
      "migrations_dir": "migrations"
    }
  ],
  "vars": {
    "APP_ORIGIN": "https://mishnah.example.com",                   // OWNER: your domain, no trailing slash
    "EMAIL_FROM": "Mishnah Ba'al Peh <login@mishnah.example.com>",  // OWNER: an address on the Resend-verified domain
    "TURNSTILE_SITE_KEY": "1x00000000000000000000AA"               // OWNER: real site key (this is the always-pass test key)
  },
  // Secrets (set with `wrangler secret put NAME`, never committed):
  //   AUTH_SECRET, TURNSTILE_SECRET_KEY, RESEND_API_KEY
  "triggers": { "crons": ["17 3 * * *"] },
  "observability": { "enabled": true }
  // OWNER: to serve on your domain, add:
  // ,"routes": [{ "pattern": "mishnah.example.com", "custom_domain": true }]
}
```

SPA fallback: with `not_found_handling: "single-page-application"`, any path that is not a file (e.g. `/auth/verify`)
serves `index.html`. `/api/*` always runs the Worker first.

### 10.3 `.dev.vars.example` (verbatim; copy to `.dev.vars` for local dev)

```
APP_ORIGIN=http://localhost:5173
TURNSTILE_SITE_KEY=1x00000000000000000000AA
TURNSTILE_SECRET_KEY=1x0000000000000000000000000000000AA
AUTH_SECRET=dev-only-not-a-secret-0123456789abcdef0123456789abcdef
# RESEND_API_KEY=re_xxx   # leave unset: link and code are printed in the wrangler console
```

Add `.wrangler` and `.dev.vars` to `.gitignore`.

### 10.4 Vite (`vite.config.ts`, verbatim; CLIENT owns it)

```ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Served by the Cloudflare Worker at the domain root. In dev, /api is proxied to `wrangler dev` on :8787.
export default defineConfig({
  base: "/",
  plugins: [react()],
  build: { outDir: "dist" },
  server: { port: 5173, strictPort: true, proxy: { "/api": { target: "http://localhost:8787" } } },
});
```

The proxy keeps the browser's `Origin: http://localhost:5173`, which matches `APP_ORIGIN` in `.dev.vars`. The Worker
sees http, so the cookie is `bp_session` without `Secure`.

### 10.5 TypeScript

- Root `tsconfig.json` (CLIENT): unchanged options, `"include": ["src", "shared", "vite.config.ts"]`.
- `worker/tsconfig.json` (SERVER, verbatim):

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true,
    "isolatedModules": true,
    "skipLibCheck": true,
    "noEmit": true,
    "types": ["@cloudflare/workers-types", "@cloudflare/vitest-plugin/types"]
  },
  "include": ["./**/*.ts", "../shared/**/*.ts"],
  "exclude": ["vitest.config.ts"]
}
```

### 10.6 Tests config

Root `vitest.config.ts` (SERVER writes it, verbatim):

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      { extends: "./vite.config.ts", test: { name: "client", include: ["tests/**/*.test.ts"], environment: "node" } },
      "./worker/vitest.config.ts",
    ],
  },
});
```

`worker/vitest.config.ts` (SERVER, verbatim; smoke-tested):

```ts
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import { fileURLToPath } from "node:url";
import { defineProject } from "vitest/config";

const root = fileURLToPath(new URL("..", import.meta.url));
const migrations = await readD1Migrations(`${root}migrations`);

export default defineProject({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: `${root}wrangler.jsonc` },
      miniflare: {
        bindings: {
          TEST_MIGRATIONS: migrations,
          APP_ORIGIN: "https://app.test",
          AUTH_SECRET: "test-secret-0123456789abcdef0123456789abcdef",
          TURNSTILE_SECRET_KEY: "1x0000000000000000000000000000000AA",
          TURNSTILE_SITE_KEY: "1x00000000000000000000AA",
          EMAIL_FROM: "Test <login@app.test>",
        },
      },
    }),
  ],
  test: { name: "worker", include: ["test/**/*.test.ts"], setupFiles: ["./test/setup.ts"] },
});
```

`worker/test/setup.ts`:

```ts
import { applyD1Migrations } from "cloudflare:test";
import { env } from "cloudflare:workers";
await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
```

`worker/test/env.d.ts`:

```ts
declare namespace Cloudflare {
  interface Env extends import("../env").Env {
    TEST_MIGRATIONS: import("@cloudflare/vitest-plugin").D1Migration[];
  }
}
```

Tests call the app directly: `import worker from "../index"` and
`await worker.fetch(new Request("https://app.test/api/…", init), env, createExecutionContext())`. Test code shares an
isolate with the worker, so `devOutbox` from `../email/log` and `vi.spyOn(globalThis, "fetch")` (for Turnstile and
Resend) work. **Don't rely on per-test storage isolation:** use a unique email and IP (`CF-Connecting-IP` header) in
each test. `test/helpers.ts` provides `req(path, {method, body, cookie, origin, ip})`, `login(email)` (request,
read the code from `devOutbox`, verify-code, return the cookie), `mockTurnstile(success)` and `cookieOf(res)`.

### 10.7 Local development

```bash
cp .dev.vars.example .dev.vars
npx -y npm@11.6.2 install
npm run dev:api      # terminal 1: applies local D1 migrations, wrangler dev on :8787 (API; emails printed here)
npm run dev          # terminal 2: Vite on :5173 with /api proxied → open http://localhost:5173
npm run preview:worker   # optional: production-like single server on :8787 serving the built dist/
npm test             # client + worker tests
```

### 10.8 CI: replace `.github/workflows/pages.yml` with `.github/workflows/deploy.yml` (verbatim)

```yaml
name: Test and deploy to Cloudflare
on:
  push:
    branches: [main]
  pull_request:
  workflow_dispatch:
permissions:
  contents: read
concurrency:
  group: deploy-${{ github.ref }}
  cancel-in-progress: true
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - run: npm install -g npm@11.6.2
      - run: npm ci
      - run: npm run typecheck
      - run: npm test
      - run: npm run build
  deploy:
    needs: test
    if: github.event_name != 'pull_request' && github.ref == 'refs/heads/main'
    runs-on: ubuntu-latest
    environment: production
    env:
      CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
      CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - run: npm install -g npm@11.6.2
      - run: npm ci
      - run: npm run build
      - run: npx wrangler d1 migrations apply baalpeh --remote
      - run: npx wrangler deploy
```

Migrations are additive and run before the deploy, so old code tolerates the new schema.

---

## 11. Tests

### 11.1 Server (`worker/test/*.test.ts`)

**auth.test.ts**
1. `request` returns 200 `{ok:true, expiresInSec:900}`. `devOutbox` gets exactly one email to that address. The text
   contains `https://app.test/auth/verify#token=` and a 6-digit code. The DB row holds neither the raw token nor the
   code; `token_hash === sha256(token)`.
2. A new email and an existing email (after a login) get byte-identical response bodies and the same status.
3. Turnstile mocked to `{success:false}` returns 400 `turnstile_failed`. The mocked fetch received `secret`,
   `response` and `remoteip`.
4. `verify-link` with the token from the email returns 200, `newUser: true`, and a `Set-Cookie` containing
   `__Host-bp_session=`, `HttpOnly`, `Secure`, `SameSite=Lax`, `Path=/` and `Max-Age=2592000`. A second use returns
   400 `invalid_link`.
5. Expiry: set `expires_at` in the past (or use fake time + 16 min) and get `invalid_link`; the same for the code with
   `invalid_code`.
6. `verify-code`: a wrong code returns `invalid_code` with `attemptsLeft` 4, 3, …. The 5th wrong attempt returns
   `too_many_attempts`, and the correct code fails afterwards.
7. Supersede: request twice, then the first code returns `invalid_code` and the first link `invalid_link`. The second
   pair works.
8. Single use across channels: after a successful code verify, the link from the same email returns `invalid_link`.
9. A second login for the same email returns `newUser: false` and the same `user.id`.
10. Rate limits: the 6th request for one email within the hour returns 429 with `retryAfterSec > 0`. The 11th from one
    IP with different emails returns 429.
11. CSRF: POST with `Origin: https://evil.test` returns 403. No Origin and no `Sec-Fetch-Site` returns 403.
    `Content-Type: text/plain` returns 400.
12. Malformed email or a missing turnstileToken returns 400 `bad_request`. A body over 1 MB returns 413.

**session.test.ts**
1. `/api/me` with the cookie returns 200 with the user. Without it, or with a garbage cookie, it returns 401.
2. Only the hash is stored: `sessions.token_hash === sha256(cookie value)`, and no column contains the raw token.
3. Sliding: set `last_seen_at = now - 10 min` and `expires_at = now + 1 day`. `/api/me` then gives
   `expires_at ≈ now + 30 d` and a refreshed `Set-Cookie`. A second call within 5 min has no `Set-Cookie` and no
   change to `last_seen_at`.
4. An expired session (`expires_at = now - 1`) returns 401, the row is deleted, and the cookie is cleared.
5. `logout` returns 204, the row is gone, and the cookie is cleared (`Max-Age=0`). `/me` then returns 401. Logout
   without a cookie also returns 204.
6. The cookie name and flags follow `APP_ORIGIN`: a unit test of the cookie helper with an `http://localhost:5173`
   env gives `bp_session` without `Secure`.

**sync.test.ts**
1. Device A pushes a child, two `m`, one `p`, one `d` and two events. The response cursor is ≥ 1 and contains those
   rows. Device B with `cursor: 0` pulls the same children and records.
2. Incremental: A pushes a new `m` row, and B with its last cursor receives only that row.
3. LWW: B pushes an older `updatedAt` for an existing key. The server value is unchanged, and the response contains
   the server's version of that key.
4. Clamp: `updatedAt = now + 1 year` is stored as ≤ server now.
5. Idempotent events: the same event id pushed twice is stored once.
6. Tombstone: pushing `deleted: true` removes the child's progress and events. A later push of records or events for
   it is ignored. A push of `deleted: false` with a newer `updatedAt` does not resurrect it. Pulls include the
   tombstone.
7. Cross-account: user B pushing a child, record or event with A's child id returns 403. A's data is unchanged.
8. Limits: 501 rows returns 413. A bad key (`"x:y"`), a bad kind, or an oversize meta returns 400. The 51st live
   child returns 400.
9. An empty push (pull only) does not change `users.rev`.
10. 401 without a session.

**children.test.ts**: events paging (`limit` 2 over 5 events gives 3 pages, newest first, `nextBefore` null at the
end). Stats aggregation over seeded events matches hand-computed numbers and the `struggle` ordering. Another user's
child id returns 404. A deleted child returns 404.

**account.test.ts**: a wrong email returns 400. The right email returns 204, and users, sessions, children, progress,
events and login_requests for that user are all gone.

**cron.test.ts**: `cleanup` deletes expired sessions, login requests older than a day and stale rate-limit windows,
and keeps live ones.

**email.test.ts**: `ResendSender` posts to `https://api.resend.com/emails` with a Bearer key, an `Idempotency-Key` and
a JSON body `{from,to:[…],subject,text,html}` (mock fetch), and throws on a 4xx. `LogSender(false)` throws.
`pickSender` picks Resend when the key is set. HTML escaping applies to the interpolated link.

### 11.2 Client (`tests/*.test.ts`, node environment, no DOM)

- Existing `tests/logic.test.ts` keeps passing unchanged.
- `tests/mapping.test.ts`: `diffProfiles` covers a meta change producing one ChildRow, a mishnah change producing one
  `m`, a new day producing one `d`, a removed child producing a tombstone, a reorder producing sort changes, and
  identical input producing nothing. `profileToRows` emits every key.
- `tests/store.test.ts`:
  - `applyLocalEdit` coalesces two edits of the same key into one pending row (the latest).
  - `applyServerResponse` clears only the sent-and-unchanged pending rows, keeps an edit made after the send, never
    overwrites a key that is still pending, removes profiles for tombstones, creates profiles for new children, merges
    days (union, sorted, ≤ 60) and updates the cursor.
  - It never adds pending rows.
- `tests/engine.test.ts` (fake api and timers):
  - 1,200 pending rows go out in 3 requests.
  - A 401 sets `signedOut` and keeps pending rows.
  - A `NetworkFailure` sets `offline` and retries with backoff.
  - Concurrent `syncNow()` calls make one request at a time.
- `tests/import.test.ts`: v1 profiles become new UUIDs with all rows pending and the decision becomes `imported`. A
  name collision means the box is pre-unchecked (test the pure helper that computes defaults).
- `tests/api.test.ts`: `call` maps 204 to undefined, a non-2xx response to `ApiFailure` with the body, and a fetch
  rejection to `NetworkFailure` (stub `globalThis.fetch`).

---

## 12. Implementation order (each agent)

**SERVER**

1. Create `shared/api.ts` verbatim (if absent), `package.json` verbatim, and install with npm 11 (§10.1). Then write
   `wrangler.jsonc`, `.dev.vars.example`, `.gitignore` additions, the root `vitest.config.ts`, `worker/tsconfig.json`
   and `worker/vitest.config.ts`. **Do this first; CLIENT waits for the install.**
2. Write the migrations.
3. Write `lib/*`, `email/*`, the routes and `cron.ts`, following §3, §4, §6.3 and §7.
4. Write the tests (§11.1) and make `npm run test:worker` and `tsc -p worker/tsconfig.json` pass.
5. Replace `pages.yml` with `deploy.yml`. Update README.md: the "static site with no backend" sentence, and the
   Develop and Deploy sections (point to §15 of this plan).
6. Check `npx wrangler deploy --dry-run` (needs `dist/`; run `npm run build` or `mkdir -p dist` with a stub
   index.html in a scratch copy) and manually test `npm run dev:api` with curl.

**CLIENT**

1. Wait until `node_modules/vite/package.json` reports 7.3.7. Do not run `npm install` and do not edit package.json.
   Create `shared/api.ts` verbatim if it is still absent.
2. Write `vite.config.ts` and the root tsconfig include. Delete nothing in `src/data/`.
3. Write `src/api`, `src/sync` (mapping, store, engine, hook), `src/legacy/import.ts` and their tests.
4. Write the auth screens, the App shell, `LearningApp`, and the picker, parent, history and import changes.
5. Add the Session/ParentCheck instrumentation.
6. Write `public/_headers`.
7. Make `npm run typecheck` (root part: `tsc -b`), `npm run test:client` and `vite build` pass. Then test manually
   against `npm run dev:api` (dev email in the console).

---

## 13. Work split and file ownership (strict)

| Path | Owner | Notes |
|---|---|---|
| `shared/api.ts` | **nobody edits** | created verbatim from §5 by whichever agent is first |
| `worker/**`, `migrations/**` | SERVER | |
| `wrangler.jsonc`, `.dev.vars.example`, `.gitignore` | SERVER | |
| `package.json`, `package-lock.json` | SERVER | verbatim §10.1; CLIENT needs no new deps |
| root `vitest.config.ts` | SERVER | verbatim §10.6 |
| `.github/workflows/**` | SERVER | delete `pages.yml`, add `deploy.yml` |
| `README.md` | SERVER | only the sections named in §12 |
| `src/**` (except `src/data/**`) | CLIENT | |
| `tests/**` | CLIENT | |
| `vite.config.ts`, root `tsconfig.json`, `index.html`, `public/**` | CLIENT | |
| `src/data/**`, `data/**`, `scripts/**`, `docs/**` | **nobody** | another process is editing the gloss data and `src/data/berakhot.json` right now |

Rules for both agents:

- Do not commit. Do not touch files you don't own. If you need a change in someone else's file, write it down in your
  final report instead.
- Treat this plan as the spec. If something in it is impossible, choose the smallest deviation, keep the
  `shared/api.ts` contract, and report it.
- The client must never depend on worker code and vice versa. Only `shared/api.ts` is shared.

### 13.1 REVIEW agent checklist

Run: `npx -y npm@11.6.2 ci`, `npm run typecheck`, `npm test`, `npm run build`, and `npx wrangler deploy --dry-run`.
Then check:

**Contract and ownership**
- [ ] `shared/api.ts` is byte-identical to §5 (`diff` against the plan).
- [ ] No file outside each agent's ownership was changed. `src/data/**`, `data/**` and `scripts/**` are untouched by
      these agents.
- [ ] Package versions are exactly as in §10.1. No `^` or `~`. No stray dependencies (no zod, no Resend SDK).

**Auth security**
- [ ] Token: 32 bytes from CSPRNG. Code: rejection-sampled 6 digits. Neither is ever stored or logged in raw form
      (grep for `console.log` in worker/).
- [ ] The token lives only in the URL fragment. The landing page strips it via `replaceState` and POSTs only on a
      user tap.
- [ ] Link and code share one single-use row. Consumption is a conditional `UPDATE … RETURNING`. A new request
      supersedes older ones.
- [ ] 5-attempt lockout. `attemptsLeft` is correct. The code comparison uses `timingSafeEqual` on HMACs.
- [ ] `auth/request` responds identically for new and existing emails. Users are created only on verify.
- [ ] Turnstile is verified server-side before any email is sent. Rate limits match the §3.5 table and the keys are
      HMAC'd.
- [ ] Cookie: `__Host-` prefix, HttpOnly, Secure, SameSite=Lax, Path=/, Max-Age 30 d. Only the SHA-256 is stored.
      Sliding refresh works (5-minute throttle). Expired sessions are deleted.
- [ ] The Origin check covers all non-GET `/api` routes, including auth routes. JSON content type is enforced. No
      CORS headers. `/api` responses are `no-store`.
- [ ] `LogSender` prints secrets only for a localhost `APP_ORIGIN` and fails otherwise.

**Sync**
- [ ] One `db.batch` per sync. Ownership pre-check returns 403. Upserts follow LWW with `>` and clamp to server time.
      Tombstones are final and purge data. Events use `INSERT OR IGNORE`. An empty push does not bump rev.
- [ ] The response includes the server's version of every pushed key.
- [ ] Client: pending is cleared only when `updatedAt` is unchanged. Server rows never overwrite pending keys and
      never create pending rows. Retries back off. 401 keeps data.
- [ ] Validation covers every field in §7.3 and the size limits are enforced.

**Client UX**
- [ ] Learning screens look and behave as before (spot-check Home, a learn task, a parent check, a review).
- [ ] Flow: Login (Turnstile) → CheckEmail (code works) → Picker. The link opened in a second browser signs that
      browser in. 0 children shows Add child. "‹ Switch" returns to the picker. The parent area is behind the hold
      gate, and Sign out there clears local account data after the unsynced-changes warning.
- [ ] Offline: with the API stopped, a signed-in device boots to the picker, learning works, and changes sync after the
      API returns.
- [ ] The v1 import prompt appears when v1 data exists. Import creates children with new ids. "Don't ask again"
      sticks. Backup import adds children.
- [ ] Events: one recite event per recitation, a check event per parent check, and a session event per session. The
      History view shows Due now, Needs attention, Last 14 days and Recent activity.
- [ ] Vite `base` is `/`. `build:single` is gone. `pages.yml` is replaced by `deploy.yml`.

**Tests**
- [ ] Every test listed in §11 exists (or is merged into an equivalent) and passes. No test depends on per-test
      storage isolation or on real network access.

---

## 14. Later work (not in the MVP)

- Pull pagination for very large accounts. Per-masechta keys (`berakhot/1:2`) when a second masechta is added; the
  current keys mean Berakhot.
- A parent PIN for the parent area. "Sign out of all devices" and a list of active sessions.
- A weekly progress email to the parent. Due-review reminders.
- A Content-Security-Policy header (allow-list Google Fonts and Turnstile).
- Multi-tab coordination (`storage` event), and a service worker / PWA offline shell (today, offline needs the page
  to be already open or cached by the browser).
- Event retention or rollups after ~1 year. Exporting the history as CSV.
- Sharing an account between two parents (invite a co-parent email).
- A last GitHub Pages release with a "Move my progress" button that exports the backup file automatically.
- Struggle per piece (chunk) from `fails` and parent slip marks, shown on the perek map.
- Replacing the D1 rate limiter with the Workers Rate Limiting binding if traffic ever grows.

---

## 15. Deployment steps for the owner

You need a Cloudflare account with your domain on Cloudflare DNS (Workers Free plan is enough) and a Resend account.

1. **Install and log in:** `npx -y npm@11.6.2 install`, then `npx wrangler login`.
2. **Create the database:** `npx wrangler d1 create baalpeh`. Copy the printed `database_id` into `wrangler.jsonc`.
   Then apply the schema: `npm run db:migrate:remote`.
3. **Turnstile:** Cloudflare dashboard → *Turnstile* → *Add widget*. Name it "Ba'al Peh login", add your hostname
   (e.g. `mishnah.example.com`) and choose mode *Managed*. Put the **site key** into `vars.TURNSTILE_SITE_KEY`, then
   run `npx wrangler secret put TURNSTILE_SECRET_KEY` and paste the **secret key**.
4. **Resend:**
   1. resend.com → *Domains* → *Add domain* (your domain, or a subdomain like `mail.example.com`). Add the DNS
      records it shows (SPF/DKIM/MX for bounces) in Cloudflare DNS, or use Resend's automatic Cloudflare setup. Wait
      for **Verified**.
   2. *API Keys* → *Create API key* with permission "Sending access", restricted to that domain.
   3. Run `npx wrangler secret put RESEND_API_KEY` and paste the key.
   4. Set `vars.EMAIL_FROM` to an address on the verified domain, e.g. `Mishnah Ba'al Peh <login@example.com>`.
   (The free tier currently allows about 100 emails a day, which is plenty for logins.)
5. **Auth secret:** `openssl rand -base64 32 | npx wrangler secret put AUTH_SECRET`.
6. **Origin and domain:** set `vars.APP_ORIGIN` to `https://your.domain` (no trailing slash). Uncomment and fill the
   `routes` entry with `"custom_domain": true` in `wrangler.jsonc`, or after the first deploy use the dashboard:
   *Workers & Pages → baalpeh → Settings → Domains & Routes → Add custom domain*.
7. **Deploy:** `npm run deploy` (build, remote migrations, `wrangler deploy`). If `wrangler secret put` ran before the
   Worker existed, wrangler offers to create it; accept.
8. **CI (optional, recommended):** in GitHub → *Settings → Secrets and variables → Actions*, add
   `CLOUDFLARE_API_TOKEN` (create it from the "Edit Cloudflare Workers" template and add *Account → D1 → Edit*) and
   `CLOUDFLARE_ACCOUNT_ID`. Create a GitHub environment named `production`. Each push to `main` then tests and
   deploys.
9. **Retire GitHub Pages:** first open the old site on each tablet, then *Parent → Export backup*. On the new site,
   sign in and use *Parent → Import backup*. Then disable Pages in the repo settings.
10. **Smoke test:** open the site, request a sign-in email, sign in with the code on one device and with the link on
    another, add a child, learn a step, and check the child appears with progress on the second device.

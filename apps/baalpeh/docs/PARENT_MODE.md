# Parent mode: a separate, PIN-locked parent area

Status: implemented. Server side and `shared/api.ts`: see §14 for what differs; client side: see §15. It merges the backend/security proposal and the UX/client proposal. Where they
disagreed, §1 records the decision and the reason. Claims about today's code were checked against the tree at
`866b91e`.

This spec **supersedes** these parts of `docs/PARENT_VERIFICATION.md`:
- §0 and §1 ("only the emailed link verifies");
- §11 ("verified: true must never be written directly from the parent area");
- §17 ("There is no parent-area power to mark or unmark perakim");
- the header comment of `worker/lib/verification.ts`.

The owner's new rule is that a perek can be marked verified in two ways:
- by the test-email link, which now also needs the PIN once one is set;
- by an unlocked **parent session**, which needs an email sign-in as parent plus the PIN.

The client still cannot forge either one: both are written only by the server through `worker/lib/verification.ts`.

---

## 0. Summary

| Topic | Decision |
|---|---|
| Sign-in | One login page with two choices: "Sign in as learner" and "Sign in as parent". Both use today's email link-or-code flow to the account email. `POST /api/auth/request` gets `as: "learner" \| "parent"`. The login request stores the scope, and the scope mints the matching cookie. |
| Sessions | Two independent cookies: learner `__Host-bp_session` (today's) and parent `__Host-bp_parent` (new). `sessions.scope` is set on INSERT and never updated. Every route reads only its own cookie. |
| Upgrade | None. A learner session cannot become a parent session. Parent mode always needs a new parent email sign-in (once per 14 days per device) plus the PIN every time it is opened. |
| Timings | Learner: 30 days sliding (unchanged). Parent session: 14 days from sign-in, absolute (no sliding). PIN unlock: 5 min idle on the server, 60 min at most, and cleared on leaving parent mode. The client also locks after 5 min with no input or 60 s hidden. PIN reset link: 1 h, single use. |
| PIN | 4 digits, account-wide. Set on the first parent sign-in (it cannot be skipped). Stored as PBKDF2-SHA256 of an HMAC-peppered input, with a 16-byte salt. Checked only on the server. 5 wrong tries in a row (unlock and test page together) lock it until a reset by email. |
| Forgot PIN | Emails a link to `/parent-pin#t=…` that sets a new PIN. It can be asked for from the PIN pad (parent session) or from the test page (test token). The old PIN keeps working until a new one is set. |
| Accountability | Every PIN set, change or reset first sends "Your parent PIN was changed" with the time, the device and the login. If that email can't be sent, the PIN is not changed. A lockout also sends an email. Every power is written to `audit_log`, which parent mode shows as the change log. |
| Test page | Lookup stays PIN-free. Once the account has a PIN, confirm needs `pin`, and it uses the same counter and lockout. Accounts with no PIN confirm exactly as today. |
| Parent data plane | `POST /api/parent/sync` uses the same `SyncRequest`/`SyncResponse` and one shared handler. The parent client keeps an in-memory store, pushes every edit at once, and has no offline queue. Plus `POST /api/parent/children/:id/verifications` (through `setVerificationStmts`), events and stats (moved), the log, account delete (moved) and `learner-session`. |
| Learner sync narrowed | A learner `/api/sync` can no longer create, delete or rename children. From a learner child row it merges only `settings.fontScale`, `settings.meaningView`, `settings.lastMasechta` (the masechta the child last opened) and `settings.libraryPlace` (where the child last read in the library); both are navigation state, never logged, see SERVER_PLAN.md §8.1. Records and events are unchanged, except for the parent fence. |
| LWW vs. parent edits | Parent writes are stamped with the server time and record `parent_rev`. A learner push whose `cursor < parent_rev` (the device hasn't pulled the edit) cannot overwrite it, whatever its clock says. Rows come back with `byParent: true`, and the new client then drops a pending local value for that key. A device that has seen the edit wins with its next learning, even if its clock runs behind. |
| Learner mode | No parent area, no long-press, no add-child, no import, no sign-out, no delete-account. It keeps: picking a child, learning, guest, the meaning view (already on the mishnah screen), a new "Aa" text-size sheet, and a small "Parent? Sign in as parent" link. |
| Future multiple logins | The PIN, the parent sessions and the log are keyed to `users.id`. Each session records `login_email` and a public `id`, and every log row records `actor_email` and `actor_session`. Adding a `user_emails` table later changes nothing here. Test and notice emails still go to `users.email`. |
| Out of scope | Several parents or emails, teacher roles, notification preferences, an offline parent mode, showing the test-email status from the server in parent mode. |

---

## 1. Conflicts between the proposals, and what we chose

| # | Security proposal | UX proposal | Decision |
|---|---|---|---|
| 1 | Request field `as` | `purpose` | **`as`**. A missing `as` means learner, so old SPAs keep working. |
| 2 | Parent session: 7 days sliding, 30 days at most | 14 days absolute | **14 days absolute.** It is simpler (no refresh path, no second limit) and clearly shorter than a learner session. The PIN plus the unlock window is what protects a device that is left around. |
| 3 | Unlock 5 min idle, 60 min at most, `/lock` on leaving | 5 min server window slid by a `/ping` | **Both, without a new endpoint.** Every parent request slides the window, `GET /api/parent/me` is the ping, and the 60 min cap stays. |
| 4 | Reset link = a `pin_reset` login request that mints a parent session with a 15-min "may set a PIN" window | A public `/parent-pin` page with its own token: lookup, then reset `{token, pin}` | **The UX shape, on a new `pin_resets` table.** It works from the test page on a device with no parent session, needs no 6-digit code and no extra session state (`pin_reset_until` is dropped), and a link scanner can't change anything because lookup only reads and the reset needs a typed PIN. |
| 5 | `parent_locked` = 403 | 401 | **403 `parent_locked`**: the session is valid and only the PIN is missing. 401 `unauthorized` means "no or expired parent session" (sign in by email). The parent client does not use `SyncEngine`, which drops a batch on a 403, so there is no conflict (§9.4). |
| 6 | Lockout sends an email | Log only | **Send the email** (best effort) and log it. The owner's point is that the parent notices. |
| 7 | Parent data: `/api/parent/sync` sharing the sync handler | A snapshot endpoint plus specific edit endpoints (reset-mishnah, reset-perek, children…) | **`/api/parent/sync`.** It reuses the store, mapping, diff, import and validation code that exist today: about six endpoints fewer, and one path for LWW. The only special endpoint is verifications, because they never travel in sync. |
| 8 | Learner may change `fontScale` and `meaningView` | `fontScale` only | **Both.** The learner already switches Simple and Steinsaltz on `MishnahScreen` (`onView` in `LearningApp.tsx`). It is a reading aid, not a power. (Later also `lastMasechta`: choosing a masechta on the perek map is navigation, not a power.) Breaks, name, emoji, colour and sort belong to the parent. |
| 9 | Fence plus a documented one-request gap | Fence | **Fence plus `byParent` on returned rows** (§8). The new client drops a pending value for a key when a parent-written row for it arrives. That closes the gap (a key edited while its push was in flight, or more than 500 pending rows) for new clients. Only old cached SPAs keep it. |
| 10 | Parent sync replaces record data, so a reset sends `chains: []` | n/a | **Parent writes take `excluded.data` exactly** (no keeping old `chains`), and the client's `resetPerek` writes `chains: []` explicitly (§8.3). `blankPerek()` today has no `chains` key, so the learner rule ("keep stored chains when the push has none") would quietly keep them. |
| 11 | Log rows for sync edits found in SQL by "this batch's rev" | n/a | **Built in JS from the pre-read and the pushed rows.** Parent writes are unconditional (server time, no LWW), so what was pushed is what was written. One pre-read (which already exists for the child cap) gives old names for "renamed" entries. |
| 12 | Iterations 5,000 | n/a | **5,000, stored on each row**, and rehashed on a successful check if the constant is raised later. Workers' PBKDF2 refuses more than 100,000 iterations, and the Free plan has about 10 ms of CPU. The AUTH_SECRET pepper plus the 5-try lockout is the real protection for a 4-digit space. |
| 13 | Weak PINs not mentioned | Refuse all-same digits, 1234 and 4321 | **Client only** (`weakPin` in `src/parent/pin.ts`). The server checks only `/^\d{4}$/`. Getting round the client gains nothing. |
| 14 | Notice email times in UTC | Client sends an IANA `tz` | **Send `tz`** (optional, validated with `Intl.DateTimeFormat`). If it is missing or invalid, the time is shown in UTC and labelled "UTC". |
| 15 | n/a | `POST /api/parent/learner-session` ("Use this device for learning") | **Keep.** Without it, a parent who signed in as parent on a tablet needs a second email to let a child learn there. Going down from parent to learner is not an upgrade. |

---

## 2. Threat model (what this does and doesn't stop)

The things this stops:
- **A child with the device.** Learner mode has no parent area. The parent cookie can't be used without the PIN, and the server enforces that on every parent route. A child who taps "Sign in as parent" needs the inbox.
- **A child with the parent's phone on the test page.** Confirm needs the PIN once one is set.
- **Guessing.** 5 tries in a row, shared across unlock and confirm, then a lock that only an email reset clears. On top of that, per-IP limits.
- **A child editing locally** (devtools, an old SPA). Learner sync can't create, delete or rename children. Verifications are never in a `SyncRequest`. Progress can't overwrite a parent's edit it hasn't seen.

The things it does not stop, on purpose:
- **Whoever controls the inbox controls everything.** A child who can read the parent's email can sign in as parent, reset the PIN and confirm tests. The answer is that someone finds out: the notice email goes out **before** the PIN changes, and every power appears in the change log with the login and the device.
- **Deliberate lockout.** A child can type 5 wrong PINs. The parent then gets an email and resets the PIN by email, and tests can't be confirmed until then. This is the price of a 4-digit PIN.
- **AUTH_SECRET rotation** invalidates every PIN, just as it does live login codes. Each account then resets its PIN by email.

---

## 3. Flows

### 3.1 First parent sign-in (new or existing account)
1. Login: tap "Sign in as parent", then enter the email and pass Turnstile. This calls `POST /api/auth/request {as:"parent"}`, and the parent sign-in email goes out.
2. The parent taps the link (`/auth/verify#token=…&as=parent`) and then "Sign in as parent on this device", which calls `verify-link`. Or they type the code, which calls `verify-code {as:"parent"}`. The response has `scope:"parent"`, and the `__Host-bp_parent` cookie is set (locked).
3. `GET /api/parent/me` returns `pin.set=false`, so the client shows the PIN setup: choose, then repeat. That calls `POST /api/parent/pin {pin, tz}`. The notice email is sent, then the PIN is stored and this session is unlocked.
4. Parent mode opens. A new account shows the "Add your first child" empty state.

### 3.2 Opening parent mode later
- **From learner mode** (the "Parent? Sign in as parent" link): the learner client runs `syncNow()` (waiting up to 3 s), then `GET /api/parent/me`.
  - 200: `POST /api/parent/lock`, then the PIN pad. "Always asks" holds even if the session was still unlocked.
  - 401: the parent email form, with the learner's email filled in and read-only.
- **At boot with no learner cookie but a parent cookie** (a parent's own phone): the parent shell opens locked and shows the PIN pad.
- PIN: `POST /api/parent/unlock {pin}`. This gives 5 min idle and 60 min at most.

### 3.3 Leaving and re-locking
- **"Back to learning", "Lock", or `pagehide`:** `fetch("/api/parent/lock", {method:"POST", keepalive:true})`, with no body. `originCheck` accepts it: Origin is sent, and Content-Length 0 means no JSON is needed.
- **Client timers:** no pointer or key input for 5 min, or the tab hidden for 60 s, triggers lock. The content unmounts at once, so no data stays visible behind the pad.
- **Server:** the window slides on every parent request (written at most once every 30 s), up to `unlocked_at + 60 min`. A lock call that never arrives is covered by the 5 min idle.
- **Ping:** `GET /api/parent/me`, at most once every 2 min, and only if there was input in the last 2 min. A parent who is reading and scrolling stays unlocked. An abandoned screen locks.

### 3.4 Forgot PIN
1. From the PIN pad or the locked screen: confirm, then `POST /api/parent/pin/forgot`. From the test page: `POST /api/perek-tests/forgot-pin {token}`.
2. The server supersedes older live reset links of the account, inserts a `pin_resets` row and emails `/parent-pin#t=<token>` to `users.email`.
3. `/parent-pin` is a public route outside the auth shell. On load it calls `POST /api/pin-reset/lookup {token}`, which only reads and shows the masked email. The parent types the new PIN twice, which calls `POST /api/pin-reset {token, pin, tz}`.
4. The server sends the notice email first, then in one batch:
   - consumes the token;
   - sets the PIN, with `failed=0` and `locked_at=NULL`;
   - clears the unlock on every parent session;
   - writes the log entry.
5. The parent goes back to the app, or to the test page, and enters the new PIN.

### 3.5 Confirming a test when a PIN is set
1. `/perek-test` calls lookup, which gives the info plus `pinRequired: true`.
2. "✅ {Name} knows it…" opens the PIN sheet. The 4th digit calls `confirm {token, pin}`.
3. A wrong PIN gives `invalid_pin` with `attemptsLeft`. A lock gives `pin_locked`, and the sheet offers "Email me a reset link".

### 3.6 A brand-new account that signs in as learner first
- The learner sees "No learners yet", with [🔑 Sign in as parent] and [👋 Learn as a guest].
- The choice screen also says under "Sign in as parent": "First time here? Start here."

---

## 4. Migration `migrations/0007_parent_mode.sql`

(Checked: this applies on top of 0001–0006 in SQLite 3.53, and the fence upsert in §8 behaves as specified.)

```sql
-- Parent mode (docs/PARENT_MODE.md). Additive: every existing session and login request becomes 'learner'.

-- Sessions: scope is set by the INSERT and never changed. Unlock state lives only on parent rows.
ALTER TABLE sessions ADD COLUMN scope TEXT NOT NULL DEFAULT 'learner' CHECK (scope IN ('learner', 'parent'));
ALTER TABLE sessions ADD COLUMN id TEXT;              -- public id for the change log (randomUUID); NULL on old rows
ALTER TABLE sessions ADD COLUMN login_email TEXT;     -- the address the sign-in went to (ready for several per account)
ALTER TABLE sessions ADD COLUMN unlocked_at INTEGER;  -- parent: when the PIN was last entered
ALTER TABLE sessions ADD COLUMN unlocked_until INTEGER; -- parent: idle re-lock deadline; NULL = locked

ALTER TABLE login_requests ADD COLUMN scope TEXT NOT NULL DEFAULT 'learner' CHECK (scope IN ('learner', 'parent'));
CREATE INDEX login_requests_email_scope_created ON login_requests (email, scope, created_at);

-- One PIN per ACCOUNT (not per login).
CREATE TABLE account_pins (
  user_id        TEXT PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  hash           TEXT NOT NULL,                 -- hex PBKDF2-SHA256(HMAC(AUTH_SECRET, "pin:"+user_id+":"+pin), salt)
  salt           TEXT NOT NULL,                 -- 16 random bytes, hex
  iterations     INTEGER NOT NULL,
  failed         INTEGER NOT NULL DEFAULT 0 CHECK (failed BETWEEN 0 AND 5), -- wrong tries in a row (reserved first)
  locked_at      INTEGER,                       -- set at the 5th wrong try; cleared only by setting a PIN via reset
  set_at         INTEGER NOT NULL,
  set_by_session TEXT                           -- sessions.id, NULL when set from a reset link
);

-- "Forgot PIN?" links. The token is never stored.
CREATE TABLE pin_resets (
  id                TEXT PRIMARY KEY,
  user_id           TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  email             TEXT NOT NULL,              -- where the link went (users.email today)
  token_hash        TEXT NOT NULL UNIQUE,
  created_at        INTEGER NOT NULL,
  expires_at        INTEGER NOT NULL,           -- created_at + 1 h
  consumed_at       INTEGER,                    -- used, superseded, or send failed
  requested_via     TEXT NOT NULL CHECK (requested_via IN ('parent', 'test_page')),
  requested_session TEXT                        -- sessions.id when requested from parent mode
);
CREATE INDEX pin_resets_user_created ON pin_resets (user_id, created_at);
CREATE INDEX pin_resets_expires ON pin_resets (expires_at);

-- The fence for parent edits (§8): the users.rev at which a parent last wrote the row. NULL = never.
ALTER TABLE progress ADD COLUMN parent_rev INTEGER;
ALTER TABLE children ADD COLUMN parent_rev INTEGER;

-- The change log shown in parent mode. Keyed to the account; the actor columns name the login.
CREATE TABLE audit_log (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  at            INTEGER NOT NULL,
  action        TEXT NOT NULL CHECK (action IN (
                  'pin_set', 'pin_changed', 'pin_reset', 'pin_failed', 'pin_locked',
                  'perek_verified', 'perek_unverified', 'progress_edited',
                  'child_added', 'child_removed', 'child_edited')),
  child_id      TEXT,                           -- no FK: the entry outlives the child
  child_name    TEXT,                           -- snapshot at the time
  detail        TEXT NOT NULL DEFAULT '{}',     -- JSON, shapes in §6.6
  via           TEXT NOT NULL CHECK (via IN ('parent', 'test_link', 'pin_reset_link')),
  actor_email   TEXT,                           -- sessions.login_email, or the address the link went to
  actor_session TEXT,                           -- sessions.id; NULL for links
  actor_device  TEXT                            -- User-Agent, cut to 200 chars
);
CREATE INDEX audit_log_user_at ON audit_log (user_id, at);
```

Cron (`worker/cron.ts`) adds:
- `DELETE FROM pin_resets WHERE expires_at < now - 1 day`;
- `DELETE FROM audit_log WHERE at < now - 365 days`.

Expired parent sessions already go with the existing `DELETE FROM sessions WHERE expires_at < now`.

---

## 5. Contract additions (`shared/api.ts`)

`shared/api.ts` is marked FIXED. All additions are additive and backward-compatible, and **need the owner's sign-off**, the same way §4 of PARENT_VERIFICATION did. Update its header comment to name this spec.

```ts
// ── ErrorCode: add
  | "parent_locked"   // 403 parent session valid, PIN not entered (or idle/expired unlock)
  | "pin_not_set"     // 409 unlock asked, but the account has no PIN yet
  | "pin_required"    // 400 perek-test confirm without `pin` on an account with a PIN
  | "invalid_pin"     // 400 wrong PIN (attemptsLeft set)
  | "pin_locked"      // 403 5 wrong tries; only a reset by email clears it
// ApiError.attemptsLeft: now also on invalid_pin.

export const PARENT = {
  PIN_LENGTH: 4,
  MAX_PIN_ATTEMPTS: 5,
  PIN_ITERATIONS: 5_000,
  SESSION_TTL_SEC: 14 * 24 * 60 * 60,  // absolute, from sign-in
  UNLOCK_IDLE_SEC: 5 * 60,
  UNLOCK_MAX_SEC: 60 * 60,
  PIN_RESET_TTL_SEC: 60 * 60,
} as const;

export type SignInAs = "learner" | "parent";

export interface AuthRequestBody { email: string; turnstileToken: string; /** Default "learner". */ as?: SignInAs; }
export interface VerifyCodeBody { email: string; code: string; /** Default "learner". */ as?: SignInAs; }
export interface AuthSuccessResponse {
  user: User; newUser: boolean;
  /** Which cookie was set; decided by the login request, never by the client. Absent from old servers = "learner". */
  scope?: SignInAs;
}

/** Shared by RecordRow and ChildRow in responses only (validators strip it from requests). */
//  RecordBase gains:  byParent?: true   // the last write to this row was a parent's (rev = parent_rev)
//  ChildRow gains:    byParent?: true

/** GET /api/parent/me, and the 200 body of unlock and pin. */
export interface ParentMeResponse {
  user: User;
  /** The address this parent session signed in with. */
  loginEmail: string;
  sessionExpiresAt: Ms;
  pin: { set: boolean; locked: boolean };
  /** null = locked. */
  unlockedUntil: Ms | null;
}
export interface PinBody { pin: string; }
/** POST /api/parent/pin and POST /api/pin-reset. `tz`: IANA zone for the notice email (display only). */
export interface SetPinBody { pin: string; tz?: string; }
export interface PinResetBody { token: string; pin: string; tz?: string; }
export interface PinResetInfo { email: string /* masked */; expiresAt: Ms; }

export interface SetVerificationsBody { masechta: string; perakim: number[]; verified: boolean; }
export interface SetVerificationsResponse { verifications: PerekVerificationRow[]; }

export type AuditAction =
  | "pin_set" | "pin_changed" | "pin_reset" | "pin_locked"
  | "perek_verified" | "perek_unverified" | "progress_edited"
  | "child_added" | "child_removed" | "child_edited";
export interface AuditEntry {
  id: string; at: Ms; action: AuditAction;
  childId: string | null; childName: string | null;
  detail: Record<string, unknown>;
  via: "parent" | "test_link" | "pin_reset_link";
  actorEmail: string | null;
  /** Raw User-Agent; the client shows deviceLabel(). */
  actorDevice: string | null;
}
export interface AuditLogResponse { entries: AuditEntry[]; nextBefore: Ms | null; }

// PerekTestTokenBody gains  pin?: string   (confirm only; lookup ignores it)
// PerekTestInfo gains       pinRequired?: boolean; pinLocked?: boolean   (optional: old servers)
```

There is also a new `shared/device.ts`: `deviceLabel(ua: string): string`, which turns a User-Agent into "Safari on iPhone", "Chrome on Android", "Chrome on Windows" or "a browser". It is pure, and the email and the change log both use it.

---

## 6. Server

### 6.1 Sessions (`worker/lib/session.ts`)

#### Cookies and creating a session
- **Cookie names:**
  - learner `cookieName(env)`: today's `__Host-bp_session`, or `bp_session` on http;
  - parent `parentCookieName(env)`: `__Host-bp_parent`, or `bp_parent` on http.
  - Both are httpOnly, Lax, path `/`, and secure on https.
- **`createSession(c, userId, scope, loginEmail)`:**
  - inserts `id = randomUUID()`, `scope` and `login_email`;
  - learner: `expires_at = t + 30 d`;
  - parent: `expires_at = t + 14 d`, with `unlocked_*` NULL;
  - sets the cookie for that scope (parent `maxAge` = 14 d).
- **No in-place upgrade.** No statement anywhere runs `UPDATE sessions SET scope`. A grep test enforces this (§11, test W3).

#### Middleware
- **`requireUser`** (learner) is unchanged, plus one condition: `AND s.scope = 'learner'`. It reads only the learner cookie.
- **`requireParentSession`** reads only the parent cookie and needs `scope = 'parent' AND expires_at > t`. It does not slide.
  - On a miss or an expiry it deletes the row and the cookie, and returns 401 `unauthorized`.
  - It sets `c.var.user` and `c.var.sessionHash`, plus `c.var.parent = { sessionId, loginEmail, unlockedAt, unlockedUntil, userAgent }`.
  - `AppEnv.Variables` gains `parent?: ParentVars`.
- **`requireParent`** = `requireParentSession` plus `unlocked_until > t AND unlocked_at > t - UNLOCK_MAX`. Otherwise 403 `parent_locked`.
  - When `unlocked_until - t < UNLOCK_IDLE - 30 s`, it runs `UPDATE sessions SET unlocked_until = min(t + IDLE, unlocked_at + MAX) WHERE token_hash = ? AND unlocked_until IS NOT NULL`.
- **`GET /api/parent/me`** slides the window the same way when the session is unlocked. This is the ping.
- **Wrong scope:** a learner token in the parent cookie, or a parent token in the learner cookie, finds a row of the wrong scope and gets 401.

#### Helpers
- `unlockStmt(sessionHash, t)`: sets `unlocked_at = t, unlocked_until = t + IDLE`.
- `lockAllParentStmt(userId, exceptHash?)`: sets `unlocked_until = NULL` on every parent session of the account, optionally except one.

### 6.2 Sign-in (`worker/routes/auth.ts`)

- **`POST /request`:**
  - `validateAuthRequest` accepts `as`, which must be "learner" or "parent" (default learner).
  - Limits:
    - `req-ip` 10/h, shared by both scopes (unchanged);
    - learner: `req-email` 5/h (the existing bucket name, so its counts carry over);
    - parent: `req-email-parent` 5/h.
  - Supersede only the same scope: `UPDATE login_requests SET consumed_at = ?1 WHERE email = ?2 AND scope = ?3 AND consumed_at IS NULL`. A child asking for a learner link does not kill the parent's link.
  - INSERT with `scope`.
  - Link: `${APP_ORIGIN}/auth/verify#token=…` for learner, and `…#token=…&as=parent` for parent. The `as` in the link is a display hint only.
  - Email: `loginEmail(link, code, scope)` (§6.8).
- **`POST /verify-link`:** `RETURNING email, scope`, then `finishLogin(c, email, t, scope)`.
- **`POST /verify-code`:** `validateVerifyCode` accepts `as` (default learner). It selects the newest live request `WHERE email = ?1 AND scope = ?3 …`. A code typed with the wrong scope finds nothing: `invalid_code`.
- **`finishLogin(c, email, t, scope)`:**
  - upsert the user as today;
  - `createSession(c, user.id, scope, email)`;
  - respond with `{user, newUser, scope}`;
  - the other scope's cookie is not touched.
- **`POST /logout`:** deletes the learner session and cookie only (unchanged).

### 6.3 PIN (`worker/lib/pin.ts`)

```ts
hashPin(secret, userId, pin, saltHex, iterations): Promise<string>
  // PBKDF2-SHA256, 256-bit output, password = HMAC(secret, "pin:"+userId+":"+pin) bytes
newPinRow(secret, userId, pin): Promise<{hash, salt, iterations}>   // salt = 16 CSPRNG bytes
checkPin(c, userId, pin, t): Promise<"ok">                          // throws HttpError
```

- Validation: `^[0-9]{4}$`. Otherwise 400 `bad_request` "The PIN must be 4 digits."
- **`checkPin`** is used by both unlock and confirm:
  1. **Reserve a try:** `UPDATE account_pins SET failed = failed + 1 WHERE user_id = ?1 AND locked_at IS NULL AND failed < 5 RETURNING failed, hash, salt, iterations`.
  2. **No row:** if `SELECT 1 FROM account_pins WHERE user_id` exists, it is locked: 403 `pin_locked` "Your parent PIN is locked. Reset it by email." Otherwise 409 `pin_not_set`.
  3. **Compute the hash** and compare with `safeEqualHex`.
  4. **Right:** `UPDATE account_pins SET failed = 0 WHERE user_id = ?1 AND locked_at IS NULL`. If `iterations < PARENT.PIN_ITERATIONS`, rehash in the same statement.
  5. **Wrong, `failed < 5`:** 400 `invalid_pin` "That PIN isn't right." with `attemptsLeft = 5 - failed`.
  6. **Wrong, `failed = 5`:** one batch:
     - `UPDATE account_pins SET locked_at = t WHERE user_id = ?1 AND locked_at IS NULL`;
     - `lockAllParentStmt(userId)`;
     - audit `pin_locked`, with via `parent` (unlock) or `test_link` (confirm).

     Then `waitUntil` sends the lock email to `users.email` (idempotency key `pin-locked-<userId>-<t>`). A send failure is logged and ignored. Respond 403 `pin_locked`.
- Reserving before checking keeps the total at 5 even under concurrent requests (test W7). It also means a right PIN can never be "lucky" past the lockout.
- **`setPinFlow(c, {userId, pin, tz, kind, via, actor})`** is shared by `POST /api/parent/pin` and `POST /api/pin-reset`:
  1. **Send the notice email first** to `users.email` (idempotency key `pin-notice-<userId>-<t>`). If it fails: 502 `email_failed` "We couldn't send the notice email, so the PIN wasn't changed. Try again in a minute." **Nothing changes**, so no change can ever go unannounced.
  2. **Then one batch:**
     - write the PIN (§6.4/§6.5 give the exact guard);
     - `lockAllParentStmt(userId, exceptHash)`;
     - unlock this session when there is one;
     - one audit row.
  3. If the guard finds the state changed in between (for example a first-time set racing another first-time set), respond 403 `parent_locked`. The email has gone out, which is acceptable: the parent is notified of an attempt rather than missing a change.

### 6.4 `worker/routes/parent.ts` (mounted at `/api/parent`)

Every route is listed with its middleware. Error bodies follow `ApiError`.

| Route | Guard | Behaviour |
|---|---|---|
| `GET /me` | parent session | `ParentMeResponse`. Slides the unlock if unlocked (the ping). |
| `POST /unlock {pin}` | parent session | `limit pin-ip` 20 / 15 min. No PIN: 409 `pin_not_set`. Otherwise `checkPin`, then `unlockStmt`, then 200 `ParentMeResponse`. |
| `POST /lock` | parent session | No body. `unlocked_until = NULL`, then 204. A missing or expired session also gives 204 (it is a beacon). |
| `POST /pin {pin, tz?}` | parent session | `limit pin-set` 10/h per account. **Allowed when** there is no PIN yet (kind `set`) or the session is unlocked (kind `changed`). Otherwise 403 `parent_locked`. A locked PIN (`locked_at` set) can only be cleared by a reset link: 403 `pin_locked`. Then `setPinFlow` with via `parent`. Write guard: for `set`, `INSERT … ON CONFLICT(user_id) DO NOTHING RETURNING user_id`; for `changed`, `UPDATE account_pins SET hash, salt, iterations, failed = 0, set_at, set_by_session WHERE user_id = ?1 AND locked_at IS NULL`. 200 `ParentMeResponse`, now unlocked. |
| `POST /pin/forgot` | parent session (locked is fine) | Limits: `pin-forgot` 3/h and `pin-forgot-day` 6/day per account, and `pin-forgot-ip` 10/h. No Turnstile, because the caller has a session. `createPinReset(c, userId, 'parent', sessionId)`, then 200 `{ ok: true, sentTo: maskEmail(users.email) }`. |
| `POST /logout` | none (reads the parent cookie) | Deletes the parent session and cookie only. 204. |
| `POST /learner-session` | **unlocked** | Deletes this device's current learner session row (if it has a learner cookie), then `createSession(c, userId, 'learner', loginEmail)`. 200 `MeResponse`. |
| `POST /sync` | **unlocked** | `runSync(c, "parent")`, §6.7. |
| `GET /children/:id/events`, `GET /children/:id/stats` | **unlocked** | Moved unchanged from `worker/routes/children.ts`. That file becomes `parentChildrenRoutes` mounted under `/api/parent/children`, and the old `/api/children` mount is removed. |
| `POST /children/:id/verifications` | **unlocked** | §6.5. |
| `GET /log?before&limit` | **unlocked** | `limit` 1–100 (default 30), newest first: `WHERE user_id = ?1 AND at < ?2 ORDER BY at DESC, id DESC LIMIT ?3+1`. Returns `AuditLogResponse`. |
| `DELETE /account {email}` | **unlocked** | Moved from `/api/account`. The email must equal `users.email`. The existing batch, plus `DELETE FROM account_pins`, `pin_resets` and `audit_log WHERE user_id`. `DELETE FROM sessions WHERE user_id` already removes both scopes. Clears both cookies. 204. |

`createPinReset(c, userId, via, sessionId|null)`:
1. `UPDATE pin_resets SET consumed_at = t WHERE user_id = ? AND consumed_at IS NULL`.
2. INSERT a row (`expires_at = t + 1 h`).
3. Send `pinResetEmail(link)` with idempotency key `pin-reset-<id>`.
4. If the send fails: mark the row consumed, then 502 `email_failed`.

**Not changed:**
- `GET /api/me` (learner);
- `POST /api/perek-tests` (the child asks for the test email, with a learner session).

**Removed:**
- `DELETE /api/account`;
- `/api/children/*`. Both now fall through to the 404 `not_found` catch-all. Old SPAs see an error in their parent area, which is acceptable (§10).

### 6.5 Marking perakim verified or unverified (`POST /api/parent/children/:id/verifications`)

1. **Validate** with `validateSetVerifications`:
   - `masechta` must be known (`masechtaText`);
   - `perakim` must be 1–30 distinct integers, each in `1..perakimCount(masechta)`;
   - `verified` must be a boolean.

   Otherwise 400 `bad_request`.
2. **Limit:** `verif` 120/h per account.
3. **Child:** `SELECT data FROM children WHERE id = ?1 AND user_id = ?2 AND deleted = 0`. Missing, deleted or another account's: 404 `not_found`.
4. **One `db.batch`:**
   - for each perek, `setVerificationStmts(db, {userId, childId, masechta, perek, verified, source: "admin", testId: null, t})`;
   - one audit row: action `perek_verified` or `perek_unverified`, `child_name` from the meta, detail `{ masechta, perakim }` (sorted), via `parent`, plus the actor columns;
   - a final `SELECT … FROM perek_verifications WHERE child_id = ?1 AND masechta = ?2 AND perek IN (…)`.
5. **Respond** `SetVerificationsResponse` with the rows, so the parent UI updates without a sync.

Behaviour is unchanged from `setVerificationStmts`:
- **Verify:** the rev is bumped, the row is upserted at that rev, and live test links for that perek become `covered`.
- **Un-verify:** the row is kept with `verified = 0` (so it syncs down), `verified_at` is kept as history, and live links become `revoked`, so an old email can't silently re-verify.
- **Learner devices** get the row on their next pull. The client lock is derived with no latch (PARENT_VERIFICATION §11), so un-verifying perek k re-locks the perakim after it.
- **Any perek can be marked.** The frontier rule still applies on the client. The parent UI warns when an earlier perek is unverified (§9.8).

Update the header comment of `worker/lib/verification.ts`:

> The ONLY writer of perek_verifications. Callers: the confirm route (token-keyed; the parent's PIN once one is set) and `POST /api/parent/children/:id/verifications` (keyed form, source 'admin'). That route sits behind `requireParent`: a parent session from an email sign-in as parent, unlocked with the PIN in the last 5 minutes. That is the owner's accepted proof for `verified: true` (docs/PARENT_MODE.md). Never call the keyed form from a route a learner session can reach.

### 6.6 Change log rows

`worker/lib/audit.ts` exports `auditStmt(db, {userId, at, action, childId?, childName?, detail, via, actor})`, where `actor = {email, sessionId, device}`. `id` is a random UUID, and the device is the User-Agent cut to 200 chars.

| action | Written by | via | detail |
|---|---|---|---|
| `pin_set` | first `POST /parent/pin` | parent | `{}` |
| `pin_changed` | `POST /parent/pin` while unlocked | parent | `{}` |
| `pin_reset` | `POST /pin-reset` | pin_reset_link | `{ requestedVia: "parent" \| "test_page" }` |
| `pin_failed` | wrong tries 1 to 4 of `checkPin` (one row each, so a right entry resetting the counter never hides guesses; unlock also returns `wrongTries` and parent mode shows it) | parent or test_link | `{attemptsLeft}` |
| `pin_locked` | the 5th wrong `checkPin` | parent or test_link | `{}` |
| `perek_verified` / `perek_unverified` | the verifications route | parent | `{ masechta, perakim: number[] }` |
| `perek_verified` | confirm | test_link | `{ masechta, perakim: [perek], testId, pinUsed: boolean }` |
| `progress_edited` | parent sync, one row per child with record writes (not for a child added in the same batch) | parent | `{ keys: string[] /* "m:2:3", "p:2", max 60 */, count }` |
| `child_added` | parent sync, a new child id | parent | `{ imported: boolean, rows: number }`. `imported` is true when the same batch carries records for it. |
| `child_removed` | parent sync, live to `deleted: true` | parent | `{}` |
| `child_edited` | parent sync, a meta change on a live child | parent | `{ fields: string[], from?: {name}, to?: {name} }`. `fields` comes from `name, emoji, color, sort, settings.*`. Sort-only changes are not logged. |

**Actor columns:**
- parent routes: `actor_email = login_email`, `actor_session = sessions.id`;
- test link: `actor_email` = the account email (where the link went), `actor_session = NULL`;
- reset link: `actor_email = pin_resets.email`, `actor_session = NULL`.

**Confirm's log row** goes in the confirm batch, after `confirmTokenStmts` and before the lookup. It uses the same "this call consumed it" match:

```sql
INSERT INTO audit_log (id, user_id, at, action, child_id, child_name, detail, via, actor_email, actor_session, actor_device)
SELECT ?3, pt.user_id, ?2, 'perek_verified', pt.child_id, json_extract(c.data, '$.name'),
       json_object('masechta', pt.masechta, 'perakim', json_array(pt.perek), 'testId', pt.id, 'pinUsed', json(?4)),
       'test_link', u.email, NULL, ?5
FROM perek_tests pt JOIN children c ON c.id = pt.child_id JOIN users u ON u.id = pt.user_id
WHERE pt.token_hash = ?1 AND pt.consumed_at = ?2 AND pt.outcome = 'verified'
```

### 6.7 Sync: one handler, two roles (`worker/routes/sync.ts`)

`syncRoutes.post("/sync", requireUser, (c) => runSync(c, "learner"))`, and `parentRoutes.post("/sync", requireParent, (c) => runSync(c, "parent"))`.

These stay the same for both roles:
- validation;
- the ownership pre-check;
- the pull queries;
- the tombstone purge;
- the response shape.

Every pulled or echoed progress and child row now also selects `(parent_rev IS NOT NULL AND rev = parent_rev) AS by_parent`. When that is 1, `toRecordRow` and `toChildRow` add `byParent: true`.

**Learner (`role = "learner"`):**
- **Child rows:**
  - a new id is ignored;
  - `deleted: true` is ignored;
  - for an existing live child, only `settings.fontScale`, `settings.meaningView`, `settings.lastMasechta` and `settings.libraryPlace` (when present) are merged;
  - the child cap check is skipped, since learners can't add children.

  The merge statement:
  ```sql
  UPDATE children
  SET data = json_set(data, '$.settings', json(json_patch(json_extract(data, '$.settings'), ?3))),
      updated_at = ?4, rev = (SELECT rev FROM users WHERE id = ?2)
  WHERE id = ?1 AND user_id = ?2 AND deleted = 0
    AND (parent_rev IS NULL OR ?5 >= parent_rev)
    AND (?4 > updated_at OR rev = parent_rev)
  ```
  `?3` is the JSON patch `{fontScale, meaningView?, lastMasechta?, libraryPlace?}` built in JS from the validated meta, `?4` the clamped `updatedAt`, `?5` the request cursor.

  The existing "(b) echo" query already returns the server's version of every pushed child row, so an old SPA's rename or settings change is corrected on its device.
- **Ignored deletes:** for every pushed child row with `deleted: true` whose server row is live, the response also carries **all that child's progress rows and all its verification rows**. An old SPA that deleted a child locally gets the child back from the echo, and `applyServerResponse` refills its progress (children are applied before records). Without this it would recreate a blank child and its next learning would overwrite real progress with progress built from a blank start.
- **Records:** today's upsert, plus the fence (§8.1). The cursor is bound as `?7`.
- **Events:** unchanged.

**Parent (`role = "parent"`):**
- **The pre-read** that exists for the child cap becomes `SELECT id, deleted, data FROM children WHERE user_id = ?1`. It gives the cap, the old names, and new vs. existing for the log.
- **Children:**
  - added, edited and deleted as today;
  - tombstones are final;
  - the 50-child cap stays;
  - `updated_at = t` (server time) on every write;
  - `parent_rev = rev` of this batch;
  - no LWW condition, except `children.deleted = 0`.
- **Records:**
  - `updated_at = t`, `parent_rev = rev`;
  - `data = excluded.data` exactly (no keeping old `chains`);
  - no LWW condition;
  - written only for live children, as today.
- **Events:** accepted as today. The parent UI sends `reset` events (§9.7).
- **Log:** the §6.6 rows are built in JS and added to the same batch.
- **Import** (device or backup) arrives as new children plus their records in one or more batches. The client splits the batches with `takeBatch`, so the 500-row limit still holds.

### 6.8 Emails (`worker/email/`)

All use the `loginEmail.ts` card layout and colours, with an HTML and a text version. `escapeHtml` comes from `html.ts`. Every string goes through the "fun/game/play" test (§11, test W18).

**Parent sign-in** (`loginEmail(link, code, "parent")`; the learner email is unchanged):
- Subject: `{code} is your Mishnah Ba'al Peh parent sign-in code`
- Body:
  - "Parent sign-in to Mishnah Ba'al Peh"
  - "Tap this button to open parent mode on the device where you open it:" [Sign in as parent]
  - "Or type this code in the app: {123 456}"
  - "You'll enter your 4-digit parent PIN next."
  - "The link and code work once and expire in 15 minutes. Only the newest email works."
  - "If you didn't ask for this, you can ignore it. No one can change anything in parent mode without your PIN."
  - Small print: "If the button doesn't work, open this link: {link}"

**PIN reset** (`pinResetEmail.ts`):
- Subject: `Choose a new parent PIN for Mishnah Ba'al Peh`
- Body:
  - H: "Choose a new parent PIN"
  - "Someone tapped "Forgot PIN?" for {email}. Tap the button to choose a new 4-digit PIN:" [Choose a new PIN] → `${APP_ORIGIN}/parent-pin#t=<token>`
  - "The link works once and expires in 1 hour. Only the newest email works."
  - "If you didn't ask for this, you can ignore it. Your PIN stays the same."
  - "Whenever the parent PIN changes, we'll email you."
  - Small print: "If the button doesn't work, open this link: {link}"

**PIN notice** (`pinNoticeEmail.ts`, with no link token in it):
- Subject: `Your parent PIN was changed`
- Body:
  - H: "Your parent PIN was changed"
  - "The parent PIN for Mishnah Ba'al Peh ({account email}) was {set for the first time | changed in parent mode | reset with an email link} on {Friday, November 6, 2026 at 9:41 PM} ({America/New_York | UTC})."
  - "Signed in as: {login email}" (omitted for a reset link)
  - "Device: {deviceLabel(ua)}"
  - "If this was you, there's nothing to do."
  - "If it wasn't, someone may have used a parent's phone or email. Open {APP_ORIGIN}, tap "Sign in as parent", then "Forgot PIN?" to choose a new one, and look at the change log in parent mode."
- Time: `Intl.DateTimeFormat("en-US", {dateStyle:"full", timeStyle:"short", timeZone: tz})`. A missing tz, or one that throws, means "UTC".

**PIN locked** (`pinLockedEmail.ts`):
- Subject: `Your parent PIN was locked`
- Body:
  - "Someone typed a wrong parent PIN 5 times, on {time} ({tz or UTC}), {in parent mode | on a perek test page}. Device: {device}."
  - "The PIN is locked. Parent mode and test confirmations need a new PIN."
  - "To choose one, open {APP_ORIGIN}, tap "Sign in as parent", then "Forgot PIN?"."

The tz for this email is the zone the client last sent with a PIN action, or UTC; the server does not store it. Use UTC unless the request carried `tz`.

### 6.9 Perek-test page (`worker/routes/perekTests.ts`)

- **`POST /lookup`** stays PIN-free. Its SQL adds `LEFT JOIN account_pins ap ON ap.user_id = pt.user_id`, and the response carries:
  - `pinRequired: ap.user_id IS NOT NULL`;
  - `pinLocked: ap.locked_at IS NOT NULL`.
- **`POST /confirm {token, pin?}`** (`validateToken` is extended with an optional `pin` matching `^\d{4}$`):
  1. `tokenHashOf` (the `ptest-ip` limit, as today).
  2. Read `LOOKUP_SQL` (with the PIN join). If `toInfo` gives anything other than `pending` (invalid, expired, or verified, which is idempotent), answer exactly as today and ask for no PIN. A bad or used link never uses up PIN tries.
  3. If the account has a PIN:
     - a locked PIN: 403 `pin_locked`;
     - no `pin`: 400 `pin_required` "Enter your parent PIN.";
     - otherwise `limit pin-ip` 20 / 15 min, then `checkPin` (the same counter as unlock).
  4. `db.batch([...confirmTokenStmts(db, h, t), confirmAuditStmt, LOOKUP])`, then respond as today.
- **`POST /forgot-pin {token}`** (new):
  - `ptest-ip` limit;
  - the token must be live and pending (otherwise `invalid_link`);
  - then the same per-account and per-IP limits as `/parent/pin/forgot`, and `createPinReset(c, pt.user_id, 'test_page', null)`;
  - 200 `{ ok: true, sentTo }`.

The client's `failKind` treats `bad_request` and `invalid_link` as an invalid link. The new codes are distinct, so they don't collide.

### 6.10 PIN reset routes (`worker/routes/pinReset.ts`, mounted at `/api/pin-reset`, no session)

- **`POST /lookup {token}`:**
  - `limit pin-reset-ip` 20 / 15 min;
  - live means `consumed_at IS NULL AND expires_at > t`;
  - returns `PinResetInfo` with `maskEmail(email)`;
  - otherwise 400 `invalid_link` "This link has expired or was already used." Read-only.
- **`POST / {token, pin, tz?}`:**
  - the same limit, then validation;
  - read the live row (`invalid_link` otherwise);
  - `setPinFlow` with kind `reset` and via `pin_reset_link`. The batch:
    1. `UPDATE pin_resets SET consumed_at = ?t WHERE token_hash = ?h AND consumed_at IS NULL AND expires_at > ?t`
    2. `INSERT INTO account_pins (…) SELECT … FROM pin_resets WHERE token_hash = ?h AND consumed_at = ?t ON CONFLICT(user_id) DO UPDATE SET hash, salt, iterations, failed = 0, locked_at = NULL, set_at, set_by_session = NULL`
    3. `UPDATE sessions SET unlocked_until = NULL WHERE user_id = ?u AND scope = 'parent'`
    4. the audit row, `INSERT … SELECT … WHERE` the same "consumed by this call" match
    5. `SELECT changes()`-free check: `SELECT 1 FROM pin_resets WHERE token_hash = ?h AND consumed_at = ?t`. If it is empty, respond 400 `invalid_link`.
  - 204.
  - A reset does **not** end parent sessions. It clears their unlock, so they need the new PIN.

### 6.11 Wiring (`worker/index.ts`)

```ts
app.route("/api/auth", authRoutes);
app.route("/api", meRoutes);                 // GET /me only (DELETE /account moved)
app.route("/api", syncRoutes);               // POST /sync (learner)
app.route("/api/parent", parentRoutes);      // §6.4, includes /children/* and /sync
app.route("/api/pin-reset", pinResetRoutes); // public
app.route("/api/perek-tests", perekTestRoutes);
```

### 6.12 Rate limits (all `limit()`, fixed windows in `rate_limits`; subjects are HMAC'd as today)

| Bucket | Subject | Max / window | Where |
|---|---|---|---|
| `req-ip` | IP | 10 / 1 h | auth/request (both scopes, unchanged) |
| `req-email` / `req-email-parent` | email | 5 / 1 h each | auth/request, learner / parent |
| `link-ip`, `code-ip`, `code-email` | | unchanged | verify-link, verify-code |
| `pin-ip` | IP | 20 / 15 min | parent/unlock; perek-tests/confirm when a PIN is checked |
| account PIN counter | account | 5 wrong in a row, then locked | `account_pins.failed`; shared by unlock and confirm |
| `pin-set` | user id | 10 / 1 h | parent/pin |
| `pin-forgot` / `pin-forgot-day` | user id | 3 / 1 h, 6 / 24 h | parent/pin/forgot, perek-tests/forgot-pin |
| `pin-forgot-ip` | IP | 10 / 1 h | both forgot routes |
| `pin-reset-ip` | IP | 20 / 15 min | pin-reset lookup and set |
| `ptest-ip` | IP | 30 / 15 min | perek-tests lookup, confirm, forgot-pin (unchanged) |
| `verif` | user id | 120 / 1 h | parent/children/:id/verifications |
| `learner-sess` | user id | 10 / 1 h | parent/learner-session |

---

## 7. Security model, in one place

1. **The proof of each power:**
   - **parent powers:** a `scope='parent'` session (made only by consuming a `scope='parent'` login request, which needs the inbox) plus a PIN entered in the last 5 min idle / 60 min absolute (checked on the server);
   - **a test confirm:** the emailed token plus the PIN once one is set;
   - **a PIN reset:** the emailed reset token.
2. **Independence:**
   - each middleware reads one cookie name and checks `scope`;
   - nothing ever updates `scope`;
   - a learner session gives no parent power, and a parent session gives no learner route either (`requireUser` refuses it). So parent mode can't open a learning screen through the API.
3. **The PIN at rest:** only the PBKDF2 hash plus salt plus iterations, with the AUTH_SECRET pepper. The same PIN on two accounts gives different hashes (salt and user id). The PIN never appears in logs. The rate-limit subjects for `pin-ip` are IPs, not PINs.
4. **Lockout:** reserve-then-check, a hard limit of 5, and a lock that only a reset link clears. Locking also clears every unlock.
5. **Notices:** PIN set, changed or reset is emailed before it is committed, and refused if the email fails. A lockout is emailed best effort. Everything is logged with the login, the session id and the device.
6. **CSRF:** unchanged. `originCheck` covers every new POST and DELETE. The lock beacon is a same-origin `fetch` with keepalive and no body.
7. **Scanners:** no GET changes state. `/parent-pin` and `/perek-test` only read on load. Setting a PIN needs a typed PIN, and confirming needs a tap (plus the PIN).
8. **Enumeration:**
   - `pin-reset/lookup` gives the same `invalid_link` answer for every failure;
   - `auth/request` is still always 200;
   - forgot routes answer `sentTo` masked.
9. **Data the parent UI shows** comes from `/api/parent/*` only. The learner client never holds the change log, the stats or another account's data.

---

## 8. Sync and LWW with parent edits

### 8.1 The fence (learner record upsert in `/api/sync`)

```sql
ON CONFLICT(child_id, kind, key) DO UPDATE SET
  data = <today's CASE keeping chains>, updated_at = excluded.updated_at, rev = excluded.rev
WHERE (progress.parent_rev IS NULL OR ?7 >= progress.parent_rev)                -- the device has pulled the parent's write
  AND (excluded.updated_at > progress.updated_at OR progress.rev = progress.parent_rev) -- LWW, or the causal override
```

`?7` is the request cursor: the highest rev this device has pulled. Every parent write sets `rev = parent_rev = R`.

1. **The child tablet is offline while the parent marks 2:3 not known.**
   - At 10:00 (server time) the parent makes the edit, and the row has `rev = parent_rev = R`.
   - The tablet is still at cursor `c < R`. It practises 2:3 at 10:30 by its clock and syncs at 11:00.
   - The `?7 >= parent_rev` test fails, so the push is **skipped** (a normal LWW loss), even if the tablet's clock runs days ahead.
   - The response carries the parent's row (rev > cursor, and the pushed-row echo) with `byParent: true`. `clearSent` drops the sent value and the client adopts the parent's row.
   - The child's offline practice on that one mishnah is dropped, which is what the parent asked for. Its events still reach Activity.
2. **After the tablet has pulled** (`cursor ≥ R`), its next learning on 2:3 **wins**, even if its clock is behind the parent's server time. `progress.rev = progress.parent_rev` means the last write was the parent's, and the device has seen it.
   - After that one learner write, `rev ≠ parent_rev`, and plain LWW resumes.
3. **Other keys** of the same child are unaffected. The fence is per row.
4. **Child-settings merge** uses the same two conditions on `children.parent_rev` (§6.7). A parent's rename, breaks change or delete can never be undone by a stale learner device, and the learner keeps text size and meaning view.
5. **Parent writes ignore client clocks** (`updated_at = t`). Learner clocks are already clamped to the server's `t`. So clock skew does not matter for parent edits in either direction.
6. **`verifSchema` catch-up:** a device whose store predates verifications sends `cursor: 0` until its first pull. Its first push is fenced on every parent-edited key, which is correct: it has not seen them.

### 8.2 The client half: `byParent`

`applyServerResponse` (`src/sync/store.ts`) changes in one place. Today a server row is skipped when its key is pending.

The new rule: **a row with `byParent: true` wins over a pending local value for the same key.** Delete the pending entry and apply the row.

This is always right, because a `byParent` row reaches a client only when:
- the client hasn't pulled it before (rev > cursor), so the pending value was made without seeing the parent's edit; or
- it is the echo of a push the fence just refused.

The same rule applies to child rows. This closes the gap where a key is pending but was not in the batch that pulled the parent's row:
- it was edited again while its push was in flight;
- or the device had more than 500 pending rows.

Without the rule, that value would later go out with a cursor ≥ R and win.

Test C2 covers the in-flight case and the over-500 case.

### 8.3 What the parent client sends

- **Mark mishnah not known:**
  - `resetMishnah(p, perek, mishnah)` (existing) writes `blankMishnah()` for that key;
  - plus a `reset` event `{perek, mishnah}`. Activity already shows it as "Parent reset 2:3".
- **Reset a perek:** new pure `resetPerek(p, perek)` in `src/progress.ts`:
  - `blankMishnah()` for every mishnah of the perek;
  - `perakim[k] = { chainedThrough: 0, complete: false, chains: [] }` (an explicit `chains: []`);
  - one `reset` event per mishnah.

  `diffProfiles` never sends removed keys, so a reset must write blank values, never delete keys.
- **Child add, edit, delete, import:** the existing `newProfile`, settings edits, delete (tombstone) and `importLegacy`/`copyAsNew`, all through `applyLocalEdit` on the parent's in-memory store.
- **Verifications:** never through sync. They go through §6.5 and come back in its response. Learner devices get them in `SyncResponse.verifications`.

### 8.4 Known effects, documented for the owner

- **A parent who edits from a view that is out of date wins.** That is intended, and it is logged.
  - Example: the parent renames a child while that child's tablet changes text size. The rename's full meta carries the parent's stale `fontScale`.
  - That one setting reverts. The child can set it again.
  - Only the child the parent edited is affected: adding or removing a child sends no rows for its siblings (`diffProfiles` ignores a shifted index while the kept children stay in order, so `sort` may have gaps or ties; it only orders the list).
- **First PIN:** a parent session can choose the first PIN only within `PARENT.FIRST_PIN_WINDOW_SEC` (15 min) of its email sign-in. After that, `/me` and `/pin` end a PIN-less session (401), so whoever holds the device must sign in by email again. Leaving PIN setup also ends the session (`/logout`).
- **Old cached SPAs** don't have `byParent`. For them the fence still blocks a stale push. The narrow gaps are a key edited during the in-flight request, or over 500 pending rows: that value later goes out with a newer cursor and can overwrite the parent's edit. The same applies to a second old-SPA device that held a pending value from before it pulled. The SW update bar closes this once the device updates.

---

## 9. Client

### 9.1 Boot and routing (`src/App.tsx`)

**Path routes outside `AuthShell`:**
- `/perek-test` (as today);
- `/licenses` (as today);
- **`/parent-pin`** (new): `PinResetLanding`, token from `#t=`, read and stripped by `takePinResetToken()` just like `takePerekTestToken`.

**`AuthShell` phases:**

```ts
| { phase: "boot" }
| { phase: "verify"; token: string; as: SignInAs }      // `as` from the link fragment: display only
| { phase: "choose"; reason?: "expired" }               // login choice
| { phase: "login"; as: SignInAs; reason?: "expired"; email?: string; lockEmail?: boolean }
| { phase: "checkEmail"; as: SignInAs; email: string }
| { phase: "offlineNoAccount" } | { phase: "guest" }
| { phase: "app"; user: User }                          // learner
| { phase: "parent"; me: ParentMeResponse; learner: User | null } // parent shell (handles locked, setup, unlocked)
```

**Boot order:**
1. A cached learner user goes to `app` (offline works as today), with `/api/me` in the background.
2. Otherwise `/api/me`:
   - 200: `app`;
   - 401: `/api/parent/me`. 200 goes to `parent` (locked unless `unlockedUntil` is set; the shell still calls `/lock` first, §3.2). 401 goes to `choose`.
3. A network error goes to `offlineNoAccount` (as today).

**Routing after sign-in:**
- Verify success with `scope: "parent"` goes to `parent`.
- With `scope` absent or `"learner"`, it goes to `app` (as today).
- A learner `signedOut` (expired) goes to `login {as:"learner", reason:"expired", email}`, skipping the choice (as today).
- Guest mode is unchanged. Its "Sign in" goes to boot (as today), which ends at `choose` when there is no session.

### 9.2 Login choice and email step (`src/auth/Login.tsx`)

**Step 1, `Choose` (new export):**
- `AuthFrame` with the title as today.
- If `reason === "expired"`: notice "Your sign-in expired. Please sign in again."
- H2: **"Welcome"**
- Two big stacked buttons (full width, at least 64 px tall):
  - **[📖 Sign in as learner]**, sub-line "For children learning on this device"
  - **[🔑 Sign in as parent]**, sub-line "Add children, see progress, change settings. First time here? Start here."
- Below them: `PricingNote`, then `GuestOption` (unchanged).

**Step 2, `Login {as}`:**
- The existing form. H2 is "Learner sign-in" or "Parent sign-in", with a "‹ Back" link-button to the choice.
- Hints:
  - learner: "Use your family's account email. We'll email a sign-in link and a code to it. No password needed."
  - parent: "We'll email you a parent sign-in link and a code. Then you'll enter your 4-digit parent PIN, or choose one the first time."
- With `lockEmail` (coming from learner mode): the email input is read-only, with the hint "We'll send it to {email}." and a small "Different account? Sign this device out in parent mode first."
- The button stays "Send me a sign-in email". It calls `api.requestLogin({email, turnstileToken, as})`.

**`CheckEmail`:**
- Copy unchanged, plus a first line: "Parent sign-in for {email}" or "Learner sign-in for {email}".
- `verifyCode({email, code, as})`.

**`VerifyLanding`:**
- `takeVerifyToken()` also returns `as` from `&as=parent`.
- Parent: H2 "Open parent mode on this device?", button **[Sign in as parent on this device]**.
- Learner: today's copy.
- The response's `scope` decides where to go.

### 9.3 Learner mode after the change

**`src/screens/Profiles.tsx`:**
- Remove `HoldButton`, the first-run add-child form, `onAdd` and `onParent`.
- Keep the sync dot, "Who's learning?", the tiles and the Guest tile.
- **No children, not loading:**
  - H2: "No learners yet."
  - Hint: "Ask Abba or Ima to add you in parent mode. Then you can begin learning here."
  - Buttons: **[🔑 Sign in as parent]**, and below an "or" divider the existing guest button "👋 Learn as a guest (nothing saved)".
- At the bottom, a small muted link-button: **"Parent? Sign in as parent"**, which calls `onParentSignIn`.
- **One-time note**, once per device, closable. kv key `baalpeh:parentModeNote`; try/catch as elsewhere.
  - "Parents now have their own sign-in, with a 4-digit PIN. A parent can tap "Parent? Sign in as parent" below." [OK]
  - Shown only when the account has at least one child (existing families).

**`src/LearningApp.tsx`:**
- Remove the `"parent"` screen, the `Parent` import, `ImportPrompt` and its state, and `onAdd`.
- New prop `onParentSignIn(user)`: `await Promise.race([account.syncNow(), sleep(3000)])`, then the shell does §3.2.
- `PerekTestApi.onParentArea` is removed.

**`src/components/PerekReady.tsx`, signedOut view:**
- The H2 stays: "Ask Abba or Ima to sign in again, then you can send your test."
- The button becomes **[Sign in again]**, which calls `test.onSignInAgain()`. That leads to the learner login with the email prefilled.

**Text size** (`src/screens/Home.tsx`):
- An **"Aa"** button in the top bar (`aria-label="Text size"`) opens a small sheet.
- Sheet:
  - H3: "Text size"
  - The 0.8–1.6 slider (step 0.1, the same input as today's parent card).
  - A sample line in Hebrew at that scale: the first words of the masechta's first mishnah, from the loaded data.
  - [Done]
- It writes `settings.fontScale` through `setProfiles`, which is a normal learner sync, merged by §6.7.
- The meaning view stays on `MishnahScreen` as today.

**Removed from learner mode:** sign-out, delete account, backup, child settings (name, picture, breaks), mishnah reset, perek-test list, history. All of them move to parent mode.

### 9.4 Parent shell (`src/parent/ParentApp.tsx`, replaces `src/screens/Parent.tsx`)

#### State
`useParent(me)` (`src/parent/useParent.ts`) holds an **in-memory** `AccountStore` built with `emptyStore(me.user)`. It is never `saveStore`d and never touches `CURRENT_KEY`.
- **On unlock:** `parentSync()` with cursor 0 (a full pull: profiles, verifications).
- **`edit(next)`:** `applyLocalEdit`, then `parentSync()` right away.
- **`parentSync()`:**
  - single-flight;
  - loops `takeBatch`, then `api.parentSync`, then `applyServerResponse` until nothing is pending (the same pure helpers as the engine);
  - shows "Saving…" while it runs.
- **Errors:**
  - 403 `parent_locked`: show the PIN pad over the current place. Pending is kept in memory, and the sync retries after unlock.
  - 401: `onSignedOut()`, which goes to `login {as:"parent"}`.
  - network: "You're offline. Your last change hasn't been saved. [Retry]".
  - 400 / 413: drop the batch and show "That change couldn't be saved."
- **Leaving with pending > 0:** confirm "Some changes haven't been saved yet. Leave anyway?"
- **Locking** unmounts the tab content but keeps the store (the hook lives above the overlay). Unlocking restores the last tab and child.

#### Screens
- **Locked or setup:**
  - `!me.pin.set`: first-time setup (§9.6).
  - `me.pin.locked`: the locked screen (§9.5).
  - Otherwise the PIN pad, H2 "Enter your parent PIN", with **[‹ Back to learning]** (only when a learner session exists) and "Forgot PIN?".
- **Top bar:** "Parent mode", plus `loginEmail` in small grey. On the right, **[🔒 Lock]**.
- **Tabs** (segmented control): **Children · Change log · Settings**. There is no learning screen and no link into one.
- **Bottom of every tab:**
  - With a learner session for the same account (`learner?.id === me.user.id`): **[📖 Back to learning]**, which locks and goes to the `app` phase.
  - Otherwise: **[📖 Use this device for learning]**. Confirm sheet:
    - "Open learner mode on this device?"
    - "Children will be able to learn here and change text size. Everything else stays in parent mode, behind your PIN."
    - [Cancel] [Open learner mode]

    `POST /api/parent/learner-session`, then lock, then `app`.
- **Offline:** every tab shows "Parent mode needs an internet connection. Connect and try again." [Retry] [‹ Back to learning].
- **Timers** (pure logic in `src/parent/pin.ts`, `lockDecision({lastInputAt, hiddenSince, now})`):
  - 5 min with no input, or 60 s hidden: lock;
  - `pagehide`: the lock beacon;
  - ping `GET /api/parent/me` at most once every 2 min while there was input in the last 2 min.

### 9.5 PIN pad (`src/components/PinPad.tsx`; one component for every PIN entry)

**Layout and input:**
- 4 dots at the top, an error line under them, then a 3×4 grid: 1–9, then **[Forgot PIN?]** (a small text key), 0, ⌫.
- Keys are circles: 76 px at `min-width: 600px`, 64 px on phones, 16 px gaps. At most 320 px wide on phones. It fits 360×640 without scrolling.
- Physical digit keys, Backspace and pasting 4 digits all work.
- The 4th digit submits, and the keys are disabled while busy. There is no show toggle; `autocomplete="off"`.

**Accessibility:**
- Each key is `<button aria-label="7">`.
- The dots have `role="status" aria-live="polite"` with the text "{n} of 4 digits".
- Errors use `role="alert"`.

**Wrong PIN:**
- The dots shake for 300 ms (none under `prefers-reduced-motion`) and clear.
- "That PIN isn't right. {n} tries left."
- At 1 left: "That PIN isn't right. 1 try left. After that, the PIN locks until you reset it by email."

**Locked** (replaces the pad):
- 🔒 "Your parent PIN is locked after 5 wrong tries."
- "We'll email {email} a link to choose a new PIN."
- [Email me a reset link] [‹ Back to learning or Cancel]

**Offline:** "You're offline. Connect to enter your PIN."

**Rate limited:** "Too many tries. Wait {m} minutes."

### 9.6 First-time PIN, change PIN, forgot PIN

**First-time setup:** it can't be skipped, because the server refuses everything else until a PIN exists.
1. H2 "Choose your parent PIN".
   - Text: "4 digits. You'll need them to open parent mode and to confirm a perek test. Keep it to yourself, not with the children."
   - Then the pad.
2. H2 "Enter the same 4 digits again".
   - On mismatch: "Those didn't match. Let's start again." and back to step 1.
   - A weak PIN (`weakPin`: all the same digit, 1234, 4321) is refused at step 1: "That one is easy to guess. Pick another."
3. `POST /api/parent/pin {pin, tz: Intl.DateTimeFormat().resolvedOptions().timeZone}`.
   - Success: ✓ "Your PIN is set." / "We sent a note to {email}, so you'll always know when the PIN changes." [Continue]
   - `email_failed`: "We couldn't send the notice email, so the PIN wasn't saved. Try again in a minute."

**Change PIN** (Settings, while unlocked): the same two steps, with H2 "Choose a new PIN". Done text: "Your PIN was changed. We emailed {email} a note."

**Forgot PIN** (pad key, or the locked screen):
1. Confirm sheet:
   - "Email a link to set a new PIN?"
   - "We'll send it to {email}. Your current PIN keeps working until a new one is set."
   - [Cancel] [Send the email]
2. Then:
   - 📬 "Check your email"
   - "Open the link in the email from Mishnah Ba'al Peh to choose a new PIN. It works for 1 hour."
   - [Back]
3. A 429 shows: "A reset email was just sent. Check your inbox, or try again in {m} min."

**`/parent-pin` (`src/auth/PinResetLanding.tsx`):**
- **Lookup ok:** H2 "Choose a new parent PIN for {masked email}", then the two-step pad.
- **Saved:** ✓ "Your new PIN is set." / "We emailed a note about the change." [Open Mishnah Ba'al Peh] → `/`.
- **Invalid, expired or used:** "This link has expired or was already used." / "Tap "Forgot PIN?" in the app to get a new one."
- **Offline, 429, other:** the same copy as the test page.

### 9.7 Children tab and child detail

**Children tab:**
- One card per child: emoji, name, and "{known}/{total} mishnayos · {verified} perakim verified · {due} due". Add the line "פרק {F} learned, waiting for a test" when one applies (today's ChildCard logic). The whole card opens Child detail.
- [+ Add child] opens a sheet with a Name field (40 characters) and an emoji picker (`EMOJIS`), then [Add]. It calls `newProfile` then `edit`.
- **Empty account:**
  - H2 "Add your first child"
  - "Each child gets their own place to learn and review, on every device signed in to this account."
  - The form inline.
- **"Move from this device"** (`canImportDevice(legacy, profiles.length, …)`: the account has no children and this device has guest or pre-account data): the existing `ImportPrompt` list and copy (with `IMPORT_TEST_NOTE`), rendered inline. "Move" calls `importLegacy` on the parent store, then `parentSync`. There is no "Not now / Never": it is a section, not a prompt.

**Child detail** ("‹ Children"). Sub-tabs **Perakim · Activity · Settings**:
- **Perakim:** one row per perek. It shows "פרק {heb} · Perek {N}", a status chip and a ⋯ menu.
  - **Chips:**
    - "✔ Verified {date}"
    - "📬 Test email sent {ago}" (only when this device's learner store has `lastTest`)
    - "🙋 Learned, ready for a test"
    - "In progress {k}/{n} mishnayos"
    - "Not started"
    - "🔒 Opens after פרק {F}"
  - **⋯ menu:** "Mark as verified" or "Remove verification", "Reset this perek", "Show mishnayos".
  - **Expanded:** one line per mishnah, "{N}:{m} · Known (next review {date}) / Learning / Not started". Known and learning lines get **[Mark not known]**.
- **Activity:** today's `ChildHistory`, pointed at `/api/parent/children/:id/*`.
- **Settings:** name, picture, breaks (`BreakSetting`), meanings (Simple or Steinsaltz), text size. Each saves on change, shown as "Saved ✓". At the bottom, a danger button **[Remove {Name}]**.

### 9.8 Confirmation sheets (`src/components/ConfirmSheet.tsx`)

- A bottom sheet on phones, a centred card on tablets.
- [Cancel] on the left, the action on the right. Destructive actions are red.
- The action is disabled while busy, and errors show inline.
- After every edit, a toast: "Done. {Name}'s devices will update when they're online."

| Action | Title | Body | Button |
|---|---|---|---|
| Mark verified | Mark פרק {heb} as verified for {Name}? | Use this when you've heard {Name} say the whole perek yourself. The next perek opens on {Name}'s devices the next time they're online. Add "{Name} hasn't finished learning this perek in the app yet." when it is not learned, and "פרק {F} isn't verified yet, so perakim after it stay locked." when an earlier one is unverified. | ✔ Mark verified |
| Remove verification | Remove the verification of פרק {heb}? | Perakim after it lock again until you verify it, here or with a test email. {Name}'s progress isn't changed. Old test emails for this perek stop working. | Remove verification |
| Mark not known | Mark {N}:{m} as not known for {Name}? | {Name} will learn it again from the first piece, and its review schedule starts over. This reaches {Name}'s devices the next time they're online. | Mark not known |
| Reset perek | Reset all of פרק {heb} for {Name}? | All {n} mishnayos and the whole-perek steps start over. Add "The verification stays. Remove it separately if you want." when it is verified. | Reset perek |
| Remove child | Remove {Name}? | {Name}'s progress is deleted from every device. This can't be undone. Plus a field "Type {Name} to confirm". | Remove {Name} |

### 9.9 Change log tab (`src/parent/ChangeLog.tsx`)

- `GET /api/parent/log`, 30 at a time, newest first, with [Show more].
- **Line layout:**
  - first line: "{Fri, Nov 6, 9:41 PM} · {what}", in the device's locale and time zone;
  - second line, grey: "{actorEmail} · {deviceLabel(actorDevice)}". Links show "test email link" or "PIN reset email link" instead of a session.
- **`describeEntry(e)`** (pure, `src/parent/log.ts`):
  - **PIN:**
    - pin_set: "Parent PIN set"
    - pin_changed: "Parent PIN changed"
    - pin_reset: "Parent PIN reset with an email link"
    - pin_locked: "PIN locked after 5 wrong tries"
  - **Verifications:**
    - perek_verified, via parent: "{Name}: פרק {heb list} marked verified"
    - perek_verified, via test_link: "{Name}: פרק {heb} confirmed from the test email" (adding "· PIN entered" when `pinUsed`)
    - perek_unverified: "{Name}: verification of פרק {heb list} removed"
  - **progress_edited:** a `p:K` key gives "{Name}: פרק {heb K} reset", and the remaining `m:` keys give "{Name}: {N}:{m}, … marked not known".
  - **Children:**
    - child_added: "Child added: {Name}", or "Child added from this device's saved progress: {Name}" when imported
    - child_removed: "Child removed: {Name}"
    - child_edited: "{Old} renamed to {New}" when the name changed, otherwise "{Name}: settings changed"
- **Empty state:** "Nothing here yet. Changes made in parent mode will show up here."
- **Footer:** "Every PIN change is also emailed to {account email}."

### 9.10 Settings tab (`src/parent/ParentSettings.tsx`)

- **Parent PIN:** [Change PIN] [Forgot PIN?]
- **Account:** "Signed in as {loginEmail}", `PricingNote`.
- **Backup:**
  - Export: today's JSON of the parent store's profiles.
  - Import: `copyAsNew`, then `edit`, then `parentSync`. Message "Added {n} children. {IMPORT_TEST_NOTE}".
- **This device:**
  - [🔒 Lock parent mode]
  - [Sign out of parent mode on this device]: `POST /api/parent/logout`, then `choose` (or `app` if a learner session exists). Next time it needs the email again.
  - [Sign this device out completely]: today's sign-out flow.
    1. If a learner store exists, `syncNow` its engine first (`useAccount` must be mounted briefly, or use `SyncEngine` directly) and warn about pending.
    2. `POST /api/auth/logout`, then `POST /api/parent/logout`.
    3. Remove the learner store, then `choose`.
- **Delete account:** today's typed-email confirm. It calls `DELETE /api/parent/account`, then clears both stores, then `choose`.
- **How it works:** today's list, with the test bullet replaced by: "When your child finishes a perek, they tap "I'm ready to be tested" and you get an email with the text. Listen, then tap the link and enter your PIN. Only then does the next perek open. You can also mark a perek verified here if you tested it yourself."
- `AboutNote`, `LicensesLink`.

### 9.11 Test page PIN step (`src/screens/PerekTestLanding.tsx`)

**Reducer additions (pure):**
- `pending` gains `pin?: { busy: boolean; error?: string; triesLeft?: number; locked?: boolean; resetSent?: boolean }`.
- New actions:
  - `openPin`
  - `closePin`
  - `pinWrong(left)`
  - `pinLocked`
  - `pinRequired` (confirm without a PIN got 400 `pin_required` because a PIN was set after lookup; this opens the sheet)
  - `resetSent`
- `tapConfirm` with `info.pinRequired` becomes `openPin`. Success is `confirmOk` as today.

**PIN sheet:**
- H2 "Enter your parent PIN"
- "So only a parent can confirm {Name}'s test."
- `PinPad`. The 4th digit calls `perekTestConfirm({token, pin})`.

**Locked, or Forgot:**
- `POST /api/perek-tests/forgot-pin {token}`.
- Message: "Check your email for a link to choose a new PIN. Then come back to this page and tap "knows it" again. This test link still works."
- Lookup with `pinLocked` opens straight to the locked state when the parent taps confirm.

**Unchanged:** "Not yet" (client-only, no PIN). Accounts without a PIN work exactly as today.

### 9.12 API client (`src/api/client.ts`)

Add:
- `requestLogin` / `verifyCode` with `as`;
- `parentMe`, `parentUnlock`, `parentLock` (keepalive), `parentSetPin`, `parentForgotPin`, `parentLogout`, `parentLearnerSession`, `parentSync`, `parentSetVerifications`, `parentLog`, `parentDeleteAccount`;
- `events` / `stats` moved to `/parent/children/…`;
- `pinResetLookup`, `pinReset`;
- `perekTestForgotPin`;
- `perekTestConfirm` with `pin`.

Remove `deleteAccount`.

`call()` gains an optional `keepalive` flag, used only by `parentLock`.

---

## 10. Old cached SPAs (before the service-worker update)

| Old behaviour | What happens now |
|---|---|
| Parent area (hold button): history, stats, delete account | `/api/children/*` and `/api/account` give 404, so it shows its existing error copy. Its child settings, renames, deletes and adds are ignored by the learner sync. Renames and settings are corrected by the echo, and deletes are undone together with the child's progress and verifications (§6.7). |
| First-run "Add child" on an old SPA | The child is ignored by the server and stays local-only on that device until it updates. The learner app after the update shows it until the local store is replaced. Acceptable; the update bar prompts quickly. |
| Learning, perek-test request, sync | Unchanged. |
| Test page confirm without a PIN on an account that has one | `pin_required` 400. The old `failKind` shows "Something went wrong" (it is not `bad_request` or `invalid_link`). After the update, the PIN sheet appears. |

**Deploy order:** the repo's `npm run deploy` already applies migrations before `wrangler deploy`. Migration 0007 is additive, so the old Worker keeps working against the new schema during the deploy window.

---

## 11. Tests

### 11.1 Worker (`worker/test/parent.test.ts`, new, plus additions to `auth`, `sync`, `perekTests`, `account`, `cron`, `email`; following `helpers.ts`)

Add these helpers:
- `parentLogin(email)`: request `as: parent`, then verify, returning the parent cookie;
- `unlock(cookie, pin)`;
- `setPin(cookie, pin)`;
- `parentSync(cookie, body)`.

Tests:
1. **Every `/api/parent/*` route except logout and lock, table-driven,** gets 401:
   - with no cookie;
   - with only the learner cookie;
   - with a learner token placed under the parent cookie name.

   Every unlocked-only route also gets 403 `parent_locked` with a locked parent session.
2. **A parent token under the learner cookie name** gets 401 on `/api/me`, `/api/sync` and `POST /api/perek-tests`.
3. **Grep test:** no source file under `worker/` contains `UPDATE sessions SET scope`, or any `scope =` inside an `UPDATE sessions` statement.
4. **Sign-in scopes:**
   - `as: parent` stores `scope='parent'`, and verify-link returns `scope` and sets only the parent cookie;
   - `verify-code` with the wrong `as` gets `invalid_code`;
   - a new parent request does not supersede a live learner request, or the other way round;
   - the `req-email` and `req-email-parent` buckets are separate, and `req-ip` is shared;
   - the parent email subject contains "parent sign-in code";
   - a missing `as` means learner.
5. **Unlock lifetime:**
   - unlock works;
   - 5 minutes with no request re-locks (fake time);
   - requests every 4 minutes keep it unlocked until 60 minutes after the PIN, then it re-locks;
   - `/me` slides it;
   - `/lock` locks;
   - the parent session expires 14 days after sign-in, even with daily use.
6. **Setting the PIN:**
   - the first set works without unlocking and unlocks;
   - a second set while locked gets 403;
   - a set while unlocked is logged as `pin_changed`;
   - the notice email contains the time in the given tz, falls back to "UTC" for a bad tz, and contains the login email and the device;
   - when the email provider fails: 502, and `account_pins` is unchanged;
   - other parent sessions' unlocks are cleared;
   - a malformed PIN gets 400.
7. **Lockout:**
   - 5 wrong tries give `invalid_pin` with attemptsLeft 4, 3, 2, 1, then 403 `pin_locked`;
   - one lock email is sent, one `pin_locked` log row is written, and every session's unlock is cleared;
   - after that the right PIN gets `pin_locked`;
   - 10 parallel wrong unlocks leave `failed = 5`;
   - unlock and confirm count against the same counter;
   - a right PIN resets the count.
8. **Storage:** the stored row has no plaintext PIN, and the same PIN on two accounts gives different hashes and salts.
9. **Forgot and reset:**
   - from a session and from a perek-test token;
   - limits 3/h and 6/day;
   - lookup changes nothing, so a scanner is harmless;
   - a reset sets the PIN and clears `locked_at` and `failed`;
   - a token works once;
   - a newer reset supersedes an older one;
   - an expired token gives `invalid_link`;
   - a failed notice email leaves the token live and the PIN unchanged;
   - the old PIN works until the reset.
10. **Confirm:**
    - with no PIN, it works as today;
    - with a PIN set: `pin_required`, then `invalid_pin` with attemptsLeft, then the right PIN verifies and writes a `perek_verified` log row with via `test_link` and `pinUsed: true`;
    - an invalid or expired token uses up no PIN tries;
    - re-confirming an already verified link needs no PIN;
    - lookup carries `pinRequired` and `pinLocked` and never needs a PIN.
11. **Verifications endpoint:**
    - verify and un-verify both bump the rev, and a learner pull gets the row;
    - live links become `covered` or `revoked`;
    - another account's child and a deleted child get 404;
    - a perek past the last gets 400;
    - each call writes one log row with the actor's session id and email;
    - the 121st call in an hour gets 429.
12. **Learner sync:**
    - a new child id, a delete and a rename are ignored, and the response carries the server row;
    - an ignored delete returns the child's progress and verification rows;
    - fontScale, meaningView and lastMasechta changes are accepted;
    - a breakMinutes change is ignored.
13. **Parent sync:**
    - stamps `updated_at = serverTime` and `parent_rev = rev` on children and records;
    - a perek row with `chains: []` replaces stored chains;
    - writes child_added (with `imported`), child_removed, child_edited (old to new name) and progress_edited log rows;
    - a 50-child cap breach gets 400;
    - an import of more than 500 rows across two calls works;
    - returned rows carry `byParent: true`.
14. **Fence:**
    - a learner push with cursor < R and a far-future `updatedAt` loses and gets the parent's row back with `byParent`;
    - with cursor ≥ R and an `updatedAt` earlier than the parent's server time, it wins, and the row no longer carries `byParent`;
    - after that, plain LWW applies;
    - the same holds for the child-settings merge.
15. **Change log:** newest first, paginated with `nextBefore`, limited to the account, and an unknown `limit` gets 400.
16. **Account deletion:** it needs an unlocked parent session, and it removes pins, resets, the log and both session scopes. The old `DELETE /api/account` gives 404.
17. **Cron:** prunes `audit_log` rows older than 365 days and `pin_resets` rows a day past expiry.
18. **Copy:** no parent, PIN, reset, notice or lock email (subject, text, HTML) matches `/\b(fun|game|games|play|playing)\b/i`.
19. **Learner session from parent:** `POST /api/parent/learner-session` while unlocked sets a learner cookie that works on `/api/me`, and it gets 403 while locked.

### 11.2 Client (`tests/*.test.ts`, node, no DOM)

1. **C1** `src/parent/pin.ts`:
   - `weakPin` (0000–9999 repeats, 1234, 4321 refused; 2580 allowed);
   - `pinPadReducer` (digits, backspace, paste, auto-submit at 4, wrong, locked);
   - `lockDecision` (5 min idle, 60 s hidden, ping cadence).
2. **C2** `applyServerResponse`:
   - a `byParent` record or child row replaces a pending value for the same key;
   - a row without `byParent` still doesn't;
   - the in-flight case: sent K1, edited to K2, response with the parent row, so K2 is dropped;
   - the over-500 case.
3. **C3** `resetPerek`:
   - writes blank mishnayos for every mishnah of the perek and `chains: []`;
   - `diffProfiles` emits them all.
4. **C4** `describeEntry`: every action and via, including perek reset vs. mishnah lists, renames and imports.
5. **C5** `deviceLabel` (shared): iPhone Safari, Android Chrome, Windows Chrome, and an empty UA.
6. **C6** `landingReducer` PIN states: `pinRequired`, `pinWrong`, `pinLocked`, `resetSent`, and a re-tap after a reset.
7. **C7** Boot routing (a pure `bootPhase` helper):
   - learner first, then parent, then the choice;
   - an `as` hint from the link fragment;
   - a verify scope decides the phase.
8. **C8** `takePinResetToken` strips the fragment and keeps it for a reload, mirroring the `takePerekTestToken` tests.
9. **C9** Copy scan: the new client copy modules (`src/parent/*`, `PinPad`, `PinResetLanding`, `Login` choice, Profiles' no-learners text) contain no fun, game or play wording.

Baseline before this work: `npm test` 249 passing, and `npm run build` clean. After it, both must pass, including `tsc` strict for the worker, the client and `shared/`.

---

## 12. File-by-file changes

**New:**
- `migrations/0007_parent_mode.sql`: §4.
- `worker/lib/pin.ts`: hash, `checkPin`, `setPinFlow` (§6.3).
- `worker/lib/audit.ts`: `auditStmt`, and the JS builders for the sync log rows.
- `worker/routes/parent.ts`: §6.4–6.5, mounting the moved children routes.
- `worker/routes/pinReset.ts`: §6.10.
- `worker/email/pinResetEmail.ts`, `pinNoticeEmail.ts`, `pinLockedEmail.ts`: §6.8.
- `shared/device.ts`: `deviceLabel`.
- `worker/test/parent.test.ts`.
- `src/parent/ParentApp.tsx`, `useParent.ts`, `ChildDetail.tsx`, `ChangeLog.tsx`, `ParentSettings.tsx`, `pin.ts` (pure), `log.ts` (pure `describeEntry`).
- `src/components/PinPad.tsx`, `ConfirmSheet.tsx`.
- `src/auth/PinResetLanding.tsx`.
- `tests/parent.test.ts`.

**Changed:**
- `shared/api.ts`: §5. Owner sign-off; update the header note.
- `worker/env.ts`: `Variables.parent?`.
- `worker/lib/session.ts`: scope, the parent cookie, `requireParentSession`, `requireParent`, `unlockStmt`, `lockAllParentStmt`, and `createSession(…, scope, loginEmail)`.
- `worker/lib/validate.ts`:
  - `as` on the auth bodies;
  - `pin` on the token body;
  - `validatePin`, `validateSetPin` (tz ≤ 64 chars, `[A-Za-z0-9_+\-/]`), `validateSetVerifications`, `validatePinReset`.
- `worker/routes/auth.ts`: §6.2.
- `worker/routes/sync.ts`: `runSync(c, role)`, the fence, `byParent`, the narrowed learner children, the restored data for ignored deletes, the parent stamping and the log rows.
- `worker/routes/children.ts`: becomes the parent children routes, with `requireParent` instead of `requireUser`.
- `worker/routes/me.ts`: drops `DELETE /account`. The deletion code moves to `parent.ts`, extended.
- `worker/routes/perekTests.ts`: §6.9.
- `worker/lib/verification.ts`: the header comment only (§6.5).
- `worker/email/loginEmail.ts`: the `scope` parameter.
- `worker/cron.ts`: the two prunes.
- `worker/index.ts`: §6.11.
- `worker/test/helpers.ts`: the parent helpers. `login()` stays learner.
- Existing tests that call `/api/children/*` or `DELETE /api/account` move to the parent routes.
- `src/App.tsx`: §9.1.
- `src/auth/Login.tsx` (`Choose`, `as`), `CheckEmail.tsx`, `VerifyLanding.tsx`: §9.2.
- `src/LearningApp.tsx`, `src/screens/Profiles.tsx`, `src/screens/Home.tsx`, `src/components/PerekReady.tsx`: §9.3.
- `src/screens/ChildHistory.tsx`: the new API paths. Its "Parent reset {p}:{m}" line already covers parent edits.
- `src/screens/PerekTestLanding.tsx`: §9.11.
- `src/sync/store.ts`: the `byParent` rule (§8.2).
- `src/progress.ts`: `resetPerek`.
- `src/api/client.ts`: §9.12.
- `src/styles.css`: the PIN pad, the choice buttons, the sheets, the tabs.
- `src/screens/ImportPrompt.tsx`: an inline variant for parent mode, without the later/never buttons.

**Removed:**
- `src/screens/Parent.tsx` (its parts move into `src/parent/`);
- `HoldButton`.

**Docs:**
- `docs/PARENT_VERIFICATION.md`: a note at the top of §0, §1, §11 and §17 pointing here ("superseded by PARENT_MODE.md: a parent session plus the PIN may also verify"), and §10.5 (the parent area) marked replaced.
- `docs/SERVER_PLAN.md` §3.8: a pointer to the two session scopes.
- `README.md`: parent mode in the feature list and the API table.

Not changed: `wrangler.jsonc` (names, ids, routes), the CI workflow, and `package.json` dependencies. Nothing new is needed: WebCrypto PBKDF2 and Intl are built in.

---

## 13. Open points for the owner

1. **Sign-off on the `shared/api.ts` additions** (§5).
2. **The 14-day absolute parent session and the 5/60-minute unlock.** These are the decided defaults. They are constants in `PARENT`, so changing them is a one-line edit.
3. **A PIN change is refused while the email provider is down.** We chose this so that no change goes unannounced.
4. **Email times use the zone the client sent.** Lockout emails, which can come from the test page without a client zone, are in UTC.
5. **Parent mode is online-only, by design.**

---

## 14. Server implementation notes and deviations

The server side (migration 0007, `shared/api.ts`, `shared/device.ts`, `worker/`) follows §4–§8 and §11.1. Where it
differs from the text above, or the text left a choice open:

1. **Forgot PIN with no PIN set** (`POST /api/parent/pin/forgot`, `POST /api/perek-tests/forgot-pin`): 409
   `pin_not_set`, no email. A parent session with no PIN sets one directly; a reset link could otherwise create the
   first PIN from a test page.
2. **`ForgotPinResponse { ok: true; sentTo }`** is a named type in `shared/api.ts` (§6.4 gave the shape inline). The
   route list is also written as a comment block in `shared/api.ts`.
3. **Change-log pages never end inside a millisecond.** `before` is exclusive and one parent sync writes several rows
   with the same `at`, so when a page is cut the server appends the rest of the last row's millisecond. A page can
   therefore hold a few more than `limit` entries. `nextBefore` is unchanged in meaning.
4. **`tz`** that fails the `[A-Za-z0-9_+\-/]{1,64}` check or `Intl.DateTimeFormat` is dropped (the email says UTC),
   not refused with 400. Lock emails are always UTC: unlock and confirm carry no `tz`.
5. **Validators:** `validateToken` (sign-in, PIN reset) returns only `{token}`; the perek-test routes use a new
   `validatePerekTestToken` for `{token, pin?}`. `POST /api/pin-reset/lookup` answers `invalid_link` for a malformed
   token too (one answer for every failure).
6. **`setPinFlow` guard.** Every statement after the guarded write (locking the other parent sessions, unlocking this
   one, the log row) and the final check are conditional on `account_pins.hash = <the new hash>` (the salt is random,
   so only this call's write can match). A guard miss answers 403 `parent_locked` from `/parent/pin` and 400
   `invalid_link` from `/pin-reset`.
7. **`maskEmail`** moved to `worker/lib/mask.ts` (still re-exported from `routes/perekTests.ts`). The parent emails
   share the card layout through `worker/email/layout.ts`.
8. **Learner logout** (`POST /api/auth/logout`) deletes only a `scope = 'learner'` row, so a parent token placed in the
   learner cookie can't be used to end a parent session.
9. **Learner child-settings merge** uses `coalesce(json_extract(data, '$.settings'), '{}')` so a child row without
   settings can't make `json_patch` fail.
10. **Worker tests:** `worker/test/parent.test.ts` covers §11.1 tests 1–19; the "grep" test (3) reads the worker
    sources through Vite's `import.meta.glob(…, {query: "?raw"})`. Tests that only need children use the helper
    `adminCookie(email)`, a parent session unlocked directly in D1 **without** a PIN, so their test confirms stay
    PIN-free. `/api/children/*` and `DELETE /api/account` tests moved to the parent routes.

### 14.1 LWW and parent edits, as built

Exactly §8.1. In short, for the owner: a parent's edit is stamped with the server clock and fenced by `parent_rev`.
A tablet that was offline when the parent edited (its sync cursor is older than the edit) can never overwrite it, even
with a clock set years ahead: its push for that one key is dropped, its events still reach Activity, and the
parent's row comes back with `byParent: true`. Once the tablet has pulled the edit, the child's next learning on that
mishnah wins, even if the tablet's clock is behind; after that, normal last-write-wins. Child renames, deletes and
breaks are parent-only; a learner can change only text size and meaning view, under the same fence. Tested in
`parent.test.ts` 12, 14a and 14b.

### 14.2 Left for the client

Done; see §15. (Until the client shipped, the SPA was degraded as §10 describes.)

---

## 15. Client implementation notes and deviations

The client follows §9 and §11.2 (`tests/parent.test.ts`, C1–C9). Files: `src/parent/` (`ParentApp.tsx`, `useParent.ts`,
`ChildDetail.tsx`, `ChangeLog.tsx`, `ParentSettings.tsx`, `PinFlows.tsx`, `pin.ts`, `log.ts`), `src/components/PinPad.tsx`,
`src/components/ConfirmSheet.tsx`, `src/auth/PinResetLanding.tsx`, `src/auth/boot.ts`; `src/screens/Parent.tsx` and
`HoldButton` are gone. Where it differs from §9, or §9 left a choice open:

1. **`applyServerResponse(…, { parentWins: false })` for the parent's own store.** Every row a parent sync gets back is
   `byParent` (its own echo), so the §8.2 rule would drop a value the parent edited again while that push was in
   flight. The learner store keeps the rule (the default); the parent store opts out. Tested in C2.
2. **The parent store pulls from cursor 0 once** (it starts empty in memory), and later unlocks sync from its current
   cursor, which also retries anything pending from before the lock. Same result as a fresh pull, less data.
3. **Child settings save 0.9 s after the last change, or on blur** (and on leaving the tab), not on every keystroke, so
   typing a new name is one sync and one "renamed" log entry. "Saved ✓" shows after the write is queued.
4. **The perek ⋯ menu is an inline row of buttons** under the perek, not a floating popover (simpler on phones, and
   every action still opens its confirm sheet from §9.8).
5. **Hebrew inside English sentences** ("Mark פרק ב׳ as verified…", change-log lines, "Opens after פרק …") is wrapped
   in a right-to-left isolate (U+2067…U+2069, `perekHe` in `src/parent/log.ts`) so the geresh stays with its letter.
   Tests compare the text with the isolates stripped.
6. **The PIN-locked screen** has an extra small button, "I've chosen a new PIN", that re-reads `GET /api/parent/me`
   (for a reset made on another device) instead of making the parent reload.
7. **Opening parent mode from learner mode while offline** (`GET /api/parent/me` fails without a 401) returns quietly
   to learner mode instead of showing an error screen; tapping the link again retries.
8. **"Aa" text size is for signed-in learners only.** Guest mode keeps its own settings sheet, unchanged.
9. **The import prompt left learner mode entirely.** "Move from this device" is a section of parent mode's Children tab
   (`ImportPrompt inline`), shown while the account has no children and this device has guest or pre-account progress;
   it writes into the parent store. The learner store's `importDecision` is no longer used by the UI.
10. **Boot**: `bootPhase` / `phaseAfterSignIn` (`src/auth/boot.ts`) are the pure decisions; `App.tsx` makes the calls in
    order (`/api/me`, then `/api/parent/me` only on a 401). A parent sign-in never writes the learner's current-user
    marker; "Back to learning" / "Use this device for learning" do.
11. **"Sign this device out completely"** syncs the learner store with a throw-away `SyncEngine` (no `useAccount`
    mount), warns if learning changes are still pending, then ends both sessions and removes the learner store.

**Sync with an offline tablet, from the client's side** (§8): parent edits go out at once with the server's clock and
`parent_rev`. A learner device that hasn't pulled them can't overwrite them; when the parent's row arrives with
`byParent: true`, the new client drops its pending value for that key (and for a child row), so a value made without
seeing the parent's edit never goes out later with a newer cursor. The child's practice events still reach Activity.

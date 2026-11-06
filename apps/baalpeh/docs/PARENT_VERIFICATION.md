# Parent verification of a perek (by email)

Status: spec, ready to implement. It merges two design proposals (backend/security and child/parent UX). Where they disagreed, the decision and the reason are given in place (search for **Resolved:**).

The owner's problem: today a child moves from one perek to the next on the honor system. Every in-app check can be tapped through, including the in-app "Show Abba or Ima" `ParentCheck` and the 2-second "🔒 Parent (hold)" button (`src/screens/Profiles.tsx`). Kids "finish" whole masechtos without knowing them.

The new rule: **a perek is officially done only when the account holder clicks a link in an email and confirms on the page it opens.** Only then does the next perek open.

This spec attaches at the end of the perek build-up: the point where the whole perek has been learned. It does not depend on how the build-up works inside. See §13, "Depends on PEREK_BUILDUP".

---

## 0. Decisions at a glance

| Question | Decision |
|---|---|
| What is gated | **Frontier** = the first perek, in catalog order, that the server has not verified. Perakim after it are locked: greyed, not interactive, stars still shown. The frontier itself can be learned freely. Once it is learned, its next task is the test. |
| Sent automatically? | No. At the end of the perek the child gets a review of the whole perek, then taps **"🙋 I'm ready to be tested"**, then confirms in a sheet. Only then is the email sent. |
| Recipient | Always the `users.email` of the signed-in account. The client never names a recipient. |
| Where the verified state lives | A new server-only D1 table, `perek_verifications`. Only the confirm route writes it (and later the admin seam). It is never part of `PerekProgress` or `PerekProgressData`, and it is never accepted from `/api/sync`. |
| How it reaches devices | A new optional `SyncResponse.verifications: PerekVerificationRow[]`, pulled by `rev > cursor` like children and progress. A client that understands it does one `cursor: 0` sync the first time it runs (§7.3). **Resolved:** this is a separate field, not a new `RecordRow` kind, because the current `applyServerResponse` treats any unknown kind as a day and would corrupt old clients (`src/sync/store.ts`, the `else` branch). |
| Where the client keeps it | `AccountStore.verified`, keyed by child id. **Resolved:** this is not on `Profile`, so it can't leak into export or backup, `copyAsNew`, `normalizeProfile`, `diffProfiles` or guest storage. The gate functions take it as an explicit argument. |
| Token | 32 random bytes, base64url (the existing `randomToken()`). D1 stores only `sha256Hex(token)`. **Valid for 30 days.** Any live link for that child and perek works. The first confirm marks the other links `covered`. Confirming again is idempotent and shows "Already done ✓". **Resolved:** 30 days rather than 14, because a parent may test on Shabbos and tap days later. A link only ever grants that one perek, so a long lifetime costs little. |
| Link | `${APP_ORIGIN}/perek-test#t=<token>`. The token is in the fragment, so it never reaches the server, the logs or a `Referer`. |
| Email scanners that prefetch links | **The landing page needs a tap.** A GET never changes anything: there is no GET route under `/api/perek-tests`. The page calls a read-only `POST /lookup` to show who and what. It calls `POST /confirm` only when the parent taps **"✅ {Name} knows it"**. This is the same model as `/auth/verify` (`VerifyLanding.tsx`). |
| "Not yet" on the landing page | Client-only. It writes nothing to the server, the link stays live, and the parent sees an encouraging note. **Resolved:** recording a server-side "not yet" that the child sees is deferred (§14). It would add a second server state that has to flow down to devices, and the owner asked only for "click the link to update the state". |
| Auth on the link page | None. Having the email is the credential. It works on any device and in any browser, signed in, signed out, or signed in to another account. |
| Cooldown (anti-spam) | **Per child: one test email per 10 minutes**, enforced exactly in SQL. A failed send does not count. **Per account: 12 per hour and 40 per day.** **Per IP** on lookup and confirm: 30 per 15 minutes. **Resolved:** the account caps follow the backend proposal (12/40), not the UX proposal (6/20), because a family with several children each re-testing many legacy perakim would otherwise hit the cap during an honest evening. |
| Order | The server accepts a request only for the child's frontier perek, computed from server data alone (§5.1 step 3). |
| Email text | Comes from the server. `scripts/build_data.py` also writes `worker/data/text.json`: the Hebrew `chunk.he` pieces, exactly as the app shows them. The client never sends any text, name or link. **Resolved:** this file instead of `env.ASSETS.fetch(...)`, because it avoids parsing 269 KB per request and the worker tests would otherwise need a built `dist/`. |
| Landing-page text | Comes in the lookup response, from the same `text.json`. The page and the email are guaranteed to match, and the parent's phone never downloads the 269 KB masechta. |
| Progress reset after verification | The verification **stays**. It records that a parent tested this child on this perek. Only a parent un-verify (roadmap) removes it. |
| Guest mode | **Ungated, never counts.** It is how a waiting child keeps learning ("Continue as a guest" from a locked perek). Device progress imports only into an account with no children, always unverified. See §9. |
| Legacy children | No server migration. Their progress stays. They lock at their first unverified perek, normally perek 1, and see a kind one-time banner. "Continue learning" takes them to that perek's test step. |
| Admin seam (later) | All writes go through `worker/lib/verification.ts`. **Un-verify** may be a plain session endpoint, because it only removes access. **Verify** must never be: the parent area sits behind a hold gate a child can pass. There is no "Mark as tested" button anywhere in the app. |
| `shared/api.ts` | Says FIXED. This feature makes additive, backward-compatible changes (§4) and **needs the owner's sign-off**. |
| `wrangler.jsonc` | No change: no new bindings, vars, secrets or routes. |

---

## 1. Threat model

**What this stops.** A child tapping through every in-app check and moving on. After this change, *official* completion needs someone who can read the account holder's inbox. None of the following can set the verified state:
- a crafted `/api/sync` body;
- a stale or offline tablet;
- a replayed sync;
- devtools on the app's own origin.

**What it does not stop. These are accepted and listed in §15.**
- The child can read the parent's email, for example when Gmail is signed in on the family tablet. The only mitigation is the copy, plus the parent area showing "Tested Nov 3".
- The child edits localStorage on one device. Only that device's display changes. The server, other devices and the parent area stay correct, and the next sync's pull does not restore a forged value, because the server never sends it.
- The child creates a separate account with their own email and becomes its "parent". That account starts empty, and a backup import carries progress but never verifications. The parent area shows the account email.

**Roadmap consequence.** The parent area is behind the 2-second hold, which a child can pass. So any future "set verified = true" has to go through the same email flow (§11).

---

## 2. Flows

### 2.1 Child asks to be tested (happy path)

1. The child finishes the perek build-up. The whole perek is learned, so `perekLearned(p, F)` is true for the frontier `F`.
2. `nextLearning` now returns `{ type: "perek-test", perek: F }`. The celebration's next button reads **"Get ready for your test ›"**.
3. **PerekTestTask, stage A: "Read it through."** The whole perek appears phrase by phrase at cue 0.
4. **Stage B: "Say it once by yourself."** The whole perek appears at L4 (empty cards) and peeks are counted. This emits a `recite` event with task `"pre-test"`.
5. **"🙋 I'm ready to be tested"** opens the confirm sheet. **"📬 Yes, send it!"** does `await syncNow()`, then `POST /api/perek-tests`.
6. The server checks ownership, the frontier, the cooldown and the caps. It inserts a `perek_tests` row, emails the account and returns `sentTo`, `nextAllowedAt` and `serverTime`.
7. The child sees the waiting screen. While it is visible, the app syncs on focus, when it becomes visible, and every 30 seconds.

### 2.2 Parent tests and confirms

1. The parent opens the email: the child's name, the perek, the button, and the text phrase by phrase.
2. The parent listens to the child say the perek and taps the button. `/perek-test#t=…` opens. The SPA strips the fragment and calls `POST /api/perek-tests/lookup`, which is read-only.
3. The page shows the child, the perek and the text. The parent taps **"✅ {Name} knows it, open the next perek"**, which calls `POST /api/perek-tests/confirm`.
4. In one D1 batch the server consumes the token, bumps `users.rev` and upserts `perek_verifications` with `verified = 1` at that revision. Other live links for the same perek are marked `covered`.
5. Every device of the account picks up the row on its next sync. The child's waiting screen polls, so the child sees **"Mazel tov, {Name}! It's official!"** within about 30 seconds. The next perek unlocks.

### 2.3 Failure and edge flows

| Situation | Behavior |
|---|---|
| Offline when tapping "ready" | The button is disabled, with the text "Connect to the internet to send your test." Nothing is queued: an email arriving hours later would confuse everyone. |
| Second tablet, or a double tap, within 10 minutes | `429 rate_limited` with `retryAfterSec`. The child sees the waiting screen with the countdown ("Your test was already sent a few minutes ago 📬"). |
| Resend refuses the send | `502 email_failed`. The row's outcome is set to `failed`, so the cooldown is not used up. The child sees "Oops, the email didn't go through. Let's try again in a minute." |
| Session expired | `401`. The child sees "Ask Abba or Ima to sign in again, then you can send your test." with the button [Go to parent area]. |
| Already verified on the server (stale tablet) | `200 { alreadyVerified: true, verification }`. No email is sent. The client applies the row and celebrates. |
| Not the frontier on the server (for example, after an admin un-verify this tablet hasn't seen) | `400 bad_request` with the message `not_frontier`. The client runs `syncNow()` and re-renders, which moves the gate back. |
| Link expired (more than 30 days) | The page says the link expired and asks the parent to have {Name} tap "I'm ready" again. |
| Child deleted, unknown token, or revoked link | `400 invalid_link`, with one shared message (no enumeration). |
| Parent taps "Not yet" | Client-only. The page shows an encouraging note and both buttons stay, so the same link works later. |

---

## 3. D1 migration: `migrations/0006_perek_verification.sql`

```sql
-- One emailed "test me" request. The token itself is never stored.
CREATE TABLE perek_tests (
  id          TEXT PRIMARY KEY,                 -- crypto.randomUUID(); also the email idempotency key suffix
  user_id     TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  child_id    TEXT NOT NULL REFERENCES children (id) ON DELETE CASCADE,
  masechta    TEXT NOT NULL,                    -- catalog id, e.g. 'berakhot'
  perek       INTEGER NOT NULL,
  token_hash  TEXT NOT NULL UNIQUE,             -- sha256 hex of the link token
  created_at  INTEGER NOT NULL,
  expires_at  INTEGER NOT NULL,                 -- created_at + 30 d
  consumed_at INTEGER,                          -- set together with outcome
  outcome     TEXT CHECK (outcome IS NULL OR outcome IN ('verified', 'covered', 'failed', 'revoked'))
  -- verified: this link confirmed it. covered: another link for the same perek confirmed it first.
  -- failed: the email provider refused the send (doesn't count for the cooldown). revoked: an admin un-verify killed it.
);
CREATE INDEX perek_tests_child_created ON perek_tests (child_id, created_at);
CREATE INDEX perek_tests_child_perek ON perek_tests (child_id, masechta, perek);
CREATE INDEX perek_tests_user_created ON perek_tests (user_id, created_at);
CREATE INDEX perek_tests_expires ON perek_tests (expires_at);

-- Server-authoritative verified state. Written only by the confirm route (and later the admin seam), never by /api/sync.
CREATE TABLE perek_verifications (
  child_id    TEXT NOT NULL REFERENCES children (id) ON DELETE CASCADE,
  user_id     TEXT NOT NULL,                    -- denormalized owner for pull queries (as in progress)
  masechta    TEXT NOT NULL,
  perek       INTEGER NOT NULL,
  verified    INTEGER NOT NULL CHECK (verified IN (0, 1)),  -- 0 = un-verified by admin; row kept so it syncs down
  verified_at INTEGER,                          -- when it last became 1
  source      TEXT NOT NULL CHECK (source IN ('email', 'admin')),
  test_id     TEXT,                             -- perek_tests.id that confirmed it; NULL for admin edits
  updated_at  INTEGER NOT NULL,                 -- server clock
  rev         INTEGER NOT NULL,                 -- users.rev at last write (sync cursor)
  PRIMARY KEY (child_id, masechta, perek)
);
CREATE INDEX perek_verifications_user_rev ON perek_verifications (user_id, rev);
```

Notes:
- `masechta` is stored from day one. Progress keys don't name a masechta yet (SERVER_PLAN §14, and `DEFAULT_MASECHTA_ID` in `src/data.ts`), and adding the column later would need a table rebuild. Today it is always `'berakhot'`, validated against `worker/data/text.json`.
- Un-verify keeps the row with `verified = 0` and a new `rev`, so devices learn about it through the normal incremental pull. A hard delete would never reach them.
- There is no new `events.type`. The CHECK constraint in `0004_events.sql` can't be altered without a table rebuild. `perek_tests` is the audit trail.
- No email address is stored. The recipient is always the current `users.email`.

---

## 4. Contract additions (`shared/api.ts`, additive, needs the owner's sign-off)

```ts
// ───────────────────────── Perek tests (parent verification) ─────────────────────────

export const PEREK_TEST = {
  /** One test email per child per this many seconds (failed sends don't count). */
  COOLDOWN_SEC: 10 * 60,
  /** Link lifetime. */
  TOKEN_TTL_SEC: 30 * 24 * 60 * 60,
} as const;

/** POST /api/perek-tests (session). The server reads the text and the name itself; the client sends none. */
export interface PerekTestRequestBody {
  childId: string;
  masechta: string;
  perek: number;
}
export interface PerekTestRequestResponse {
  ok: true;
  /** true: the perek is already verified on the server; no email was sent. Apply `verification`. */
  alreadyVerified: boolean;
  /** Present when alreadyVerified. */
  verification?: PerekVerificationRow;
  /** Masked account email for the parent area, e.g. "y•••@gmail.com". Empty when alreadyVerified. */
  sentTo: string;
  /** When this child may ask again (server clock). */
  nextAllowedAt: Ms;
  /** Server clock, so the countdown is right even when the tablet's clock is off. */
  serverTime: Ms;
}

/** POST /api/perek-tests/lookup and /api/perek-tests/confirm (no session). */
export interface PerekTestTokenBody {
  token: string;
}
export interface PerekTestInfo {
  status: "pending" | "verified" | "expired";
  childName: string;
  childEmoji: string;
  childColor: string;
  masechta: string; // catalog id
  masechtaHe: string; // "ברכות"
  masechtaEn: string; // "Berakhot"
  perek: number;
  /** null when this is the last perek of the masechta. */
  nextPerek: number | null;
  /** The perek's Hebrew pieces: mishnayos[mishnahIndex][pieceIndex] = chunk.he (the same text as the email). */
  mishnayos: string[][];
  requestedAt: Ms;
  verifiedAt: Ms | null;
}

/** Server-authoritative. Pulled only; never accepted in a SyncRequest. */
export interface PerekVerificationRow {
  childId: string;
  masechta: string;
  perek: number;
  verified: boolean;
  verifiedAt: Ms | null;
  updatedAt: Ms;
}

export interface SyncResponse {
  // …existing fields unchanged…
  /** Rows with rev > request.cursor. Optional, so older clients and servers interoperate. Never in SyncRequest. */
  verifications?: PerekVerificationRow[];
}

// ReciteTask gains "pre-test" (the child's self-recitation on the test screen; changes no SRS state).
export type ReciteTask = "learn" | "chain" | "detour" | "practice" | "review-m" | "perek-chain" | "review-p" | "pre-test";
```

No new `ErrorCode` is added. The routes reuse `rate_limited` (with `retryAfterSec`), `invalid_link`, `not_found`, `bad_request` (message `not_frontier` for the order check), `unauthorized`, `forbidden` and `email_failed`.

`validate.ts` adds `"pre-test"` to the `oneOf` list for `recite.task`. The SPA and the Worker deploy together as one Worker, so the server always accepts `"pre-test"` before any client can send it.

`hebNum` moves from `src/data.ts` to a new `shared/hebrew.ts`, so the Worker and the client format numerals identically (`טו׳`, `טז׳`). `src/data.ts` re-exports it, so existing imports keep working.

---

## 5. Endpoints (`worker/routes/perekTests.ts`, new)

Mount in `worker/index.ts`, before the `/api/*` 404:
```ts
app.route("/api/perek-tests", perekTestRoutes); // POST /, /lookup, /confirm
```
All three routes are POST, so the global `originCheck` (CSRF: same Origin, or `Sec-Fetch-Site: same-origin`) and the JSON body rule apply. **There is no GET route.** `GET /api/perek-tests/*` falls through to the 404 handler, so a GET never changes state.

Move `limit()` from `worker/routes/auth.ts` into `worker/lib/rateLimit.ts` and export it. `auth.ts` then imports it.

### 5.1 `POST /api/perek-tests`: the child asks for the test email

Auth: `requireUser`. Validation: `validatePerekTestRequest` in `worker/lib/validate.ts` checks that `childId` matches `ID_RE`, that `masechta` is a key of `text.json`, and that `perek` is an integer in `1..perakimCount(masechta)`.

`t = now()`, `U = c.var.user.id`.

1. **The child.** Run `SELECT data FROM children WHERE id = ?1 AND user_id = ?2 AND deleted = 0`. If there is no row, return `404 not_found`. A brand-new child that hasn't synced yet is covered too, because the client syncs first.
2. **Already verified?** Run `SELECT verified, verified_at, updated_at FROM perek_verifications WHERE child_id=? AND masechta=? AND perek=?`. If `verified = 1`, return `200 { ok, alreadyVerified: true, verification, sentTo: "", nextAllowedAt: t, serverTime: t }` and send nothing.
3. **Frontier (server data only).** Run `SELECT perek FROM perek_verifications WHERE child_id=? AND masechta=? AND verified=1`. If any perek `1..perek-1` is missing from the result, return `400 bad_request` with the message `not_frontier`. This keeps the emails in order and costs nothing: it reads server truth, not client-authored progress.
4. **Account caps.** `await limit(c, "ptest-user-h", U, 12, 3600, t)` and `await limit(c, "ptest-user-d", U, 40, 86400, t)`.
5. **Per-child cooldown, exact and race-safe**, in one statement:
   ```sql
   INSERT INTO perek_tests (id, user_id, child_id, masechta, perek, token_hash, created_at, expires_at)
   SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8
   WHERE NOT EXISTS (
     SELECT 1 FROM perek_tests
     WHERE child_id = ?3 AND created_at > ?7 - 600000 AND (outcome IS NULL OR outcome != 'failed'))
   RETURNING id;
   ```
   If no row comes back, read `SELECT max(created_at) AS last FROM perek_tests WHERE child_id=?3 AND (outcome IS NULL OR outcome!='failed')`, then return `429 rate_limited` with `retryAfterSec = max(1, ceil((last + 600000 - t) / 1000))`.
   - *Why per child:* the owner's rule is "a child can trigger at most one per ~10 min". Per account would block a sibling who finishes at the same time. Per perek would add nothing: step 3 already pins each child to one perek. The account caps bound the total.
   - *Why not `hit()`:* its fixed windows allow two sends seconds apart across a window edge, and it can't give an exact countdown.
6. **Build the email** (§6) from `children.data` (name and emoji) and `text.json`.
7. **Send** with `pickSender(c.env).send({ to: c.var.user.email, subject, text, html, idempotencyKey: "perek-test-" + id })`. If the send throws, run `UPDATE perek_tests SET outcome='failed', consumed_at=?t WHERE id=?` and return `502 email_failed`. The cooldown is not used up, and the hourly cap still bounds retries.
8. Return `200 { ok: true, alreadyVerified: false, sentTo: maskEmail(user.email), nextAllowedAt: t + 600000, serverTime: t }`. `maskEmail("yosef@gmail.com")` gives `"y•••@gmail.com"`.

The server **does not check** that progress says the perek is complete. Progress is client-authored, so the check would add no security. Progress may also lag while offline, and the build-up may change what "complete" means. The parent's test is the check.

Older pending links for the same perek are **not superseded**. The login flow's "only the newest works" rule would confuse a parent who opens yesterday's email. Any live link for that child and perek verifies.

### 5.2 `POST /api/perek-tests/lookup`: the landing page shows who and what (read-only)

Auth: none. Rate limit: `limit(c, "ptest-ip", clientIp(c), 30, 900, t)`, shared with confirm. The token is validated by `validateToken` (the regex `^[A-Za-z0-9_-]{20,128}$`, extracted from `validateVerifyLink` and shared with it).

```sql
SELECT pt.masechta, pt.perek, pt.created_at, pt.expires_at, pt.outcome, c.data, c.deleted,
       v.verified, v.verified_at
FROM perek_tests pt JOIN children c ON c.id = pt.child_id
LEFT JOIN perek_verifications v
  ON v.child_id = pt.child_id AND v.masechta = pt.masechta AND v.perek = pt.perek
WHERE pt.token_hash = ?1
```

Decision order:
1. No row, `c.deleted = 1`, or outcome `failed` or `revoked`: `400 invalid_link`.
2. `v.verified = 1`: `status: "verified"`. This covers both this link and a sibling link.
3. Outcome `verified` or `covered` with `v.verified` not 1 (un-verified later by admin): `400 invalid_link`.
4. `expires_at <= t`: `status: "expired"`.
5. Otherwise: `status: "pending"`.

The response includes `mishnayos` from `text.json` and never includes the account email or any progress. Lookup writes nothing, so a scanner that runs JavaScript only causes reads.

### 5.3 `POST /api/perek-tests/confirm`: the parent taps "knows it"

Auth: none, and no session is required. A browser signed in to another account still works, because the token decides the child and perek. Same IP limit and same token validation. One `db.batch` (a D1 transaction), keyed on `token_hash`, so nothing has to be read between statements:

```sql
-- 1. consume: only a live, pending token of a live child
UPDATE perek_tests SET consumed_at = ?t, outcome = 'verified'
WHERE token_hash = ?h AND consumed_at IS NULL AND expires_at > ?t
  AND EXISTS (SELECT 1 FROM children c WHERE c.id = perek_tests.child_id AND c.deleted = 0);
-- 2. bump the account revision so every device pulls the change
UPDATE users SET rev = rev + 1
WHERE id = (SELECT user_id FROM perek_tests WHERE token_hash = ?h AND consumed_at = ?t AND outcome = 'verified');
-- 3. upsert the verification at that rev
INSERT INTO perek_verifications (child_id, user_id, masechta, perek, verified, verified_at, source, test_id, updated_at, rev)
SELECT pt.child_id, pt.user_id, pt.masechta, pt.perek, 1, ?t, 'email', pt.id, ?t, u.rev
FROM perek_tests pt JOIN users u ON u.id = pt.user_id
WHERE pt.token_hash = ?h AND pt.consumed_at = ?t AND pt.outcome = 'verified'
ON CONFLICT (child_id, masechta, perek) DO UPDATE SET
  verified = 1, verified_at = excluded.verified_at, source = 'email', test_id = excluded.test_id,
  updated_at = excluded.updated_at, rev = excluded.rev
WHERE perek_verifications.verified = 0;
-- 4. other live links for the same perek are now moot
UPDATE perek_tests SET consumed_at = ?t, outcome = 'covered'
WHERE consumed_at IS NULL AND (child_id, masechta, perek) =
  (SELECT child_id, masechta, perek FROM perek_tests WHERE token_hash = ?h AND outcome = 'verified');
-- 5. read back: the lookup SELECT from §5.2
```

Statements 1 to 4 are built by `setVerificationStmts` (§11), so the admin seam uses the same upsert shape.

Response, using the §5.2 decision order on statement 5:
- `verified`: `200 PerekTestInfo`. A repeated confirm or a double tap also returns 200 `verified`, so confirm is idempotent. Statements 2 and 3 match only on this call's `consumed_at = ?t`. Two confirms in the same millisecond can bump `rev` twice, which is harmless; leave a comment in the code.
- `expired`: `400 invalid_link`, message "This test link has expired."
- invalid: `400 invalid_link`.

**Why a tap and not verify-on-GET.** Link scanners (Outlook Safe Links, Gmail, corporate gateways) GET every URL, and some of them run JavaScript. A GET of `/perek-test#t=…` downloads only the SPA shell. The token sits in the fragment, and only a human tap calls confirm. The page also asks the real question ("Did {Name} say it to you?"), which is the point of the feature.

---

## 6. The email (`worker/email/perekTestEmail.ts`, new)

### 6.1 Text source: `worker/data/text.json` (generated, committed)

`scripts/build_data.py` writes this file next to the hashed masechta file it already writes:
```json
{"berakhot": {"source": "/data/m/berakhot.4b6dfb81e3.json", "he": "ברכות", "en": "Berakhot",
              "perakim": {"1": [["מֵאֵימָתַי קוֹרִין …", "…"], ["…"]], "2": [ … ]}}}
```
`perakim[perek][mishnahIndex][pieceIndex] = chunk.he`, after `hide.json` processing. These are exactly the pieces the app shows. The file is about 36 KB raw (7.5 KB gzipped) for Berakhot, and about 2.6 MB raw for all of Shas, still inside Worker limits. If it grows past that, split it per masechta.

Add `"resolveJsonModule": true` to `worker/tsconfig.json`. Wrangler's esbuild bundles JSON natively.

**Drift guard.** A client-project test (node) asserts, for every catalog entry, that `text.json[id].source === entry.file` and that the pieces equal `public/data/m/<file>` chunk by chunk.

### 6.2 Name safety

`emailSafeName(name)`:
- strips `\p{Cc}`, U+200E/U+200F and U+202A–U+202E;
- strips U+2066–U+2069 (bidi overrides that could visually reorder the copy);
- collapses whitespace and trims;
- caps the name at 40 characters;
- falls back to `"Your child"` if nothing is left.

The result then goes through the existing `escapeHtml()` (from `loginEmail.ts`, moved to `worker/email/html.ts` and imported by both). Every interpolation, including the trusted Hebrew and the link, goes through `escapeHtml`. The subject is plain text with CR and LF removed. The emoji is used only if it is at most 16 characters with no control characters; otherwise it is omitted.

### 6.3 Content: exact copy

Pronouns are avoided, since the child's gender is unknown. `{Name}` is the safe name, `{Masechta}` is `masechtaEn`, `{N}` is the perek number in digits, `{hebN}` is `hebNum(N)` and `{M}` is `masechtaHe`.

**Subject:** `🎉 {Name} finished {Masechta} Perek {N}! Time for a quick test`

**HTML body.** Same card layout and colors as `loginEmail.ts`. The outer `dir="ltr"`, max-width 520px.

1. `משנה בעל פה` (with `dir="rtl" lang="he"`), then "Mishnah Ba'al Peh" in grey.
2. Heading: **"{emoji} {Name} learned a whole perek by heart!"**
3. "{Name} just finished **{Masechta}, Perek {N}** (<span dir="rtl" lang="he">מסכת {M} פרק {hebN}</span>) and tapped **"I'm ready to be tested."** That's a big deal, so please give {Name} a high five from us! 🙌"
4. "**Your part:** sit together and have {Name} say the whole perek by heart. The text is below so you can follow along. When {Name} knows it, tap the button, and {NextLine}"
   - `{NextLine}` = "the next perek opens in the app." Or, on the last perek: "{Masechta} is officially complete!"
5. **Button, above the text** so it survives Gmail's ~102 KB clipping: **"Open {Name}'s test page"**, linking to `${APP_ORIGIN}/perek-test#t=<token>`.
6. "Small slips are fine. You know best. If it needs more work, tap "Not yet" on the test page. {Name} can keep practicing, and you can test again later with the same link."
7. A rule, then "**{Masechta} Perek {N}, phrase by phrase**". Under it: "*The same pieces {Name} learned in the app.*"
8. For each mishnah, a `<div dir="rtl" lang="he" style="text-align:right;font-family:'Frank Ruhl Libre','Noto Serif Hebrew','David','Times New Roman',serif;font-size:21px;line-height:1.9">`:
   - `<b>משנה {hebNum(i)}</b>`;
   - one bare `<div>` per piece. There is no numbering, so LTR digits don't fight the RTL text, and one style on the container keeps the size down.
9. Small print (grey, 13px):
   - "This link works for 30 days on any phone or computer. No sign-in needed. It opens a page where you tap once to confirm."
   - "You got this email because {Name} asked to be tested in Mishnah Ba'al Peh. {Name} can send at most one test email every 10 minutes. If you didn't expect this, you can ignore it."
   - "If the button doesn't work, open: {link}" (`word-break:break-all`).
   - "If the page doesn't show {Name}'s test, reload it once." (This covers an old cached app version on the parent's phone; see §15.)

**Text part:** the same words in the same order, each Hebrew piece on its own line, a blank line between mishnayos, and the raw link after item 5 and again at the end.

**Size:** Berakhot perek 2 has 73 pieces, about 30 KB of HTML. A test asserts that every perek of every masechta stays under 90 KB.

**Logging:** never log the token or the body, the same rule as login. `LogSender` prints only on localhost and is unchanged. In dev the child's screen shows "(Dev: the link is in the Worker log.)" when `ConfigResponse.devEmail` is true.

---

## 7. Sync, offline and multiple tablets

### 7.1 Pull (`worker/routes/sync.ts`)

Add one read to the existing read part of the batch:
```sql
SELECT child_id, masechta, perek, verified, verified_at, updated_at
FROM perek_verifications
WHERE user_id = ?1 AND rev > ?2
  AND child_id IN (SELECT id FROM children WHERE user_id = ?1 AND deleted = 0)
```
Map the rows to `PerekVerificationRow[]` and return them as `verifications`, always present from this server, possibly `[]`. Confirm bumps `users.rev` and writes the row at that rev, so a single cursor covers children, progress and verifications.

Next to the existing tombstone purge (the `pushed` branch) add:
```sql
DELETE FROM perek_tests WHERE user_id = ?1 AND child_id IN (SELECT id FROM children WHERE user_id = ?1 AND deleted = 1);
DELETE FROM perek_verifications WHERE user_id = ?1 AND child_id IN (SELECT id FROM children WHERE user_id = ?1 AND deleted = 1);
```

### 7.2 Why the client cannot forge it

- `SyncRequest` has no verifications field, and `validateSync` rebuilds every value from scratch. A top-level `verifications` key, or `verified: true` inside a `p` record's data, is dropped before SQL sees it. On the client, `cleanPerek` in `mapping.ts` also drops unknown keys.
- Only `setVerificationStmts` writes `perek_verifications`, and it is called only by confirm (and later the admin seam). Neither takes a value from the client.
- The client keeps the rows outside `Profile`, so no client code path (`diffProfiles`, `profileToRows`, export, import) can even see them to push.
- **Rule for PEREK_BUILDUP and all future work:** never add a verified or official flag to `PerekProgress` or `PerekProgressData`. Add a grep for `verified|official` in `PerekProgress` to the REVIEW checklist (SERVER_PLAN §13.1).

### 7.3 Client store (`src/sync/store.ts`)

```ts
export interface VerifiedEntry { verified: boolean; verifiedAt: Ms | null; updatedAt: Ms }
export interface AccountStore {
  // …existing…
  /** SERVER-OWNED. childId → "masechta|perek" → entry. Never pending, never diffed, never exported. */
  verified: Record<string, Record<string, VerifiedEntry>>;
  /** 1 once this device has done the catch-up sync that understands `verifications`. */
  verifSchema?: 1;
  /** Server clock minus device clock, from the last SyncResponse/PerekTestRequestResponse. */
  clockOffset?: number;
  /** This device's last successful test request per child (for the waiting screen). */
  lastTest?: Record<string, { masechta: string; perek: number; sentAt: Ms; nextAllowedAt: Ms }>;
}
```
- `emptyStore` sets `verified: {}`. `loadStore` defaults a missing or invalid `verified` to `{}`, and **does not** fail `isStore` because of it.
- `applyServerResponse`: for each `r.verifications` row, apply it **unconditionally**, because the server wins and there is no pending check. Do this only for children present in `profiles`. Drop the `verified[childId]` entry of children removed by a tombstone. Set `clockOffset = r.serverTime - now`.
- **Cursor catch-up:** an old SPA that the service worker kept alive could have moved the cursor past a verification row while ignoring the unknown field. When `verifSchema !== 1`, the engine sends `cursor: 0` once. `applyServerResponse` sets `verifSchema: 1` only when the response carries a `verifications` array. A full pull is safe: `applyServerResponse` never overwrites pending keys, and it is the same as a fresh device. Pulls are small (about 60 rows per child).
- Sign-out and account deletion clear the store as today, `verified` included.

### 7.4 Offline-first

- Progress stays local-first, exactly as today. Learning inside the frontier perek works offline.
- `verified` is saved with the store, so an offline tablet keeps the perakim it has already unlocked. It just can't see new verifications until it syncs.
- Requesting a test needs the network and is never queued.
- Locked perakim stay locked offline. Nothing on the device can unlock them.

### 7.5 Multiple tablets

- The cooldown lives on the server per child, so two tablets can't double-send. The second tablet gets 429 with `retryAfterSec` and shows the waiting screen with that countdown.
- Every tablet picks up the verification on its next pull: the 60-second interval, focus, visibility, or the 30-second waiting-screen poll.
- `lastTest` is per device. A tablet that didn't send shows "Your test was already sent a few minutes ago 📬" only if it gets a 429. Otherwise it shows the normal "ready" button. That is acceptable: tapping it just gets the 429 path.

### 7.6 Stale clients

An old SPA, before its service worker updates, has no gate and keeps working as today. A child on it can learn later perakim locally, and that progress syncs and is kept. It can never produce a verification. When `UpdateBar` updates it, the gate applies immediately from server data. This is acceptable: the gate concerns *official* completion.

---

## 8. Client gating rules (`src/progress.ts`)

These are pure functions with no React. The verified set is an explicit argument, so `Profile` stays unchanged.

```ts
/** Perakim the server says are verified, for the active masechta. Built by LearningApp from AccountStore.verified. */
export type Verified = ReadonlySet<number>;
export const NONE_VERIFIED: Verified = new Set();

/** SEAM owned by PEREK_BUILDUP: the whole perek has been learned (the whole-perek step is passed). */
export const perekLearned = (p: Profile, perek: number): boolean => pp(p, perek).complete;

/** First perek, in order, not verified by a parent; null when every perek is verified. */
export const frontier = (v: Verified): number | null => PERAKIM.find((k) => !v.has(k)) ?? null;

export const isLocked = (v: Verified, perek: number): boolean => { const f = frontier(v); return f !== null && perek > f; };

export type PerekPhase = "verified" | "learning" | "test" | "locked";
export function perekPhase(p: Profile, v: Verified, perek: number): PerekPhase {
  if (v.has(perek)) return "verified";
  if (isLocked(v, perek)) return "locked";
  return perekLearned(p, perek) ? "test" : "learning";
}

/** Gate wrapper around the build-up's nextLearning. It never looks at PerekProgress internals itself. */
export function gatedNextLearning(p: Profile, v: Verified): Task | null {
  const t = nextLearning(p);              // build-up logic, unchanged
  const f = frontier(v);
  if (f === null) return t;               // everything verified
  if (t && t.perek < f) return t;         // e.g. a verified perek that was reset: relearning it is fine
  if (perekLearned(p, f)) return { type: "perek-test", perek: f };
  return t && t.perek === f ? t : null;   // never past the frontier
}

/** Gate wrapper around dueReviews: nothing from locked perakim, and no review-p of the frontier while it awaits its test. */
export function gatedDueReviews(p: Profile, v: Verified, now: string = today()): Task[] {
  const f = frontier(v);
  return dueReviews(p, now).filter((t) =>
    f === null || t.perek < f || (t.perek === f && !(t.type === "review-p" && perekLearned(p, f))));
}
```

- The `Task` union gains `{ type: "perek-test"; perek: number }`.
- Every caller switches to the gated versions:
  - `LearningApp` (onStart, `more`);
  - `GuestApp` (onStart, `more`);
  - `Home` (label);
  - `Session` (`upNext`);
  - `Parent` ChildCard ("due" count).
- `Session` gets `more: (p) => gatedNextLearning(p, verified)`.
- **Verified perakim stay verified** even when a mishnah is reset or a `review-p` sends mishnayos back to box 0.
- **Locked-perek guards (defense in depth):** `LearningApp` and `GuestApp` ignore `onOpenMishnah` for a locked perek and open the locked sheet instead. They also drop any task with `isLocked(v, task.perek)` before building a session.
- **Reviews of locked perakim are paused.** Their Leitner data is untouched. When a perek unlocks, it either becomes the new frontier, and its test step includes a full read-through, or its overdue reviews come back. Cap the review part of one session at **6 tasks, oldest due first**, so a legacy child isn't buried as perakim unlock. This is implemented in `gatedDueReviews`'s callers, not in `dueReviews`.
- **Counts:** the gold `.perek-row.complete` style and the parent area's "{n} perakim" now count **verified** perakim. Learned but untested perakim are shown separately (§10.5).

---

## 9. Guest mode: ungated, never counts (owner's decision)

Guest mode (`src/GuestApp.tsx`) has no account and no email. It never imports the API client.

**Decision (owner):** guest mode is **not gated**. It is the way a child who is waiting (no internet, parent not available) keeps learning. Guest progress is never official: the signed-in guest is in memory only, and the signed-out guest's saved progress can reach an account only through the import rule below, and it always arrives **unverified**, so the normal gate applies. Guest therefore cannot bypass verification; it just lets learning continue.

GuestApp uses the ungated functions (equivalent to "everything verified" for gating purposes) and never shows the ready-to-be-tested button. Its whole-perek step ends with the normal in-app completion, plus this note: **"In your own profile, Abba or Ima test you before the next perek opens."**

**"Continue as a guest" from a locked perek (signed-in accounts):** the locked sheet (§10.2) and the waiting screen (§10.1, states "sent/waiting", "offline") offer it. It opens the signed-in, in-memory GuestApp **starting directly at that perek** (new optional `GuestApp` prop `start?: { perek: number; mishnah?: number }`; its learner starts with no progress, and the first session is that perek's first mishnah). Leaving guest returns to "Who's learning?" as today. Copy (exact; never say "for fun" or call the learning a game; Torah learning is worthwhile in itself):
> **Want to keep going?** Continue as a guest. It won't count toward your progress, but you can keep learning Torah.
> [Continue as a guest]

**Import rule (owner):** guest/legacy progress saved on the device is offered for import **only into an account that has no children yet** (i.e. a new account). If the account already has at least one child (deleted children excluded), neither the automatic `ImportPrompt` nor the parent area's manual import of device progress is shown; the device data is simply left alone. (Backup-file import in the parent area is a separate, deliberate parent action and stays.) Imported children arrive with new ids and **no verifications**. The import result text adds: "Perek tests start fresh for imported children: each perek opens after you test it."

---

## 10. Screens and exact copy

Copy principles: use "waiting for you", "opens", "saved", "almost there". Never use "blocked", "denied", "skipped" or "cheated". Every locked message names the one next action and offers a button to it. The real test gets the biggest celebration in the app.

### 10.1 PerekTestTask (`src/screens/Session.tsx`)

`Session` gets an optional prop:
```ts
interface PerekTestApi {
  verifiedAt(perek: number): Ms | null;          // from AccountStore.verified
  lastTest(perek: number): { sentAt: Ms; nextAllowedAt: Ms } | null;
  serverNow(): Ms;                               // Date.now() + clockOffset
  request(perek: number): Promise<RequestResult>; // await syncNow(); POST; apply the result
  refresh(): void;                               // syncNow()
  online: boolean; devEmail: boolean;
}
type RequestResult = { kind: "sent" | "already" } | { kind: "cooldown"; retryAfterSec: number }
  | { kind: "offline" | "signedOut" | "failed" | "notFrontier" };
```
`LearningApp` builds it from `useAccount` and `api`. `GuestApp` passes nothing and, being ungated (§9), never schedules a `perek-test` task. This keeps `Session` free of the API client, which guest mode requires.

When the test task opens, the component picks a state. If the perek is verified, it shows the celebration. If `lastTest` exists and is recent (sent less than 30 days ago), it starts in **waiting**. Otherwise it starts at stage A.

**Stage A: Read it through** (the "review of the whole perek")
- Title: **"{emoji} פרק {hebN}: the whole perek!"**
- Sub: "You learned every mishnah. Let's get ready for your test."
- Body: the whole perek at cue 0, one phrase per line, grouped under "משנה א׳", "משנה ב׳" and so on. These are the same `chunk.he` pieces the email uses. Meanings are hidden and words can't be tapped.
- Primary: **"I read it ›"**.

**Stage B: Say it once by yourself**
- Prompt: "Now say the whole perek by heart, like you will for Abba or Ima."
- `Recite` with every mishnah card at L4 and peeks counted. It emits `recite` with task `"pre-test"`, `mishnah: null`, `step: null`. The SRS doesn't change.
- Result, which never blocks:
  - 0 or 1 peeks: "Sounds ready! 🌟". Primary: **"🙋 I'm ready to be tested"**.
  - 2 or more peeks: "You peeked {n} times. Want to practice a little more first?" Primary: **"Practice more"** (back to stage A). Secondary: **"I'm ready anyway"**.

**Confirm sheet** (stops accidental taps that would use up the cooldown):
> **Send your test to Abba or Ima?**
> We'll email them the perek so they can listen to you say it. When they say you know it, the next perek opens!
>
> [📬 Yes, send it!]  [Not yet, I'll practice]

**States after sending:**

| State | What the child sees | Buttons |
|---|---|---|
| sending | "Sending…" (spinner) | none |
| waiting | 📬 **"We sent your test to Abba or Ima!"** "When they test you and tap the link in the email, פרק {hebN+1} opens. Sent {k} minutes ago." On the last perek: "…, מסכת {M} is all done!" | Primary **"Practice while you wait"** (a read-through, no progress change). Secondary **"My map"**. Ghost: during the cooldown it is disabled with "You can send it again in {m} min"; afterwards it reads "Didn't get it? Send it again". |
| cooldown (429) | 📬 **"Your test was already sent a few minutes ago!"** Then the same as waiting, with the countdown from `retryAfterSec`. | as waiting |
| verified | Shown once per verification per device: ⭐⭐⭐ **"Mazel tov, {Name}! It's official!"** "Abba or Ima tested you on מסכת {M} פרק {hebN}. פרק {hebN+1} is open!" | Primary **"Start פרק {hebN+1} ›"**. Secondary **"🗺️ See my map"**. On the last perek: "You finished מסכת {M}! 🏆" with only "See my map". |
| offline | "You're offline. Your test needs the internet to send. Ask a grown-up to connect, then try again." In the waiting state: "Connect to the internet to see if Abba or Ima tested you." | The ready button is disabled. |
| signed out (401) | "Ask Abba or Ima to sign in again, then you can send your test." | [Go to parent area] |
| email failed (502) | "Oops, the email didn't go through. Let's try again in a minute." | [Try again] |
| not frontier | Silent `syncNow()`, then re-render from the new gate. | none |
| dev email | The waiting state plus "(Dev: the link is in the Worker log.)" | |

- **Polling:** while the waiting or cooldown state is visible, call `refresh()` on mount, on `visibilitychange` to visible, on `focus`, and every **30 seconds**. Stop when the screen is hidden or unmounted. **Resolved:** 30 seconds (UX) rather than 15 (backend). The parent page promises "within a minute", and every poll is an empty-push `/api/sync`, the only sync pipe.
- **Celebrate-once flag:** `kv["baalpeh:v2:celebrated:<childId>:<masechta>:<perek>"] = verifiedAt`. If it is missing or differs, celebrate. A verify, un-verify, verify sequence therefore celebrates again. The celebration also shows on Home if the child is there when the row arrives.
- **Countdown:** remaining = `nextAllowedAt - serverNow()`, shown in whole minutes, rounded up. At 0 or less the button is enabled.

**In-app ParentChecks stay.** The per-mishnah and per-chain checks are useful learning moments. Recommendation to PEREK_BUILDUP: end the final whole-perek step with a self-recitation, not another in-app `ParentCheck`, or the child gets "show Abba or Ima" twice in a row. This flow works either way.

### 10.2 Home map (`src/screens/Home.tsx`)

`Home` gets new props: `verified: Verified`, `testState?: (perek) => "none" | "sent"`, `onOpenTest(perek)` and `onLocked(perek)`.

| Phase | Visual | Tap |
|---|---|---|
| verified | Gold border (the existing `.complete` style, now driven by verified) and a small **"✔ tested"** seal by the label | Circles open MishnahScreen, as today. |
| learning (frontier) | As today | As today. |
| test (frontier, learned, untested) | A normal row plus a badge: **"🙋 Test me!"** (gently pulsing), or **"📬 Waiting"** once this device has sent | The badge opens the test task. Circles still open MishnahScreen; practice is fine. |
| locked | `.perek-row.locked`: about 45% opacity, desaturated, 🔒 by the label, circles drawn with `aria-disabled`, **stars still shown (greyed)**. The whole row is **one button** with `aria-label="פרק {hebN}, locked until פרק {hebF} is tested"`, so the state isn't shown by color alone. | Opens the locked sheet. |

**Locked sheet** (a bottom sheet, never a scolding modal):
- Untouched locked perek: **"🔒 פרק {hebN} is waiting for you!"** "First show Abba or Ima that you know פרק {hebF}. Then this one opens." [Go to פרק {hebF} ›] [OK]
- Locked perek with saved progress: **"⭐ You already learned some of פרק {hebN}, and it's all saved!"** "It opens after Abba or Ima test you on פרק {hebF}." [Get ready for my פרק {hebF} test ›] [OK]
- Both variants end with the "Want to keep going? Continue as a guest" block from §9.

"Go to …" opens the frontier: its test task if it is in phase test, otherwise the normal gated session.

**The main button's sub-label** (replaces the current `label` logic):
- reviews due and the frontier is in test: "{n} review(s), then your perek test"
- frontier in test, not sent: "Get ready for your פרק {hebF} test"
- frontier in test, sent: "Waiting for your test 📬 · practice while you wait"
- everything verified: "All caught up!"
- otherwise: as today.

### 10.3 One-time banner for existing children

Show it on Home when the child has `perekLearned` true for the frontier or for any later perek, and has no verification at all. Show it once per child per device (`kv["baalpeh:v2:verif-intro:<childId>"]`), and let the child dismiss it:
> **🎉 Something new!** Now, when you finish a perek, Abba or Ima test you for real, and then the next perek opens.
> You already learned a lot, and **all your stars are saved.** Let's start with **פרק {hebF}**: show them you know it, and your perakim open one by one.
> [Get ready for my test ›]  [OK]

Then "Continue learning" (the gated `nextLearning`) goes to perek F's test task, stage A (the whole-perek review), then the ready button.

### 10.4 Parent landing page (`src/screens/PerekTestLanding.tsx`, new; public SPA route)

**Routing (`src/App.tsx`).** Next to `LICENSES_PATH`: `takePerekTestToken()` runs once per page load, outside React, as `takeVerifyToken` does. It reads `#t=` only when `location.pathname === "/perek-test"` and calls `history.replaceState(null, "", "/perek-test")`. `App()` renders `<PerekTestLanding token=…/>` **outside `AuthShell`**, so it never calls `/api/me`, never starts sync and never shows the import prompt. It needs no `DataGate`, because the text comes in the lookup response. No `wrangler.jsonc` change is needed: `not_found_handling: "single-page-application"` already serves `index.html` for `/perek-test`.

It is mobile first: a single column, 16px gutters, large tap targets, and Hebrew at about 28px with `line-height` of at least 2.

**On load:** `POST /api/perek-tests/lookup {token}`. While it loads: "Loading…".

**Pending:**
1. Header: `משנה בעל פה` · "Mishnah Ba'al Peh"
2. **"{emoji} {Name} is ready for a test!"** Under it: "מסכת {M} פרק {hebN} · {Masechta} Perek {N}"
3. "Have {Name} say the whole perek by heart. Follow along below: every line is a piece {Name} practiced." A toggle reads **"Hide text" / "Show text"**, for a parent who wants to test without looking.
4. The text, grouped by mishnah, one phrase per line (`dir="rtl" lang="he"`).
5. **Sticky bottom bar:**
   - **[✅ {Name} knows it, open the next perek]** (on the last perek: **[✅ {Name} knows it]**) calls confirm.
   - **[🔁 Not yet, a bit more practice]** is client-only.

**Results:**
- confirm 200: 🎉 **"Mazel tov! Perek {N} is officially done."** "{Name}'s next perek opens the next time the app is online, usually within a minute. Tell {Name} how proud you are!" If `nextPerek` is not null, add: "If {Name} has already learned Perek {nextPerek} too, the app will ask for that test next."
- not yet: **"Thanks! Tell {Name} to keep practicing 💪"** "This link still works. Come back and tap "knows it" any time in the next 30 days." Both buttons stay.
- already verified (lookup or confirm): **"✓ Already done. {Name} passed Perek {N} on {date}."**
- expired: **"This test link has expired."** "Ask {Name} to tap "I'm ready to be tested" in the app to get a new one."
- invalid: **"This test link isn't valid anymore."** "{Name} can send a new one from the app."
- offline / 429 / other: "You're offline. Connect and tap again." / "Too many tries. Wait a few minutes and try again." / "Something went wrong. Try again."

### 10.5 Parent area (`src/screens/Parent.tsx`)

- `ChildCard` summary: "{known}/{total} mishnayos · **{verified} perakim tested** · {due} due". When there is any, add "· פרק {hebF} learned, waiting for a test".
- `ChildCard` gets a **"Perek tests"** disclosure, one line per perek:
  - "✔ Tested {date}"
  - "📬 Test email sent {k} min ago" (from this device's `lastTest`)
  - "🙋 Learned, ready for a test [Send test email]" (frontier only; same endpoint and cooldown, showing "Resend in {m} min" while it runs)
  - "🔒 Opens after פרק {hebF}"
  - "Not learned yet"
- **There is no "Mark as tested" button** (§1).
- Add to "How it works": "When your child finishes a perek, they tap "I'm ready to be tested" and you get an email with the text. Listen, then tap the link in the email. Only then does the next perek open."

---

## 11. Seam for the later parent admin (`worker/lib/verification.ts`)

```ts
export function setVerificationStmts(db: D1Database, a: {
  userId: string; childId: string; masechta: string; perek: number;
  verified: boolean; source: "email" | "admin"; testId: string | null; t: number;
}): D1PreparedStatement[];
// verified=true  (only callers: confirm): rev bump + upsert at that rev + mark sibling links 'covered'
// verified=false (later admin): rev bump + upsert verified=0 at that rev +
//   UPDATE perek_tests SET consumed_at=?t, outcome='revoked' WHERE child_id/masechta/perek AND consumed_at IS NULL
```
Confirm uses the token-keyed form, the §5.3 SQL. The admin form keys on `(userId, childId, masechta, perek)`.

A later `POST /api/children/:id/verifications { masechta, perek, verified: false }` with `requireUser` is safe, because un-verifying only removes access. Revoking the pending links stops an old email from silently re-verifying. **Setting `verified: true` from the parent area must call the request flow (§5.1) and send an email. It must never write directly.** Un-verifying perek k re-locks everything after k, because the client derives the lock with no local latch. Later verified perakim stay verified, and they reopen when k is verified again.

---

## 12. File-by-file change list

**Server**
- `migrations/0006_perek_verification.sql`: new (§3).
- `shared/api.ts`: the additive types from §4: `PEREK_TEST`, request, response and info types, `PerekVerificationRow`, `SyncResponse.verifications?` and `ReciteTask` `"pre-test"`. This needs owner sign-off.
- `shared/hebrew.ts`: new; `hebNum` moved here from `src/data.ts`.
- `worker/routes/perekTests.ts`: new (§5). Mount it in `worker/index.ts`.
- `worker/lib/verification.ts`: new (§11).
- `worker/lib/rateLimit.ts`: add the exported `limit()`, moved from `auth.ts`. `worker/routes/auth.ts` imports it.
- `worker/lib/validate.ts`:
  - `validatePerekTestRequest`;
  - `validateToken`, shared with `validateVerifyLink`;
  - `"pre-test"` added to the recite tasks.
- `worker/lib/text.ts`: new. It imports `../data/text.json` and exports `masechtaText(id)` and `perekPieces(id, perek)`.
- `worker/email/html.ts`: new; `escapeHtml` and `emailSafeName`. `loginEmail.ts` imports `escapeHtml` from here.
- `worker/email/perekTestEmail.ts`: new (§6).
- `worker/routes/sync.ts`: the `verifications` pull and the tombstone purge of both tables (§7.1).
- `worker/routes/me.ts`: `DELETE FROM perek_tests WHERE user_id=?1` and `DELETE FROM perek_verifications WHERE user_id=?1`, placed before `children` in the batch.
- `worker/cron.ts`: `DELETE FROM perek_tests WHERE expires_at < ?1`, with `now - 30 d`. `perek_verifications` is kept for good.
- `worker/tsconfig.json`: `"resolveJsonModule": true`.
- `worker/data/text.json`: generated and committed. `scripts/build_data.py` emits it.
- `docs/SERVER_PLAN.md`:
  - the endpoint and rate-limit tables;
  - a pointer to this doc;
  - a §13.1 checklist item: "no verified/official flag in PerekProgress; verification written only via lib/verification.ts".

**Client**
- `src/progress.ts`: `Verified`, `perekLearned`, `frontier`, `isLocked`, `perekPhase`, `gatedNextLearning`, `gatedDueReviews`, and the `perek-test` Task (§8).
- `src/sync/store.ts`: `verified`, `verifSchema`, `clockOffset`, `lastTest`, plus the `applyServerResponse` changes (§7.3).
- `src/sync/engine.ts`: use `cursor: 0` while `verifSchema !== 1`.
- `src/sync/useAccount.ts`: expose `verifiedFor(childId): Verified` (active masechta), `requestTest(childId, perek)`, `serverNow()` and `lastTest`.
- `src/api/client.ts`: `perekTest`, `perekTestLookup` and `perekTestConfirm`.
- `src/LearningApp.tsx`: build the `PerekTestApi`; use the gated functions; add the lock guards; open the locked sheet.
- `src/GuestApp.tsx`: stays ungated; add the `start` prop and the end-of-perek note (§9).
- `src/LearningApp.tsx` / `src/screens/Parent.tsx`: import of device progress only when the account has no children (§9).
- `src/screens/Session.tsx`: `PerekTestTask` (stages A and B, the confirm sheet, the states), the `perekTest` prop, `nextLabel` for `perek-test` ("Get ready for your test ›"), and `upNext` via the gated function.
- `src/screens/Home.tsx`: row phases, badges, the locked sheet, the banner and the sub-labels (§10.2, §10.3).
- `src/screens/Parent.tsx`: verified counts, the "Perek tests" disclosure, the "How it works" copy, and the import note.
- `src/screens/ImportPrompt.tsx`: the import note (§9).
- `src/screens/PerekTestLanding.tsx`: new (§10.4). `src/App.tsx` adds the route and `takePerekTestToken`.
- `src/data.ts`: re-export `hebNum` from `shared/hebrew.ts`.
- `src/styles.css`: `.perek-row.locked`, `.badge`, `.seal`, the bottom sheet, the banner and the landing page.
- `src/types.ts`: no change to `PerekProgress`. `_typesMatchShared` stays untouched.

---

## 13. Depends on PEREK_BUILDUP

`docs/PEREK_BUILDUP.md` did not exist when this was written. This spec needs exactly these things from the build-up work, and nothing else.

1. **The hook point: `perekLearned(p, perek): boolean`** in `src/progress.ts`. It is true exactly when the whole-perek step (the last stage of the 1 → 2 → 1–2 → … → whole-perek build-up) has been passed. Today it is `pp(p, perek).complete`. The build-up owns the predicate's body and keeps it current. If the build-up adds a field, for example `PerekProgress.wholePassed`, the body becomes that field; nothing else here changes.
2. **`nextLearning(p): Task | null`** keeps returning tasks that carry `perek`, and it works through perakim in catalog order, earliest unfinished perek first. The gate wraps it (`gatedNextLearning`) and never reads its internals. If the build-up returns new task types (for example `perek-buildup` or `perek-screen`), they only need a `perek` field.
3. **`dueReviews(p)`** returns tasks that carry `perek`. The gate filters them.
4. **The end of the whole-perek step goes on to `more()`** (the gated `nextLearning`), so the next task after passing it is `perek-test`. The celebration's next button label for a `perek-test` task is "Get ready for your test ›".
5. **No verified or official flag in `PerekProgress` or `PerekProgressData`.** New optional fields are fine.
6. **If the build-up adds a perek screen** (a per-perek page with the build-up path), it must:
   - take `perekPhase(p, v, perek)`;
   - render `locked` as non-interactive, with the §10.2 sheet;
   - show the "🙋 Test me!" / "📬 Waiting" entry point when the phase is `test`;
   - show the "✔ tested" seal when the phase is `verified`.
   The Home rules in §10.2 apply to whichever screen lists perakim.
7. **Optional:** the whole-perek step ends with a self-recitation rather than an in-app `ParentCheck` (§10.1).

**If that spec differs:**
- If it has no single "whole perek passed" state (for example, it is derived from several fields), implement `perekLearned` as that derivation. The gate only needs a boolean.
- If its whole-perek step *is* a full read-through plus recitation, `PerekTestTask` may skip stage A and stage B for a perek whose whole-perek step was passed in this same session, and go straight to the ready button. Stage A stays available behind "Read it through first".
- If `nextLearning` can return tasks from several perakim at once (for example, interleaving), the wrapper still holds: it passes tasks for perakim before the frontier, substitutes `perek-test` when the frontier is learned, and drops anything after the frontier.
- If the build-up changes the `Task` union shape so that `perek` is missing on some task, add it. The gate depends on it.
- If it renames `nextLearning` or `dueReviews`, wrap the new names. The callers listed in §8 must use only the gated versions.

---

## 14. Deferred (not in this change)

- Recording "Not yet" on the server so the child sees "Abba or Ima says: a little more practice! 💪". This would be a `perek_tests.notyet_at` column flowing down in the same rows.
- "Test the next one now" on the landing page, for legacy children with many learned perakim.
- Parent admin: un-verify through the §11 seam, and "send test email" for any perek from the parent area.
- Showing verifications in `GET /api/children/:id/stats` and `ChildHistory`.
- More than one masechta: the keys already carry `masechta`.

---

## 15. Tests

### 15.1 Worker (`worker/test/perekTests.test.ts`, following `helpers.ts`)

Helpers: `requestTest(cookie, childId, perek)` and `lastPerekTestToken(email)`, which parses `#t=` from the captured Resend body.

Request:
1. No cookie gives 401. A foreign Origin gives 403. A non-JSON body gives 400. A bad `perek` (0, 10, "1"), an unknown masechta or a bad `childId` gives 400.
2. A child of another account, a tombstoned child, or a child that hasn't synced gives 404.
3. Happy path for perek 1:
   - exactly one email, to the **account** email, with `Idempotency-Key: perek-test-<id>`;
   - the subject contains the name and "Perek 1";
   - the HTML has `dir="rtl"`, `lang="he"` and every `text.json` piece of perek 1 in order;
   - the link matches `/perek-test#t=`;
   - `token_hash` equals `sha256(token)`, and the raw token is in no column;
   - the response has `sentTo` masked, `nextAllowedAt = t + 600000` and `serverTime`.
4. Frontier: a request for perek 2 with perek 1 unverified gives 400 `not_frontier`. After perek 1 is confirmed, the request for perek 2 gives 200.
5. Cooldown:
   - a second request for the same child within 10 minutes gives 429 with `retryAfterSec` in 590..600;
   - another child of the same account gives 200;
   - after `created_at -= 601000`, the first child gives 200 again.
6. Account cap: the 13th request in an hour gives 429 (use distinct children and age the cooldowns).
7. Resend returns 500: the response is 502, the row's outcome is `failed`, and an immediate retry gives 200.
8. Two concurrent requests (`Promise.all`) for one child give exactly one 200 and one 429.
9. Already verified: 200 with `alreadyVerified: true` and a `verification` row, and no email.
10. Name `"<b>Avi</b>‮\nX"`: the HTML contains `&#60;b&#62;Avi`, has no U+202E, and the subject has no CR or LF.

Lookup and confirm:

11. Lookup gives `pending` with the name, the perek, `nextPerek` and `mishnayos` equal to `text.json`. Three lookups leave `consumed_at` NULL and create no verification row. `GET /api/perek-tests/lookup` gives 404.
12. Confirm **without a cookie** gives 200 `verified`. The row has `verified=1`, `source='email'` and `test_id`, and `users.rev` went up. A second confirm gives 200 `verified` and no new rev bump.
13. Two links for one perek: confirming one marks the other `covered`, and lookup on the other gives `verified`.
14. Expired (`expires_at = now-1`): lookup gives `expired` and confirm gives 400 `invalid_link`. An unknown token gives 400. A tombstoned child gives 400. A foreign Origin on confirm gives 403. The 31st lookup or confirm from one IP in 15 minutes gives 429.

Sync and forgery:

15. After a confirm, `sync(cursor=before)` returns the `verifications` row and `sync(cursor=after)` returns `[]`.
16. Pushing a `p` record with `data.verified = true`, or a top-level `verifications: [...]`, gives 200, but no `perek_verifications` row is created and the stored `progress.data` has no `verified` key.
17. Un-verify via `setVerificationStmts(…, verified:false)` gives a pulled row with `verified:false`. Pending links become `revoked`, and confirming one gives 400.
18. Tombstoning the child purges both tables. `DELETE /api/account` purges both. The cron deletes tests whose expiry is more than 30 days past and keeps verifications.
19. A `recite` event with task `"pre-test"` is accepted. An unknown task is still rejected.

Email unit tests (`email.test.ts`):

20. For every perek of every masechta in `text.json`, the HTML is under 90 KB. The button `href` is escaped and appears **before** the first Hebrew piece. The heading numeral equals `hebNum(perek)`.
21. `emailSafeName` strips Cc, bidi and isolate characters, caps the name at 40, and falls back to "Your child".

### 15.2 Client (`tests/*.test.ts`, node)

1. `frontier`, `isLocked`, `perekPhase`:
   - nothing verified and perakim 1 to 3 complete: frontier = 1; 2 and 3 are locked; 1 is in `test`;
   - perek 1 verified and 2 complete: frontier = 2;
   - every perek verified: frontier = null.
2. `gatedNextLearning`:
   - returns `perek-test` for a learned frontier;
   - returns the build-up task inside the frontier;
   - never returns a task with `perek > frontier`;
   - returns an earlier task for a verified perek that was reset.
3. `gatedDueReviews`:
   - drops locked perakim and the frontier's `review-p` while it is in test;
   - keeps the reviews of verified perakim.
4. Un-verify: removing perek 1 from `Verified` locks 2 and 3 again with no other state change.
5. `applyServerResponse`:
   - applies `verifications` even when the child's `p` record is pending;
   - ignores rows for unknown children;
   - drops entries of tombstoned children;
   - sets `clockOffset`;
   - sets `verifSchema` only when the field is present.
   An old-shape response without `verifications` still works.
6. Engine: the first sync with `verifSchema` unset sends `cursor: 0`; later syncs send the stored cursor.
7. `diffProfiles` and `profileToRows` never emit anything from `verified`. Export (`AppState`) and `copyAsNew`/`normalizeProfile` carry no verification.
8. `loadStore` on a pre-feature store defaults `verified` to `{}` and still loads.
9. Countdown with a clock skew of ±10 minutes.
10. `takePerekTestToken`: the fragment is read once and stripped, only on `/perek-test`.
11. Landing-page logic: nothing calls confirm before a tap, and each result state maps to its copy. Use a pure reducer, so no DOM is needed.
12. Guest: GuestApp is ungated and starts at `start.perek`; the import prompt and the manual device import are hidden when the account has any child; imported children have no verifications.
13. Drift: `worker/data/text.json` matches `public/data/m/<file>` chunk by chunk, and its `source` equals `src/data/index.json`'s `file`.

---

## 16. Open risks

- **`shared/api.ts` is labeled FIXED.** This feature needs additive changes to it, so the owner has to sign off.
- **Inbox on the child's device.** If the account's email is signed in on the tablet the child uses, the child can confirm their own test. The only mitigation is the copy and "Tested {date}" in the parent area. Stronger proof, such as re-authentication on confirm, would add a lot of friction for parents.
- **Self-made account.** A child can make their own passwordless account and become its "parent". The parent area shows the account email, which is the only mitigation.
- **Legacy children with many learned perakim.** They need one email and one test per perek, in order, with at least 10 minutes between sends. "Test the next one now" is deferred (§14).
- **Review pile-up.** Reviews of locked perakim are paused, so they pile up and come back when those perakim unlock. The 6-per-session review cap mitigates this, but it is new behavior.
- **Stale service worker.** An old SPA stays ungated until it updates. It can't forge a verification.
- **The parent's phone with an old cached app.** It may show the login shell at `/perek-test` until it reloads. The email says "reload it once". A server-rendered fallback would need `run_worker_first` to include `/perek-test`; that is a `wrangler.jsonc` change, avoided here.
- **Cursor catch-up.** It relies on the one-time `cursor: 0` sync. If it is skipped, a device that ran an old SPA after the deploy can miss verification rows until the next confirm bumps the rev.
- **The generated `worker/data/text.json`.** It must stay in sync with `public/data/m`. The drift test lives in the client project, so CI must run both projects (it already runs `npm test`).
- **Product choices the owner may change:** keeping the verification across a progress reset ("reset = must re-test" would need the admin un-verify, not an inference from client-authored progress); and "Not yet" being client-only for now.

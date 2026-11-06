/**
 * shared/api.ts — the HTTP contract between the Worker (worker/) and the SPA (src/).
 * FIXED FILE: both sides import it; neither implementation agent may edit it.
 * (Additive, backward-compatible exceptions signed off for docs/PARENT_VERIFICATION.md §4: the perek-test types,
 * SyncResponse.verifications and ReciteTask "pre-test"; and for docs/PARENT_MODE.md §5: sign-in scopes, the PARENT
 * constants, the /api/parent/* and /api/pin-reset types, the PIN error codes, byParent on returned rows, and the PIN
 * fields of the perek-test types.)
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
  | "server_error" // 500
  | "parent_locked" // 403 parent session valid, PIN not entered (or idle/expired unlock)
  | "pin_not_set" // 409 unlock (or a PIN reset) asked, but the account has no PIN yet
  | "pin_required" // 400 perek-test confirm without `pin` on an account with a PIN
  | "invalid_pin" // 400 wrong PIN (attemptsLeft set)
  | "pin_locked"; // 403 5 wrong tries in a row; only a reset by email clears it

/** Body of every non-2xx JSON response. */
export interface ApiError {
  error: ErrorCode;
  message: string;
  /** Present on rate_limited. */
  retryAfterSec?: number;
  /** Present on invalid_code while the request is still live, and on invalid_pin. */
  attemptsLeft?: number;
  /** POST /api/perek-tests 429 only: which limit refused it. "cooldown": this child's test was sent minutes ago;
   *  "cap": the account sent too many test emails (no email exists for this request). */
  reason?: "cooldown" | "cap";
}

// ───────────────────────── Constants ─────────────────────────

export const AUTH = {
  CODE_LENGTH: 6,
  LOGIN_TTL_SEC: 15 * 60,
  MAX_CODE_ATTEMPTS: 5,
  SESSION_TTL_SEC: 30 * 24 * 60 * 60,
} as const;

/** Parent mode (docs/PARENT_MODE.md). */
export const PARENT = {
  PIN_LENGTH: 4,
  MAX_PIN_ATTEMPTS: 5,
  PIN_ITERATIONS: 5_000,
  /** Absolute, from sign-in (no sliding). */
  SESSION_TTL_SEC: 14 * 24 * 60 * 60,
  /** The PIN unlock re-locks after this long with no parent request... */
  UNLOCK_IDLE_SEC: 5 * 60,
  /** ...and this long after the PIN was entered, whatever happens. */
  UNLOCK_MAX_SEC: 60 * 60,
  PIN_RESET_TTL_SEC: 60 * 60,
  /** The first PIN can only be chosen this soon after the parent session's email sign-in; later, sign in again. */
  FIRST_PIN_WINDOW_SEC: 15 * 60,
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

/** Which sign-in (and so which session cookie): the learner app or parent mode. */
export type SignInAs = "learner" | "parent";

/** POST /api/auth/request — always 200 for a well-formed request (no account enumeration). */
export interface AuthRequestBody {
  email: string;
  turnstileToken: string;
  /** Default "learner". "parent" sends the parent sign-in email; its link and code mint a parent session. */
  as?: SignInAs;
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
  /** Default "learner". Must match the `as` of the request that sent the code, or the code is not found. */
  as?: SignInAs;
}

/** 200 response of verify-link and verify-code. */
export interface AuthSuccessResponse {
  user: User;
  /** True when this login created the account. */
  newUser: boolean;
  /** Which cookie was set; decided by the login request, never by the client. Absent from old servers = "learner". */
  scope?: SignInAs;
}

/** GET /api/me */
export interface MeResponse {
  user: User;
}

// POST /api/auth/logout → 204, clears cookie. No body.

/** DELETE /api/parent/account (unlocked parent session) — body must repeat the account email. 204, clears both cookies. */
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
  /** Longest passed chain [1..k]. Still maintained, for older clients and as legacy input. */
  chainedThrough: number;
  /** Progress only (marked done on the device); unlocks nothing. Verification is server-owned, never stored here. */
  complete: boolean;
  review?: ReviewItemData;
  /** Passed build-up chain ranges, "from-to" (1-based), sorted, none contained in another. Absent on older data. */
  chains?: string[];
}

export interface ChildSettings {
  fontScale: number;
  /** Absent: break suggestions are off. */
  breakMinutes?: number;
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
  /** Responses only: the last write to this child was a parent's (see RecordBase.byParent). */
  byParent?: true;
}

interface RecordBase {
  childId: string;
  updatedAt: Ms;
  /** Responses only (validators drop it from requests): the last write to this row was a parent's. A client drops a
   *  pending local value for the same key when such a row arrives (docs/PARENT_MODE.md §8.2). */
  byParent?: true;
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

/** "pre-test": the child's self-recitation of the whole perek before asking for the parent's test (changes no SRS state). */
export type ReciteTask = "learn" | "chain" | "detour" | "practice" | "review-m" | "perek-chain" | "review-p" | "pre-test";

export interface ReciteEvent {
  type: "recite";
  task: ReciteTask;
  perek: number;
  /** null for perek-level tasks. */
  mishnah: number | null;
  /** Step index within the mishnah for learn/chain/detour/practice; null otherwise. */
  step: number | null;
  grade: Grade;
  /** Total peeks during this recitation. */
  peeks: number;
  /** Time spent on this recitation. */
  ms: number;
  /** Perek-level recites (mishnah null): the 1-based mishnah range said. Absent on older events. */
  from?: number;
  to?: number;
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
  /**
   * Server-owned perek verifications with rev > request.cursor (children not deleted). Always present from a server
   * that knows the feature, possibly []; optional so older clients and servers interoperate. Never in SyncRequest.
   */
  verifications?: PerekVerificationRow[];
}

// ───────────────────────── Perek tests (parent verification, docs/PARENT_VERIFICATION.md) ─────────────────────────

export const PEREK_TEST = {
  /** One test email per child per this many seconds (failed sends don't count). */
  COOLDOWN_SEC: 10 * 60,
  /** Link lifetime. */
  TOKEN_TTL_SEC: 30 * 24 * 60 * 60,
  /** Per account: test emails per hour and per day. */
  MAX_PER_HOUR: 12,
  MAX_PER_DAY: 40,
} as const;

/**
 * POST /api/perek-tests (session). The server reads the text, the name and the recipient itself; the client sends none.
 * Errors: 401 unauthorized; 404 not_found (child unknown, deleted, other account, or not synced yet);
 * 400 bad_request with message "not_frontier" (an earlier perek is not verified on the server);
 * 429 rate_limited with retryAfterSec and reason "cooldown" (per-child) or "cap" (account); 502 email_failed (cooldown not used up).
 */
export interface PerekTestRequestBody {
  childId: string;
  /** Catalog id, e.g. "berakhot". */
  masechta: string;
  perek: number;
}
export interface PerekTestRequestResponse {
  ok: true;
  /** true: the perek is already verified on the server; no email was sent. Apply `verification`. */
  alreadyVerified: boolean;
  /** Present when alreadyVerified. */
  verification?: PerekVerificationRow;
  /** Masked account email, e.g. "y•••@gmail.com". Empty when alreadyVerified. */
  sentTo: string;
  /** When this child may ask again (server clock). */
  nextAllowedAt: Ms;
  /** Server clock, so the countdown is right even when the tablet's clock is off. */
  serverTime: Ms;
}

/**
 * POST /api/perek-tests/lookup (read-only) and POST /api/perek-tests/confirm (no session; the token is the credential).
 * lookup: 200 PerekTestInfo with status pending | verified | expired; 400 invalid_link otherwise.
 * confirm: 200 PerekTestInfo with status "verified" (idempotent); 400 invalid_link for an expired link
 * (message "This test link has expired.") or an invalid one. Both: 429 rate_limited per IP.
 */
export interface PerekTestTokenBody {
  token: string;
  /** confirm only (lookup and forgot-pin ignore it): the parent PIN, required once the account has one. */
  pin?: string;
}
export interface PerekTestInfo {
  status: "pending" | "verified" | "expired";
  childName: string;
  childEmoji: string;
  childColor: string;
  /** Catalog id. */
  masechta: string;
  /** e.g. "ברכות" */
  masechtaHe: string;
  /** e.g. "Berakhot" */
  masechtaEn: string;
  perek: number;
  /** null when this is the last perek of the masechta. */
  nextPerek: number | null;
  /** The perek's Hebrew pieces: mishnayos[mishnahIndex][pieceIndex] = chunk.he (the same text as the email). */
  mishnayos: string[][];
  requestedAt: Ms;
  verifiedAt: Ms | null;
  /** The account has a parent PIN, so confirm needs `pin`. Absent from old servers. */
  pinRequired?: boolean;
  /** The PIN is locked after 5 wrong tries: confirm can't succeed until it is reset by email. */
  pinLocked?: boolean;
}

/**
 * POST /api/perek-tests/forgot-pin {token} (no session; a live, pending test link) — emails a PIN reset link to the
 * account. 200 ForgotPinResponse; 400 invalid_link; 409 pin_not_set; 429 rate_limited; 502 email_failed.
 * POST /api/parent/pin/forgot (parent session, locked is fine) answers the same.
 */
export interface ForgotPinResponse {
  ok: true;
  /** Masked account email. */
  sentTo: string;
}

/** Server-authoritative. Pulled only; never accepted in a SyncRequest. */
export interface PerekVerificationRow {
  childId: string;
  masechta: string;
  perek: number;
  /** false: un-verified later (parent admin); the row is kept so the change reaches every device. */
  verified: boolean;
  verifiedAt: Ms | null;
  updatedAt: Ms;
}

// ───────────────────────── Parent views ─────────────────────────

/** GET /api/parent/children/:id/events?before=<Ms>&limit=<1..100, default 50> — newest first (unlocked parent). */
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

/** GET /api/parent/children/:id/stats?days=<1..365, default 30> (unlocked parent) */
export interface ChildStatsResponse {
  childId: string;
  since: Ms;
  /** Sorted by struggle, descending. */
  items: StruggleRow[];
  /** Ascending by day; days without events are omitted. */
  days: DayActivity[];
}

// ───────────────────────── Parent mode (docs/PARENT_MODE.md) ─────────────────────────
//
// Guards: "parent session" = the __Host-bp_parent cookie of an email sign-in with `as: "parent"` (401 unauthorized
// otherwise). "unlocked" = that, plus the PIN entered within the last UNLOCK_IDLE_SEC of parent requests and
// UNLOCK_MAX_SEC overall (403 parent_locked otherwise). A learner session is refused by every parent route.
//
// GET    /api/parent/me                         parent session → ParentMeResponse (slides the unlock: the ping)
// POST   /api/parent/unlock {pin}               parent session → ParentMeResponse | 400 invalid_pin | 403 pin_locked | 409 pin_not_set
// POST   /api/parent/lock                       no body, any cookie → 204 (a beacon)
// POST   /api/parent/pin {pin, tz?}             parent session; no PIN yet, or unlocked → ParentMeResponse (unlocked)
//                                               | 403 parent_locked | 403 pin_locked | 502 email_failed (nothing changed)
// POST   /api/parent/pin/forgot                 parent session (locked is fine) → ForgotPinResponse
// POST   /api/parent/logout                     → 204, ends the parent session only
// POST   /api/parent/learner-session            unlocked → MeResponse, sets the learner cookie
// POST   /api/parent/sync                       unlocked → SyncRequest / SyncResponse (parent writes, §6.7)
// GET    /api/parent/children/:id/events        unlocked → EventsResponse
// GET    /api/parent/children/:id/stats         unlocked → ChildStatsResponse
// POST   /api/parent/children/:id/verifications unlocked → SetVerificationsBody / SetVerificationsResponse
// GET    /api/parent/log?before&limit           unlocked → AuditLogResponse
// DELETE /api/parent/account {email}            unlocked → 204
// POST   /api/pin-reset/lookup {token}          no session, read-only → PinResetInfo | 400 invalid_link
// POST   /api/pin-reset {token, pin, tz?}       no session → 204 | 400 invalid_link | 502 email_failed

/** GET /api/parent/me, and the 200 body of unlock and pin. */
export interface ParentMeResponse {
  user: User;
  /** The address this parent session signed in with. */
  loginEmail: string;
  /** Absolute; the parent signs in by email again after it. */
  sessionExpiresAt: Ms;
  pin: { set: boolean; locked: boolean };
  /** null = locked (enter the PIN). */
  unlockedUntil: Ms | null;
  /** Only on unlock: wrong PIN tries (parent mode or test page) since the PIN was last entered right. */
  wrongTries?: number;
}
/** POST /api/parent/unlock */
export interface PinBody {
  pin: string;
}
/** POST /api/parent/pin. `tz`: IANA zone for the notice email (display only; UTC when missing or unknown). */
export interface SetPinBody {
  pin: string;
  tz?: string;
}
/** POST /api/pin-reset */
export interface PinResetBody {
  token: string;
  pin: string;
  tz?: string;
}
/** POST /api/pin-reset/lookup */
export interface PinResetInfo {
  /** Masked, e.g. "y•••@gmail.com". */
  email: string;
  expiresAt: Ms;
}

/** POST /api/parent/children/:id/verifications — 1..30 distinct perakim of one masechta. */
export interface SetVerificationsBody {
  masechta: string;
  perakim: number[];
  verified: boolean;
}
export interface SetVerificationsResponse {
  verifications: PerekVerificationRow[];
}

export type AuditAction =
  | "pin_set"
  | "pin_changed"
  | "pin_reset"
  | "pin_failed"
  | "pin_locked"
  | "perek_verified"
  | "perek_unverified"
  | "progress_edited"
  | "child_added"
  | "child_removed"
  | "child_edited";

/**
 * One change-log line. `detail` by action (docs/PARENT_MODE.md §6.6):
 * pin_reset {requestedVia: "parent" | "test_page"}; perek_verified / perek_unverified {masechta, perakim} (via test_link
 * also {testId, pinUsed}); progress_edited {keys: ("m:2:3" | "p:2")[] (max 60), count}; child_added {imported, rows};
 * child_edited {fields, from?: {name}, to?: {name}}; pin_failed {attemptsLeft}; others {}.
 */
export interface AuditEntry {
  id: string;
  at: Ms;
  action: AuditAction;
  childId: string | null;
  childName: string | null;
  detail: Record<string, unknown>;
  via: "parent" | "test_link" | "pin_reset_link";
  /** The login that made the change (a parent session's sign-in email, or the address a link went to). */
  actorEmail: string | null;
  /** Raw User-Agent; the client shows deviceLabel() (shared/device.ts). */
  actorDevice: string | null;
}
/** GET /api/parent/log?before=<Ms>&limit=<1..100, default 30> — newest first. */
export interface AuditLogResponse {
  entries: AuditEntry[];
  /** Pass as `before` for the next page; null when there are no more. */
  nextBefore: Ms | null;
}

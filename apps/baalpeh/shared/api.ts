/**
 * shared/api.ts — the HTTP contract between the Worker (worker/) and the SPA (src/).
 * FIXED FILE: both sides import it; neither implementation agent may edit it.
 * (Additive, backward-compatible exceptions signed off for docs/PARENT_VERIFICATION.md §4: the perek-test types,
 * SyncResponse.verifications and ReciteTask "pre-test".)
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

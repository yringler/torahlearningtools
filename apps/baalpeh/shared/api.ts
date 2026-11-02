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

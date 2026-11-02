/**
 * Hand-written validators for every request body (§7.3). Validated values are rebuilt from scratch,
 * so unknown extra properties are dropped and the raw input is never re-serialized.
 */
import {
  SYNC_LIMITS,
  type AuthRequestBody,
  type ChildMeta,
  type ChildRow,
  type ChildSettings,
  type DeleteAccountBody,
  type Grade,
  type LearningEvent,
  type LearningEventBody,
  type MishnahProgressData,
  type MishnahState,
  type PerekProgressData,
  type RecordRow,
  type ReviewItemData,
  type SyncRequest,
  type VerifyCodeBody,
  type VerifyLinkBody,
} from "../../shared/api";

export type Result<T> = { ok: true; value: T } | { ok: false; message: string; tooLarge?: true };

class Invalid extends Error {
  constructor(
    message: string,
    readonly tooLarge = false,
  ) {
    super(message);
  }
}

function run<T>(fn: () => T): Result<T> {
  try {
    return { ok: true, value: fn() };
  } catch (err) {
    if (err instanceof Invalid) return err.tooLarge ? { ok: false, message: err.message, tooLarge: true } : { ok: false, message: err.message };
    throw err;
  }
}

// ───────────── primitives ─────────────

type Obj = Record<string, unknown>;

function obj(v: unknown, path: string): Obj {
  if (typeof v !== "object" || v === null || Array.isArray(v)) throw new Invalid(`${path} must be an object`);
  return v as Obj;
}

function str(v: unknown, path: string): string {
  if (typeof v !== "string") throw new Invalid(`${path} must be a string`);
  return v;
}

function bool(v: unknown, path: string): boolean {
  if (typeof v !== "boolean") throw new Invalid(`${path} must be a boolean`);
  return v;
}

function int(v: unknown, path: string, min: number, max: number): number {
  if (typeof v !== "number" || !Number.isInteger(v) || v < min || v > max) {
    throw new Invalid(`${path} must be an integer in ${min}..${max}`);
  }
  return v;
}

function intOrNull(v: unknown, path: string, min: number, max: number): number | null {
  return v === null ? null : int(v, path, min, max);
}

function num(v: unknown, path: string, min: number, max: number): number {
  if (typeof v !== "number" || !Number.isFinite(v) || v < min || v > max) {
    throw new Invalid(`${path} must be a number in ${min}..${max}`);
  }
  return v;
}

function oneOf<T extends string>(v: unknown, path: string, allowed: readonly T[]): T {
  if (typeof v !== "string" || !(allowed as readonly string[]).includes(v)) {
    throw new Invalid(`${path} must be one of ${allowed.join(", ")}`);
  }
  return v as T;
}

function arr(v: unknown, path: string): unknown[] {
  if (!Array.isArray(v)) throw new Invalid(`${path} must be an array`);
  return v;
}

const ID_RE = /^[A-Za-z0-9_-]{8,64}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const M_KEY_RE = /^\d{1,3}:\d{1,3}$/;
const P_KEY_RE = /^\d{1,3}$/;

/** Epoch-ms timestamps: integers in (0, 1e13). */
function ms(v: unknown, path: string): number {
  return int(v, path, 1, 1e13 - 1);
}

function id(v: unknown, path: string): string {
  const s = str(v, path);
  if (!ID_RE.test(s)) throw new Invalid(`${path} is not a valid id`);
  return s;
}

function isoDate(v: unknown, path: string): string {
  const s = str(v, path);
  if (!DATE_RE.test(s)) throw new Invalid(`${path} must be yyyy-mm-dd`);
  return s;
}

function chars(s: string): number {
  return Array.from(s).length;
}

function byteSize(v: unknown): number {
  return new TextEncoder().encode(JSON.stringify(v) ?? "").byteLength;
}

function itemSize(v: unknown, path: string): void {
  if (byteSize(v) > SYNC_LIMITS.MAX_ITEM_BYTES) throw new Invalid(`${path} is larger than ${SYNC_LIMITS.MAX_ITEM_BYTES} bytes`);
}

const GRADES: readonly Grade[] = ["pass", "help", "notyet"];
const STATES: readonly MishnahState[] = ["new", "learning", "known", "solid"];

// ───────────── auth ─────────────

/** Trimmed, NFC, lowercased, ≤ 254 chars, simple shape check. */
export function normalizeEmail(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const e = v.trim().normalize("NFC").toLowerCase();
  if (e.length === 0 || e.length > 254 || !EMAIL_RE.test(e)) return null;
  return e;
}

function email(v: unknown, path: string): string {
  const e = normalizeEmail(v);
  if (e === null) throw new Invalid(`${path} is not a valid email address`);
  return e;
}

export function validateAuthRequest(body: unknown): Result<AuthRequestBody> {
  return run(() => {
    const o = obj(body, "body");
    const turnstileToken = str(o.turnstileToken, "turnstileToken");
    if (turnstileToken.length === 0 || turnstileToken.length > 2048) throw new Invalid("turnstileToken is invalid");
    return { email: email(o.email, "email"), turnstileToken };
  });
}

export function validateVerifyLink(body: unknown): Result<VerifyLinkBody> {
  return run(() => {
    const token = str(obj(body, "body").token, "token");
    if (!/^[A-Za-z0-9_-]{20,128}$/.test(token)) throw new Invalid("token is invalid");
    return { token };
  });
}

export function validateVerifyCode(body: unknown): Result<VerifyCodeBody> {
  return run(() => {
    const o = obj(body, "body");
    const code = str(o.code, "code").replace(/\s+/g, "");
    if (!/^\d{6}$/.test(code)) throw new Invalid("code must be 6 digits");
    return { email: email(o.email, "email"), code };
  });
}

export function validateDeleteAccount(body: unknown): Result<DeleteAccountBody> {
  return run(() => ({ email: email(obj(body, "body").email, "email") }));
}

// ───────────── sync ─────────────

function settings(v: unknown, path: string): ChildSettings {
  const o = obj(v, path);
  const out: ChildSettings = {
    fontScale: num(o.fontScale, `${path}.fontScale`, 0.5, 3),
    tts: bool(o.tts, `${path}.tts`),
    dailyMinutes: int(o.dailyMinutes, `${path}.dailyMinutes`, 1, 180),
  };
  if (o.meaningView !== undefined) out.meaningView = oneOf(o.meaningView, `${path}.meaningView`, ["simple", "steinsaltz"]);
  return out;
}

export function childMeta(v: unknown, path: string): ChildMeta {
  itemSize(v, path);
  const o = obj(v, path);
  const name = str(o.name, `${path}.name`).trim();
  if (chars(name) < 1 || chars(name) > 40) throw new Invalid(`${path}.name must be 1..40 characters`);
  const color = str(o.color, `${path}.color`);
  if (!/^#[0-9a-fA-F]{6}$/.test(color)) throw new Invalid(`${path}.color must be #rrggbb`);
  const emoji = str(o.emoji, `${path}.emoji`);
  if (chars(emoji) < 1 || chars(emoji) > 16) throw new Invalid(`${path}.emoji must be 1..16 characters`);
  return { name, color, emoji, settings: settings(o.settings, `${path}.settings`), sort: int(o.sort, `${path}.sort`, 0, 999) };
}

function childRow(v: unknown, path: string): ChildRow {
  const o = obj(v, path);
  return {
    id: id(o.id, `${path}.id`),
    updatedAt: ms(o.updatedAt, `${path}.updatedAt`),
    deleted: bool(o.deleted, `${path}.deleted`),
    meta: childMeta(o.meta, `${path}.meta`),
  };
}

function review(v: unknown, path: string): ReviewItemData {
  const o = obj(v, path);
  return {
    box: int(o.box, `${path}.box`, 0, 20),
    due: isoDate(o.due, `${path}.due`),
    passes: int(o.passes, `${path}.passes`, 0, 1_000_000),
  };
}

function mishnahData(v: unknown, path: string): MishnahProgressData {
  const o = obj(v, path);
  const failsIn = obj(o.fails, `${path}.fails`);
  const keys = Object.keys(failsIn);
  if (keys.length > 200) throw new Invalid(`${path}.fails has too many entries`);
  const fails: Record<string, number> = {};
  for (const k of keys) {
    if (k.length > 64) throw new Invalid(`${path}.fails key too long`);
    fails[k] = int(failsIn[k], `${path}.fails.${k}`, 0, 1_000_000);
  }
  const out: MishnahProgressData = {
    stepIndex: int(o.stepIndex, `${path}.stepIndex`, 0, 10_000),
    state: oneOf(o.state, `${path}.state`, STATES),
    fails,
  };
  if (o.review !== undefined) out.review = review(o.review, `${path}.review`);
  return out;
}

function perekData(v: unknown, path: string): PerekProgressData {
  const o = obj(v, path);
  const out: PerekProgressData = {
    chainedThrough: int(o.chainedThrough, `${path}.chainedThrough`, 0, 999),
    complete: bool(o.complete, `${path}.complete`),
  };
  if (o.review !== undefined) out.review = review(o.review, `${path}.review`);
  return out;
}

function recordRow(v: unknown, path: string): RecordRow {
  const o = obj(v, path);
  itemSize(o.data, `${path}.data`);
  const childId = id(o.childId, `${path}.childId`);
  const updatedAt = ms(o.updatedAt, `${path}.updatedAt`);
  const key = str(o.key, `${path}.key`);
  switch (o.kind) {
    case "m":
      if (!M_KEY_RE.test(key)) throw new Invalid(`${path}.key must be "perek:mishnah"`);
      return { kind: "m", childId, updatedAt, key, data: mishnahData(o.data, `${path}.data`) };
    case "p":
      if (!P_KEY_RE.test(key)) throw new Invalid(`${path}.key must be "perek"`);
      return { kind: "p", childId, updatedAt, key, data: perekData(o.data, `${path}.data`) };
    case "d":
      if (!DATE_RE.test(key)) throw new Invalid(`${path}.key must be yyyy-mm-dd`);
      if (Object.keys(obj(o.data, `${path}.data`)).length !== 0) throw new Invalid(`${path}.data must be {}`);
      return { kind: "d", childId, updatedAt, key, data: {} };
    default:
      throw new Invalid(`${path}.kind must be m, p or d`);
  }
}

function eventBody(o: Obj, path: string): LearningEventBody {
  switch (o.type) {
    case "recite":
      return {
        type: "recite",
        task: oneOf(o.task, `${path}.task`, ["learn", "chain", "detour", "review-m", "perek-chain", "review-p"]),
        perek: int(o.perek, `${path}.perek`, 0, 999),
        mishnah: intOrNull(o.mishnah, `${path}.mishnah`, 0, 999),
        step: intOrNull(o.step, `${path}.step`, 0, 999),
        grade: oneOf(o.grade, `${path}.grade`, GRADES),
        peeks: int(o.peeks, `${path}.peeks`, 0, 10_000),
        ms: int(o.ms, `${path}.ms`, 0, 10_800_000),
      };
    case "check": {
      const slipped = arr(o.slipped, `${path}.slipped`);
      if (slipped.length > 200) throw new Invalid(`${path}.slipped has too many entries`);
      return {
        type: "check",
        scope: oneOf(o.scope, `${path}.scope`, ["mishnah", "chain", "review-p"]),
        perek: int(o.perek, `${path}.perek`, 0, 999),
        mishnah: intOrNull(o.mishnah, `${path}.mishnah`, 0, 999),
        through: intOrNull(o.through, `${path}.through`, 0, 999),
        grade: oneOf(o.grade, `${path}.grade`, GRADES),
        slipped: slipped.map((s, i) => int(s, `${path}.slipped[${i}]`, 0, 10_000)),
        slipWords: int(o.slipWords, `${path}.slipWords`, 0, 10_000),
      };
    }
    case "session":
      return {
        type: "session",
        startedAt: ms(o.startedAt, `${path}.startedAt`),
        ms: int(o.ms, `${path}.ms`, 0, 10_800_000),
        steps: int(o.steps, `${path}.steps`, 0, 10_000),
      };
    case "reset":
      return { type: "reset", perek: int(o.perek, `${path}.perek`, 0, 999), mishnah: int(o.mishnah, `${path}.mishnah`, 0, 999) };
    default:
      throw new Invalid(`${path}.type must be recite, check, session or reset`);
  }
}

function learningEvent(v: unknown, path: string): LearningEvent {
  itemSize(v, path);
  const o = obj(v, path);
  return {
    id: id(o.id, `${path}.id`),
    childId: id(o.childId, `${path}.childId`),
    at: ms(o.at, `${path}.at`),
    day: isoDate(o.day, `${path}.day`),
    ...eventBody(o, path),
  };
}

export function validateSync(body: unknown): Result<SyncRequest> {
  return run(() => {
    const o = obj(body, "body");
    const cursor = int(o.cursor, "cursor", 0, Number.MAX_SAFE_INTEGER);
    const children = arr(o.children, "children");
    const records = arr(o.records, "records");
    const events = arr(o.events, "events");
    if (children.length + records.length > SYNC_LIMITS.MAX_ROWS) {
      throw new Invalid(`At most ${SYNC_LIMITS.MAX_ROWS} children + records per sync`, true);
    }
    if (events.length > SYNC_LIMITS.MAX_EVENTS) throw new Invalid(`At most ${SYNC_LIMITS.MAX_EVENTS} events per sync`, true);
    return {
      cursor,
      children: children.map((c, i) => childRow(c, `children[${i}]`)),
      records: records.map((r, i) => recordRow(r, `records[${i}]`)),
      events: events.map((e, i) => learningEvent(e, `events[${i}]`)),
    };
  });
}

/** Query-string integer: undefined → fallback; otherwise must be an integer in range. */
export function queryInt(v: string | undefined, fallback: number, min: number, max: number): number | null {
  if (v === undefined || v === "") return fallback;
  if (!/^\d{1,16}$/.test(v)) return null;
  const n = Number(v);
  return n >= min && n <= max ? n : null;
}

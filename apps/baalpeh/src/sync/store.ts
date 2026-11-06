import type { ChildRow, LearningEvent, Ms, PerekVerificationRow, RecordRow, SyncResponse, User } from "../../shared/api";
import type { Profile } from "../types";
import { blankProfileFromRow, diffProfiles, settingsOf } from "./mapping";

export interface Pending {
  children: Record<string, ChildRow>; // by child id
  records: Record<string, RecordRow>; // by `${childId}|${kind}|${key}`
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
  /**
   * SERVER-OWNED perek verifications (docs/PARENT_VERIFICATION.md §7.3): childId → "masechta|perek" → entry.
   * Never pending, never diffed, never exported, never part of Profile; applied from SyncResponse.verifications only.
   */
  verified: Record<string, Record<string, VerifiedEntry>>;
  /** 1 once this device has done the catch-up sync (cursor 0) that understands `verifications`. */
  verifSchema?: 1;
  /** Server clock minus device clock, from the last SyncResponse or test request. */
  clockOffset?: number;
  /** This device's last successful test request per child (for the waiting screen and the parent area). */
  lastTest?: Record<string, LastTest>;
}

export interface VerifiedEntry {
  verified: boolean;
  verifiedAt: Ms | null;
  updatedAt: Ms;
}

export interface LastTest {
  masechta: string;
  perek: number;
  sentAt: Ms;
  nextAllowedAt: Ms;
}

export const verifKey = (masechta: string, perek: number): string => `${masechta}|${perek}`;

/** The perakim of one masechta a parent has verified for this child. */
export function verifiedSet(s: Pick<AccountStore, "verified">, childId: string, masechta: string): Set<number> {
  const out = new Set<number>();
  for (const [k, e] of Object.entries(s.verified[childId] ?? {})) {
    const i = k.lastIndexOf("|");
    const perek = Number(k.slice(i + 1));
    if (e.verified && k.slice(0, i) === masechta && Number.isInteger(perek)) out.add(perek);
  }
  return out;
}

/** Applies server verification rows (the server wins: no pending check). Rows of children not on this device are ignored. */
export function applyVerifications(s: AccountStore, rows: PerekVerificationRow[]): AccountStore {
  if (rows.length === 0) return s;
  const ids = new Set(s.profiles.map((p) => p.id));
  const verified = { ...s.verified };
  for (const r of rows) {
    if (!ids.has(r.childId)) continue;
    verified[r.childId] = { ...verified[r.childId], [verifKey(r.masechta, r.perek)]: { verified: r.verified, verifiedAt: r.verifiedAt, updatedAt: r.updatedAt } };
  }
  return { ...s, verified };
}

/** Exactly what one sync request carried. */
export interface SentBatch {
  children: ChildRow[];
  records: RecordRow[];
  events: LearningEvent[];
}

export const CURRENT_KEY = "baalpeh:v2:current"; // JSON User of the signed-in account (offline boot)
export const storeKey = (userId: string) => `baalpeh:v2:acct:${userId}`;

export interface KV {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
  removeItem(k: string): void;
}

export const MAX_PENDING_EVENTS = 5000;

export const recordKey = (r: Pick<RecordRow, "childId" | "kind" | "key">): string => `${r.childId}|${r.kind}|${r.key}`;

export const emptyStore = (user: User): AccountStore => ({
  version: 2, user, cursor: 0, profiles: [], pending: { children: {}, records: {}, events: [] }, lastSyncAt: null, importDecision: "none",
  verified: {},
});

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);

/** A stored `verified` map, keeping only well-formed entries (a pre-feature store has none). */
function cleanVerified(x: unknown): AccountStore["verified"] {
  const out: AccountStore["verified"] = {};
  if (!isObj(x)) return out;
  for (const [child, m] of Object.entries(x)) {
    if (!isObj(m)) continue;
    const entries: Record<string, VerifiedEntry> = {};
    for (const [k, e] of Object.entries(m)) {
      if (isObj(e) && typeof e["verified"] === "boolean" && typeof e["updatedAt"] === "number") {
        entries[k] = { verified: e["verified"], verifiedAt: typeof e["verifiedAt"] === "number" ? e["verifiedAt"] : null, updatedAt: e["updatedAt"] };
      }
    }
    out[child] = entries;
  }
  return out;
}

function cleanLastTest(x: unknown): Record<string, LastTest> | undefined {
  if (!isObj(x)) return undefined;
  const out: Record<string, LastTest> = {};
  for (const [child, t] of Object.entries(x)) {
    if (isObj(t) && typeof t["masechta"] === "string" && typeof t["perek"] === "number" && typeof t["sentAt"] === "number" && typeof t["nextAllowedAt"] === "number") {
      out[child] = { masechta: t["masechta"], perek: t["perek"], sentAt: t["sentAt"], nextAllowedAt: t["nextAllowedAt"] };
    }
  }
  return out;
}

function isUser(x: unknown): x is User {
  const u = x as User;
  return typeof x === "object" && x !== null && typeof u.id === "string" && typeof u.email === "string" && typeof u.createdAt === "number";
}

function isStore(x: unknown, userId: string): x is AccountStore {
  const s = x as AccountStore;
  return typeof x === "object" && x !== null && s.version === 2 && isUser(s.user) && s.user.id === userId &&
    typeof s.cursor === "number" && Array.isArray(s.profiles) && typeof s.pending === "object" && s.pending !== null &&
    typeof s.pending.children === "object" && typeof s.pending.records === "object" && Array.isArray(s.pending.events);
}

/** Creates an empty store if it is missing or corrupt. */
export function loadStore(kv: KV, user: User): AccountStore {
  try {
    const raw = kv.getItem(storeKey(user.id));
    if (raw) {
      const parsed: unknown = JSON.parse(raw);
      if (isStore(parsed, user.id)) {
        const importDecision = parsed.importDecision === "imported" || parsed.importDecision === "dismissed" ? parsed.importDecision : "none";
        const { verifSchema, clockOffset, lastTest, ...rest } = parsed;
        const lt = cleanLastTest(lastTest);
        return {
          ...rest, user, importDecision, lastSyncAt: parsed.lastSyncAt ?? null, verified: cleanVerified(parsed.verified),
          ...(verifSchema === 1 ? { verifSchema } : {}),
          ...(typeof clockOffset === "number" && Number.isFinite(clockOffset) ? { clockOffset } : {}),
          ...(lt ? { lastTest: lt } : {}),
        };
      }
    }
  } catch {
    /* corrupt or unavailable */
  }
  return emptyStore(user);
}

export function saveStore(kv: KV, s: AccountStore): void {
  try {
    kv.setItem(storeKey(s.user.id), JSON.stringify(s));
  } catch {
    /* storage unavailable (private mode) or full; the app still works for this session */
  }
}

export function loadCurrentUser(kv: KV): User | null {
  try {
    const raw = kv.getItem(CURRENT_KEY);
    if (!raw) return null;
    const u: unknown = JSON.parse(raw);
    return isUser(u) ? u : null;
  } catch {
    return null;
  }
}

export function setCurrentUser(kv: KV, u: User | null): void {
  try {
    if (u) kv.setItem(CURRENT_KEY, JSON.stringify(u));
    else kv.removeItem(CURRENT_KEY);
  } catch {
    /* ignore */
  }
}

export const pendingCount = (s: AccountStore): number =>
  Object.keys(s.pending.children).length + Object.keys(s.pending.records).length + s.pending.events.length;

/**
 * A strictly increasing clock per key, so a newer local edit never shares an `updatedAt` with the value
 * already in flight (which would make applyServerResponse drop it as "sent").
 */
const bump = (prev: { updatedAt: Ms } | undefined, now: Ms): Ms => (prev && prev.updatedAt >= now ? prev.updatedAt + 1 : now);

/** Adds rows to `pending`, keeping only the latest value per key. */
export function addPending(s: AccountStore, rows: { children: ChildRow[]; records: RecordRow[] }): AccountStore {
  if (rows.children.length === 0 && rows.records.length === 0) return s;
  const children = { ...s.pending.children };
  const records = { ...s.pending.records };
  for (const c of rows.children) children[c.id] = { ...c, updatedAt: bump(children[c.id], c.updatedAt) };
  for (const r of rows.records) {
    const k = recordKey(r);
    records[k] = { ...r, updatedAt: bump(records[k], r.updatedAt) };
  }
  return { ...s, pending: { ...s.pending, children, records } };
}

/** §6.4 local edit: diff, coalesce into pending, replace profiles. */
export function applyLocalEdit(s: AccountStore, next: Profile[], now: Ms): AccountStore {
  const diff = diffProfiles(s.profiles, next, now);
  return { ...addPending(s, diff), profiles: next };
}

export function enqueueEvent(s: AccountStore, e: LearningEvent): AccountStore {
  const events = [...s.pending.events, e];
  return { ...s, pending: { ...s.pending, events: events.length > MAX_PENDING_EVENTS ? events.slice(-MAX_PENDING_EVENTS) : events } };
}

/** Removes the sent rows from pending, unless they were edited again while the request was in flight. */
export function clearSent(s: AccountStore, sent: SentBatch): AccountStore {
  const children = { ...s.pending.children };
  const records = { ...s.pending.records };
  for (const c of sent.children) if (children[c.id]?.updatedAt === c.updatedAt) delete children[c.id];
  for (const r of sent.records) {
    const k = recordKey(r);
    if (records[k]?.updatedAt === r.updatedAt) delete records[k];
  }
  const sentIds = new Set(sent.events.map((e) => e.id));
  const events = s.pending.events.filter((e) => !sentIds.has(e.id));
  return { ...s, pending: { children, records, events } };
}

/** §6.4 step 3. Server rows never create pending rows and never overwrite a key that is still pending. */
export function applyServerResponse(s0: AccountStore, sent: SentBatch, r: SyncResponse, now: Ms): AccountStore {
  const s = clearSent(s0, sent);
  const { pending } = s;
  let profiles = [...s.profiles];
  const sortOf = new Map<string, number>(profiles.map((p, i) => [p.id, i]));

  for (const row of r.children) {
    if (pending.children[row.id]) continue;
    const i = profiles.findIndex((p) => p.id === row.id);
    if (row.deleted) {
      if (i >= 0) profiles.splice(i, 1);
      sortOf.delete(row.id);
      continue;
    }
    const { name, color, emoji, settings } = row.meta;
    if (i >= 0) {
      const cur = profiles[i];
      if (cur) profiles[i] = { ...cur, name, color, emoji, settings: settingsOf(settings) };
    } else {
      profiles.push(blankProfileFromRow(row));
    }
    sortOf.set(row.id, row.meta.sort);
  }
  profiles = profiles
    .map((p, i) => ({ p, i }))
    .sort((a, b) => (sortOf.get(a.p.id) ?? a.i) - (sortOf.get(b.p.id) ?? b.i) || a.i - b.i)
    .map((x) => x.p);

  const byId = new Map(profiles.map((p, i) => [p.id, i] as const));
  for (const rec of r.records) {
    if (pending.records[recordKey(rec)]) continue;
    const i = byId.get(rec.childId);
    const cur = i === undefined ? undefined : profiles[i];
    if (i === undefined || !cur) continue;
    let next: Profile;
    if (rec.kind === "m") next = { ...cur, mishnayos: { ...cur.mishnayos, [rec.key]: rec.data } };
    else if (rec.kind === "p") next = { ...cur, perakim: { ...cur.perakim, [rec.key]: rec.data } };
    else next = cur.days.includes(rec.key) ? cur : { ...cur, days: [...new Set([...cur.days, rec.key])].sort().slice(-60) };
    profiles[i] = next;
  }

  // Verifications: drop entries of children that are gone (tombstoned), then apply the pulled rows.
  const live = new Set(profiles.map((p) => p.id));
  const verified = Object.fromEntries(Object.entries(s.verified ?? {}).filter(([id]) => live.has(id)));
  const has = Array.isArray(r.verifications);
  const next = applyVerifications({ ...s, profiles, verified }, has ? r.verifications ?? [] : []);
  return {
    ...next, cursor: r.cursor, lastSyncAt: now,
    ...(typeof r.serverTime === "number" ? { clockOffset: r.serverTime - now } : {}),
    ...(has ? { verifSchema: 1 as const } : {}),
  };
}

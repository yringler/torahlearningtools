import type {
  ChildMeta, ChildRow, ChildSettings, Ms, MishnahProgressData, PerekProgressData, RecordRow, ReviewItemData,
} from "../../shared/api";
import { isMasechtaId, parseProgressKey } from "../../shared/progressKey";
import { chainKey, parseChainKey } from "../perekSteps";
import type { Profile } from "../types";

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const COLOR = /^#[0-9a-fA-F]{6}$/;
/** Server limit on PerekProgressData.chains (worker/lib/validate.ts). */
const MAX_CHAINS = 64;

const int = (v: unknown, lo: number, hi: number, dflt: number): number => {
  const n = typeof v === "number" && Number.isFinite(v) ? Math.round(v) : dflt;
  return Math.min(hi, Math.max(lo, n));
};

/** Settings in the ranges the server accepts (§7.3). Older or hand-edited data can be outside them. */
function cleanSettings(s: Profile["settings"]): ChildSettings {
  const fontScale = typeof s.fontScale === "number" && Number.isFinite(s.fontScale) ? Math.min(3, Math.max(0.5, s.fontScale)) : 1;
  const out: ChildSettings = { fontScale };
  if (typeof s.breakMinutes === "number" && Number.isFinite(s.breakMinutes)) out.breakMinutes = int(s.breakMinutes, 1, 180, 15);
  if (s.meaningView === "simple" || s.meaningView === "steinsaltz") out.meaningView = s.meaningView;
  if (isMasechtaId(s.lastMasechta)) out.lastMasechta = s.lastMasechta;
  return out;
}

/** Settings from the server, without fields this client doesn't use (older rows can still hold `dailyMinutes`). */
export function settingsOf(s: ChildSettings): Profile["settings"] {
  const out: Profile["settings"] = { fontScale: s.fontScale };
  if (s.breakMinutes !== undefined) out.breakMinutes = s.breakMinutes;
  if (s.meaningView !== undefined) out.meaningView = s.meaningView;
  if (isMasechtaId(s.lastMasechta)) out.lastMasechta = s.lastMasechta;
  return out;
}

/** The child's metadata as the server stores it. `sort` is the position in the picker. */
export function metaOf(p: Profile, sort: number): ChildMeta {
  const name = (typeof p.name === "string" ? p.name : "").trim().slice(0, 40) || "Child";
  const emoji = typeof p.emoji === "string" && p.emoji.length >= 1 && p.emoji.length <= 16 ? p.emoji : "🐮";
  const color = typeof p.color === "string" && COLOR.test(p.color) ? p.color : "#2f7d6d";
  return { name, color, emoji, settings: cleanSettings(p.settings), sort: int(sort, 0, 999, 0) };
}

function cleanReview(r: unknown): ReviewItemData | undefined {
  if (typeof r !== "object" || r === null) return undefined;
  const x = r as Partial<ReviewItemData>;
  if (typeof x.due !== "string" || !ISO.test(x.due)) return undefined;
  return { box: int(x.box, 0, 20, 0), due: x.due, passes: int(x.passes, 0, 1_000_000, 0) };
}

export function cleanMishnah(m: MishnahProgressData): MishnahProgressData {
  const fails: Record<string, number> = {};
  for (const [k, v] of Object.entries(m.fails ?? {}).slice(0, 200)) fails[k] = int(v, 0, 1_000_000, 0);
  const state = m.state === "learning" || m.state === "known" || m.state === "solid" ? m.state : "new";
  const out: MishnahProgressData = { stepIndex: int(m.stepIndex, 0, 10_000, 0), state, fails };
  const review = cleanReview(m.review);
  if (review) out.review = review;
  return out;
}

/** Passed perek chain ranges as the server accepts them: valid "from-to" keys, deduped, sorted, at most 64. */
function cleanChains(chains: unknown[]): string[] {
  const seen = new Map<string, [number, number]>();
  for (const k of chains) {
    const r = parseChainKey(k);
    if (r) seen.set(chainKey(r[0], r[1]), r);
  }
  return [...seen.values()].sort((x, y) => x[0] - y[0] || x[1] - y[1]).slice(0, MAX_CHAINS).map(([a, b]) => chainKey(a, b));
}

export function cleanPerek(p: PerekProgressData): PerekProgressData {
  const out: PerekProgressData = { chainedThrough: int(p.chainedThrough, 0, 999, 0), complete: p.complete === true };
  const review = cleanReview(p.review);
  if (review) out.review = review;
  // Old-shape rows (no array) keep no `chains` key, so they round-trip unchanged.
  const chains: unknown = (p as { chains?: unknown }).chains;
  if (Array.isArray(chains)) out.chains = cleanChains(chains);
  return out;
}

const childRow = (p: Profile, sort: number, now: Ms, deleted = false): ChildRow => ({
  id: p.id, updatedAt: now, deleted, meta: metaOf(p, sort),
});

const mRow = (childId: string, key: string, data: MishnahProgressData, now: Ms): RecordRow =>
  ({ kind: "m", childId, key, data: cleanMishnah(data), updatedAt: now });
const pRow = (childId: string, key: string, data: PerekProgressData, now: Ms): RecordRow =>
  ({ kind: "p", childId, key, data: cleanPerek(data), updatedAt: now });
const dRow = (childId: string, day: string, now: Ms): RecordRow => ({ kind: "d", childId, key: day, data: {}, updatedAt: now });

/**
 * Only canonical keys are pushed (shared/progressKey.ts): the server rejects the whole batch for one bad key, so a
 * non-canonical "berakhot/1:2" or a garbage key in local data must never reach it.
 */
function recordRows(p: Profile, prev: Profile | undefined, now: Ms): RecordRow[] {
  const out: RecordRow[] = [];
  for (const [k, v] of Object.entries(p.mishnayos)) {
    if (parseProgressKey("m", k) === null) continue;
    const before = prev?.mishnayos[k];
    if (before === undefined || JSON.stringify(before) !== JSON.stringify(v)) out.push(mRow(p.id, k, v, now));
  }
  for (const [k, v] of Object.entries(p.perakim)) {
    if (parseProgressKey("p", k) === null) continue;
    const before = prev?.perakim[k];
    if (before === undefined || JSON.stringify(before) !== JSON.stringify(v)) out.push(pRow(p.id, k, v, now));
  }
  const seen = new Set(prev?.days ?? []);
  for (const d of p.days) if (ISO.test(d) && !seen.has(d)) out.push(dRow(p.id, d, now));
  return out;
}

/** Every row of one child (used when importing). */
export function profileToRows(p: Profile, sort: number, now: Ms): { child: ChildRow; records: RecordRow[] } {
  return { child: childRow(p, sort, now), records: recordRows(p, undefined, now) };
}

/**
 * The rows that turn `prev` into `next` (§6.4). Removed map keys and days produce nothing.
 * `sort` only orders the list, so gaps and ties are harmless: when the children kept from `prev` are still in the
 * same order (a child was only added or removed), a kept child whose index merely shifted sends no row. Otherwise
 * removing a child would rewrite every later sibling with this device's possibly stale copy of its meta (a parent's
 * removal would overwrite a learner's newer text size and log an edit nobody made).
 */
export function diffProfiles(prev: Profile[], next: Profile[], now: Ms): { children: ChildRow[]; records: RecordRow[] } {
  const children: ChildRow[] = [];
  const records: RecordRow[] = [];
  const prevIndex = new Map(prev.map((p, i) => [p.id, i] as const));
  const nextIds = new Set(next.map((p) => p.id));
  const keptPrev = prev.filter((p) => nextIds.has(p.id)).map((p) => p.id);
  const keptNext = next.filter((p) => prevIndex.has(p.id)).map((p) => p.id);
  const orderKept = keptPrev.every((id, k) => keptNext[k] === id);
  next.forEach((p, i) => {
    const j = prevIndex.get(p.id);
    const before = j === undefined ? undefined : prev[j];
    const changed = (bs: number, ns: number) => before !== undefined && JSON.stringify(metaOf(before, bs)) !== JSON.stringify(metaOf(p, ns));
    if (!before || (orderKept ? changed(0, 0) : changed(j ?? 0, i))) children.push(childRow(p, i, now));
    records.push(...recordRows(p, before, now));
  });
  prev.forEach((p, i) => {
    if (!nextIds.has(p.id)) children.push(childRow(p, i, now, true));
  });
  return { children, records };
}

export function blankProfileFromRow(row: ChildRow): Profile {
  const { name, color, emoji, settings } = row.meta;
  return { id: row.id, name, color, emoji, settings: settingsOf(settings), mishnayos: {}, perakim: {}, days: [] };
}

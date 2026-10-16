// Per-device progress (localStorage): which weeks were learned and best test scores.
// Weeks and tests are saved by their stable keys ("3א", "list3"), so adding lists never
// moves anyone's checkmarks.
import type { CourseId } from "./courses";

export interface Score {
  score: number;
  total: number;
}

interface CourseProgress {
  learned: string[];
  best: Record<string, Score>;
}

const KEY = "cheder-flashcards:progress";

type Progress = Partial<Record<CourseId, CourseProgress>>;

const LETTERS = ["א", "ב", "ג"];

/**
 * Old saves stored week *indices* in a course that began with two single-week lists:
 * 0 = old list 1 (now 1א), 1 = old list 2 (now 1ב), then 3א, 3ב, 3ג, 4א, …
 */
export function legacyWeekKey(index: number): string | undefined {
  if (!Number.isInteger(index) || index < 0) return undefined;
  if (index < 2) return `1${LETTERS[index]}`;
  const i = index - 2;
  return `${3 + Math.floor(i / 3)}${LETTERS[i % 3]}`;
}

export function migrateLearned(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const x of raw) {
    const k = typeof x === "string" ? x : typeof x === "number" ? legacyWeekKey(x) : undefined;
    if (k && !out.includes(k)) out.push(k);
  }
  return out;
}

function load(): Progress {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return {};
    const data: unknown = JSON.parse(raw);
    return typeof data === "object" && data !== null ? (data as Progress) : {};
  } catch {
    return {};
  }
}

function save(p: Progress): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    // storage unavailable (private mode etc.) — just don't remember
  }
}

function course(p: Progress, id: CourseId): CourseProgress {
  const c = p[id];
  const best: Record<string, Score> = {};
  if (typeof c?.best === "object" && c.best !== null) {
    // Old saves keyed scores by test number ("0", "1", …) for two-week tests that no longer exist.
    for (const [k, v] of Object.entries(c.best)) if (k.startsWith("list")) best[k] = v;
  }
  return { learned: migrateLearned(c?.learned), best };
}

export function isLearned(id: CourseId, week: string): boolean {
  return course(load(), id).learned.includes(week);
}

export function markLearned(id: CourseId, week: string): void {
  const p = load();
  const c = course(p, id);
  if (!c.learned.includes(week)) c.learned.push(week);
  p[id] = c;
  save(p);
}

export function bestScore(id: CourseId, test: string): Score | undefined {
  return course(load(), id).best[test];
}

export function recordScore(id: CourseId, test: string, s: Score): void {
  const p = load();
  const c = course(p, id);
  const prev = c.best[test];
  if (!prev || s.score / s.total > prev.score / prev.total) c.best[test] = s;
  p[id] = c;
  save(p);
}

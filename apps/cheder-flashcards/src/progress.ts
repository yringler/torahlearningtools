// Per-device progress (localStorage): which weeks were learned and best test scores.
import type { CourseId } from "./courses";

export interface Score {
  score: number;
  total: number;
}

interface CourseProgress {
  learned: number[];
  best: Record<string, Score>;
}

const KEY = "cheder-flashcards:progress";

type Progress = Partial<Record<CourseId, CourseProgress>>;

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
  return {
    learned: Array.isArray(c?.learned) ? c.learned : [],
    best: typeof c?.best === "object" && c.best !== null ? c.best : {},
  };
}

export function isLearned(id: CourseId, week: number): boolean {
  return course(load(), id).learned.includes(week);
}

export function markLearned(id: CourseId, week: number): void {
  const p = load();
  const c = course(p, id);
  if (!c.learned.includes(week)) c.learned.push(week);
  p[id] = c;
  save(p);
}

export function bestScore(id: CourseId, test: number): Score | undefined {
  return course(load(), id).best[String(test)];
}

export function recordScore(id: CourseId, test: number, s: Score): void {
  const p = load();
  const c = course(p, id);
  const prev = c.best[String(test)];
  if (!prev || s.score / s.total > prev.score / prev.total) c.best[String(test)] = s;
  p[id] = c;
  save(p);
}

const COURSE_KEY = "cheder-flashcards:course";

export function lastCourse(): string | null {
  try {
    return localStorage.getItem(COURSE_KEY);
  } catch {
    return null;
  }
}

export function rememberCourse(id: CourseId): void {
  try {
    localStorage.setItem(COURSE_KEY, id);
  } catch {
    // ignore
  }
}

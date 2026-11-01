import type { Grade, ReviewItem } from "./types";

/** Leitner intervals in days. */
export const INTERVALS = [1, 3, 7, 14, 30, 60] as const;

export const today = (d: Date = new Date()): string => {
  const z = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return z.toISOString().slice(0, 10);
};

export function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + days);
  return today(d);
}

export function newReview(now: string = today()): ReviewItem {
  return { box: 0, due: addDays(now, INTERVALS[0]), passes: 0 };
}

/** pass → up one box; help → same box; notyet → back to box 0. */
export function gradeReview(r: ReviewItem, g: Grade, now: string = today()): ReviewItem {
  const box = g === "pass" ? Math.min(r.box + 1, INTERVALS.length - 1) : g === "help" ? r.box : 0;
  const interval = INTERVALS[box] ?? 1;
  return { box, due: addDays(now, interval), passes: g === "pass" ? r.passes + 1 : r.passes };
}

export const isDue = (r: ReviewItem | undefined, now: string = today()): boolean =>
  r !== undefined && r.due <= now;

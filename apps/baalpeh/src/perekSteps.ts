import { assertActive, mishnayosOf, perekSize, type MasechtaShape } from "./data";
import type { Step } from "./types";

/**
 * The perek build-up (docs/PEREK_BUILDUP.md §1): mishnah 1 → mishnah 2 → 1+2 → mishnah 3 → 1–3 … → the whole perek,
 * the same cumulative chaining a mishnah uses for its pieces. Long perakim are split into parts of at most
 * MAX_PEREK_PART mishnayos, then the parts are joined.
 *
 * Progress is stored as passed mishnah *ranges* (PerekProgress.chains), never as an index into this list, so the
 * split can change later without misplacing saved progress. Everything but perekPhrases needs only the masechta's
 * shape (mishnayos per perek), so it works before the text is loaded. Nothing is memoized: the lists are tiny.
 */
export const MAX_PEREK_PART = 5;

/** One step of the perek build-up. Mishnah numbers are 1-based; chain ranges are inclusive. */
export type PerekStep =
  | { kind: "mishnah"; mishnah: number; label: string }
  | { kind: "chain"; from: number; to: number; newest: number; label: string };

/** Splits 1..n evenly by count into ceil(n / MAX_PEREK_PART) parts (1-based, inclusive). */
export function perekParts(n: number): Array<[number, number]> {
  if (!Number.isInteger(n) || n < 1) return [];
  const count = Math.ceil(n / MAX_PEREK_PART);
  const out: Array<[number, number]> = [];
  let prev = 0;
  for (let s = 1; s <= count; s++) {
    const bound = s === count ? n : Math.round((n * s) / count);
    out.push([prev + 1, bound]);
    prev = bound;
  }
  return out;
}

/** The step list for a perek of n mishnayos (the pure core of perekSteps). */
export function stepsForCount(n: number): PerekStep[] {
  const parts = perekParts(n);
  const multi = parts.length > 1;
  const steps: PerekStep[] = [];
  const chainLabel = (from: number, to: number, part: number): string =>
    from === 1 && to === n ? "The whole perek!" : `${multi ? `Part ${part} · ` : ""}Mishnayos ${from}–${to} together`;
  parts.forEach(([a, b], si) => {
    for (let m = a; m <= b; m++) {
      steps.push({ kind: "mishnah", mishnah: m, label: `Mishnah ${m}` });
      if (m > a) steps.push({ kind: "chain", from: a, to: m, newest: m, label: chainLabel(a, m, si + 1) });
    }
  });
  for (let si = 1; si < parts.length; si++) {
    const end = parts[si]?.[1] ?? n;
    steps.push({ kind: "chain", from: 1, to: end, newest: end, label: end === n ? "The whole perek!" : `Parts 1–${si + 1} together` });
  }
  return steps;
}

export function perekSteps(ms: MasechtaShape, perek: number): PerekStep[] {
  return stepsForCount(perekSize(ms, perek));
}

export const chainKey = (from: number, to: number): string => `${from}-${to}`;

const CHAIN_KEY = /^(\d{1,3})-(\d{1,3})$/;

/** [from, to] of a stored chain key, or null unless it is "from-to" with 1 <= from <= to. */
export function parseChainKey(k: unknown): [number, number] | null {
  if (typeof k !== "string") return null;
  const m = CHAIN_KEY.exec(k);
  if (!m) return null;
  const from = Number(m[1]);
  const to = Number(m[2]);
  return from >= 1 && from <= to ? [from, to] : null;
}

/** Selection key of a step on the perek screen: "M3" or "C1-3". */
export const stepSelKey = (s: PerekStep): string => (s.kind === "mishnah" ? `M${s.mishnah}` : `C${chainKey(s.from, s.to)}`);

/** Adapter for steps.ts pathGroupsFor(): perek steps as 0-based mishnah-step "pieces". */
export function perekPathSteps(steps: PerekStep[]): Step[] {
  return steps.map((s) =>
    s.kind === "mishnah"
      ? { kind: "learn", chunk: s.mishnah - 1, label: s.label }
      : { kind: "chain", from: s.from - 1, to: s.to - 1, newest: s.newest - 1, label: s.label },
  );
}

/** perekParts() of a perek, shifted to 0-based (the `segs` argument of pathGroupsFor). */
export function perekSegs(ms: MasechtaShape, perek: number): Array<[number, number]> {
  return perekParts(perekSize(ms, perek)).map(([a, b]) => [a - 1, b - 1]);
}

/** "Mishnah 2", "Mishnayos 1–2 together" or "The whole perek". */
export function perekPracticeLabel(ms: MasechtaShape, perek: number, from: number, to: number): string {
  const n = perekSize(ms, perek);
  if (from === to) return `Mishnah ${from}`;
  if (from === 1 && to === n && n >= 2) return "The whole perek";
  return `Mishnayos ${from}–${to} together`;
}

/**
 * The perek phrase by phrase, grouped by mishnah. The end-of-perek "look it over" view uses it, and so will the
 * parent's "ready to be tested" email (roadmap item 2).
 */
export function perekPhrases(masechta: string, perek: number): Array<{ mishnah: number; phrases: string[] }> {
  assertActive(masechta);
  return mishnayosOf(perek).map((m) => ({ mishnah: m.mishnah, phrases: m.chunks.map((c) => c.he) }));
}

/** The part [a, b] (1-based) that holds all of from..to, or null for a join across parts. */
export function partOf(n: number, from: number, to: number): [number, number] | null {
  return perekParts(n).find(([a, b]) => a <= from && to <= b) ?? null;
}

import { getMishnah, mishnayosOf, mKey, PERAKIM } from "./data";
import { chainKey, parseChainKey, perekSteps, type PerekStep } from "./perekSteps";
import { gradeReview, isDue, newReview, today } from "./srs";
import { buildSteps } from "./steps";
import { blankMishnah, blankPerek } from "./storage";
import type { Grade, MishnahProgress, PerekProgress, Profile } from "./types";

export type Task =
  /** Learn a mishnah (also the perek build-up's "Mishnah k" step). */
  | { type: "learn"; perek: number; mishnah: number }
  | { type: "review-m"; perek: number; mishnah: number }
  /** Extra practice of steps from..to of a known mishnah. Changes no progress (only marks the day). */
  | { type: "practice"; perek: number; mishnah: number; from: number; to: number; label: string }
  /** A perek build-up chain step: say mishnayos from..to (1-based, inclusive) together. */
  | { type: "perek-chain"; perek: number; from: number; to: number }
  /** End of the perek build-up: "I'm ready to be tested" (docs/PEREK_BUILDUP.md §7, §10). */
  | { type: "perek-finish"; perek: number }
  /** Practice mishnayos from..to of a perek, all known. Changes no progress (only marks the day). */
  | { type: "perek-practice"; perek: number; from: number; to: number; label: string }
  | { type: "review-p"; perek: number };

export const mp = (p: Profile, perek: number, mishnah: number): MishnahProgress =>
  p.mishnayos[mKey(perek, mishnah)] ?? blankMishnah();

export const pp = (p: Profile, perek: number): PerekProgress => p.perakim[String(perek)] ?? blankPerek();

const withM = (p: Profile, perek: number, mishnah: number, m: MishnahProgress): Profile => ({
  ...p,
  mishnayos: { ...p.mishnayos, [mKey(perek, mishnah)]: m },
});

const withP = (p: Profile, perek: number, x: PerekProgress): Profile => ({
  ...p,
  perakim: { ...p.perakim, [String(perek)]: x },
});

export function markDay(p: Profile, now: string = today()): Profile {
  if (p.days.includes(now)) return p;
  return { ...p, days: [...p.days, now].slice(-60) };
}

export const isKnown = (m: MishnahProgress): boolean => m.state === "known" || m.state === "solid";

/** A step was passed: move to the next step. Returns the new profile and whether the mishnah's steps are finished. */
export function completeStep(p: Profile, perek: number, mishnah: number): { profile: Profile; finished: boolean } {
  const total = buildSteps(getMishnah(perek, mishnah).chunks).length;
  const cur = mp(p, perek, mishnah);
  const stepIndex = Math.min(cur.stepIndex + 1, total);
  const state = isKnown(cur) ? cur.state : "learning";
  return { profile: withM(p, perek, mishnah, { ...cur, stepIndex, state }), finished: stepIndex >= total };
}

/**
 * The child jumped to a step (back, forward, or a tapped stone/part). Navigation is free: the parent
 * check at the end is the real test. `index === total` means the parent check. Not a "step passed".
 */
export function setStep(p: Profile, perek: number, mishnah: number, index: number): Profile {
  const total = buildSteps(getMishnah(perek, mishnah).chunks).length;
  const cur = mp(p, perek, mishnah);
  const stepIndex = Math.max(0, Math.min(Math.round(index), total));
  if (stepIndex === cur.stepIndex) return p;
  const state = cur.state === "new" ? "learning" : cur.state;
  return withM(p, perek, mishnah, { ...cur, stepIndex, state });
}

/** Parent verified the whole mishnah. `grade` notyet sends it back to the final step. */
export function parentCheckMishnah(p: Profile, perek: number, mishnah: number, grade: Grade): Profile {
  const cur = mp(p, perek, mishnah);
  if (grade === "notyet") {
    const total = buildSteps(getMishnah(perek, mishnah).chunks).length;
    return withM(p, perek, mishnah, { ...cur, state: "learning", stepIndex: Math.max(0, total - 1) });
  }
  return withM(p, perek, mishnah, {
    ...cur,
    state: isKnown(cur) ? cur.state : "known",
    review: cur.review ?? newReview(),
  });
}

export function reviewMishnah(p: Profile, perek: number, mishnah: number, grade: Grade): Profile {
  const cur = mp(p, perek, mishnah);
  const review = gradeReview(cur.review ?? newReview(), grade);
  const state = review.passes >= 2 ? "solid" : grade === "notyet" ? "known" : cur.state;
  return withM(p, perek, mishnah, { ...cur, review, state });
}

/** Perek review: failed mishnayos (by parent marks) go back to box 0 individually. */
export function reviewPerek(p: Profile, perek: number, grade: Grade, slipped: number[]): Profile {
  const cur = pp(p, perek);
  let next = withP(p, perek, { ...cur, review: gradeReview(cur.review ?? newReview(), grade) });
  for (const m of slipped) next = reviewMishnah(next, perek, m, "notyet");
  return next;
}

/** Highest k such that mishnayos 1..k are all known. */
export function knownPrefix(p: Profile, perek: number): number {
  let k = 0;
  for (const m of mishnayosOf(perek)) {
    if (isKnown(mp(p, perek, m.mishnah))) k = m.mishnah;
    else break;
  }
  return k;
}

/** Due reviews, in order: perek reviews, then mishnah reviews (mishnayos of completed perakim are covered by the perek). */
export function dueReviews(p: Profile, now: string = today()): Task[] {
  const out: Task[] = [];
  for (const perek of PERAKIM) {
    if (perekDone(p, perek)) {
      if (isDue(pp(p, perek).review, now)) out.push({ type: "review-p", perek });
      continue;
    }
    for (const m of mishnayosOf(perek)) {
      if (isDue(mp(p, perek, m.mishnah).review, now)) out.push({ type: "review-m", perek, mishnah: m.mishnah });
    }
  }
  return out;
}

// ───────────── perek build-up (docs/PEREK_BUILDUP.md §2–§3) ─────────────

/**
 * Passed chain ranges of a perek, parsed defensively (pulled rows and guest storage are not validated):
 * anything that is not a "from-to" string with from <= to is ignored. A legacy chainedThrough k counts as [1, k].
 */
function passedRanges(pr: PerekProgress): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  const chains: unknown = (pr as { chains?: unknown }).chains;
  if (Array.isArray(chains)) {
    for (const k of chains) {
      const r = parseChainKey(k);
      if (r) out.push(r);
    }
  }
  const through = pr.chainedThrough;
  if (typeof through === "number" && Number.isFinite(through) && through >= 1) out.push([1, Math.floor(through)]);
  return out;
}

/** Mishnayos from..to have been said together: a passed range contains them (or the perek is complete). */
export function chainSatisfied(p: Profile, perek: number, from: number, to: number): boolean {
  const pr = pp(p, perek);
  if (pr.complete === true) return true;
  return passedRanges(pr).some(([a, b]) => a <= from && to <= b);
}

export function stepSatisfied(p: Profile, perek: number, s: PerekStep): boolean {
  return s.kind === "mishnah" ? isKnown(mp(p, perek, s.mishnah)) : chainSatisfied(p, perek, s.from, s.to);
}

/** Index of the first unsatisfied build-up step; steps.length when every step is satisfied. */
export function perekFrontier(p: Profile, perek: number): number {
  const steps = perekSteps(perek);
  const i = steps.findIndex((s) => !stepSatisfied(p, perek, s));
  return i < 0 ? steps.length : i;
}

/**
 * building: steps left. ready: every step satisfied, waiting for the end-of-perek gate. complete: the gate passed.
 * This is the only reader of `complete` (roadmap item 2 adds its verification stages here).
 */
export type PerekStage = "building" | "ready" | "complete";

export function perekStage(p: Profile, perek: number): PerekStage {
  if (pp(p, perek).complete === true) return "complete";
  const steps = perekSteps(perek);
  return steps.length > 0 && perekFrontier(p, perek) === steps.length ? "ready" : "building";
}

export const perekDone = (p: Profile, perek: number): boolean => perekStage(p, perek) === "complete";

/**
 * A mishnah step can always start. A chain needs every mishnah in it known, and (for a step of this perek's build-up)
 * the build-up must have reached it: every earlier step satisfied. Passing a chain satisfies every range it contains,
 * so without the second rule a child could jump to "the whole perek" and skip the build-up. Steps already satisfied
 * stay startable.
 */
export function canStartPerekStep(p: Profile, perek: number, s: PerekStep): boolean {
  if (s.kind === "mishnah") return true;
  for (let m = s.from; m <= s.to; m++) if (!isKnown(mp(p, perek, m))) return false;
  const i = perekSteps(perek).findIndex((x) => x.kind === "chain" && x.from === s.from && x.to === s.to);
  return i < 0 || i <= perekFrontier(p, perek) || chainSatisfied(p, perek, s.from, s.to);
}

/** The golden join between mishnah m-1 and m: those two have been said together. */
export function joined(p: Profile, perek: number, m: number): boolean {
  return m >= 2 && chainSatisfied(p, perek, m - 1, m);
}

/**
 * A build-up chain from..to was passed (self-check). Adds the range, drops stored ranges it contains, keeps the list
 * in canonical order. Returns `p` itself when the range was already satisfied. Never sets `complete`.
 */
export function passPerekChain(p: Profile, perek: number, from: number, to: number): Profile {
  if (chainSatisfied(p, perek, from, to)) return p;
  const cur = pp(p, perek);
  const kept: Array<[number, number]> = [];
  const stored: unknown = (cur as { chains?: unknown }).chains;
  if (Array.isArray(stored)) {
    for (const k of stored) {
      const r = parseChainKey(k);
      if (r && !(from <= r[0] && r[1] <= to) && !kept.some(([a, b]) => a === r[0] && b === r[1])) kept.push(r);
    }
  }
  kept.push([from, to]);
  kept.sort((x, y) => x[0] - y[0] || x[1] - y[1]);
  const prevThrough = typeof cur.chainedThrough === "number" && Number.isFinite(cur.chainedThrough) ? cur.chainedThrough : 0;
  return withP(p, perek, {
    ...cur,
    chainedThrough: Math.max(prevThrough, from === 1 ? to : 0),
    chains: kept.map(([a, b]) => chainKey(a, b)),
  });
}

/**
 * The end-of-perek gate (today: the in-app parent check). The only writer of `complete`; a no-op unless the
 * build-up is "ready". "Not yet" changes nothing, so the child can practise and try again.
 * Roadmap item 2 replaces this call site with the parent's email verification.
 */
export function checkPerek(p: Profile, perek: number, grade: Grade): Profile {
  if (perekStage(p, perek) !== "ready" || grade === "notyet") return p;
  const cur = pp(p, perek);
  return withP(p, perek, { ...cur, complete: true, chainedThrough: mishnayosOf(perek).length, review: cur.review ?? newReview() });
}

/** The next build-up task in one perek, or null once it is complete. */
export function nextInPerek(p: Profile, perek: number): Task | null {
  const stage = perekStage(p, perek);
  if (stage === "complete") return null;
  if (stage === "ready") return { type: "perek-finish", perek };
  const s = perekSteps(perek)[perekFrontier(p, perek)];
  if (!s) return null;
  return s.kind === "mishnah" ? { type: "learn", perek, mishnah: s.mishnah } : { type: "perek-chain", perek, from: s.from, to: s.to };
}

/** The next new-learning task: the build-up frontier of the first perek that is not done. */
export function nextLearning(p: Profile): Task | null {
  for (const perek of PERAKIM) {
    if (perekDone(p, perek)) continue; // roadmap item 2: also stop at the first perek waiting for verification
    return nextInPerek(p, perek);
  }
  return null;
}

export function resetMishnah(p: Profile, perek: number, mishnah: number): Profile {
  return withM(p, perek, mishnah, blankMishnah());
}

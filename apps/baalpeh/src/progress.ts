import { getMishnah, mishnayosOf, mKey, PERAKIM } from "./data";
import { gradeReview, isDue, newReview, today } from "./srs";
import { buildSteps } from "./steps";
import { blankMishnah, blankPerek } from "./storage";
import type { Grade, MishnahProgress, PerekProgress, Profile } from "./types";

export type Task =
  | { type: "learn"; perek: number; mishnah: number }
  | { type: "review-m"; perek: number; mishnah: number }
  | { type: "perek-chain"; perek: number; through: number }
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

/** Parent verified the chain [1..through] of a perek. */
export function parentCheckChain(p: Profile, perek: number, through: number, grade: Grade): Profile {
  if (grade === "notyet") return p;
  const cur = pp(p, perek);
  const count = mishnayosOf(perek).length;
  const complete = through >= count;
  return withP(p, perek, {
    chainedThrough: Math.max(cur.chainedThrough, through),
    complete: cur.complete || complete,
    ...(complete ? { review: cur.review ?? newReview() } : cur.review ? { review: cur.review } : {}),
  });
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
    const pr = pp(p, perek);
    if (pr.complete) {
      if (isDue(pr.review, now)) out.push({ type: "review-p", perek });
      continue;
    }
    for (const m of mishnayosOf(perek)) {
      if (isDue(mp(p, perek, m.mishnah).review, now)) out.push({ type: "review-m", perek, mishnah: m.mishnah });
    }
  }
  return out;
}

/** The next new-learning task: finish a mishnah in progress, else extend the perek chain, else start the next mishnah. */
export function nextLearning(p: Profile): Task | null {
  for (const perek of PERAKIM) {
    const pr = pp(p, perek);
    if (pr.complete) continue;
    const list = mishnayosOf(perek);
    const prefix = knownPrefix(p, perek);
    if (prefix >= 2 && pr.chainedThrough < prefix) return { type: "perek-chain", perek, through: prefix };
    const inProgress = list.find((m) => mp(p, perek, m.mishnah).state === "learning");
    if (inProgress) return { type: "learn", perek, mishnah: inProgress.mishnah };
    const next = list.find((m) => mp(p, perek, m.mishnah).state === "new");
    if (next) return { type: "learn", perek, mishnah: next.mishnah };
    if (prefix === list.length && list.length === 1 && !pr.complete) return { type: "perek-chain", perek, through: 1 };
    return null;
  }
  return null;
}

export function resetMishnah(p: Profile, perek: number, mishnah: number): Profile {
  return withM(p, perek, mishnah, blankMishnah());
}

import { describe, expect, it } from "vitest";
import { DEFAULT_MASECHTA_ID, getMishnah, MASECHTA, setMasechta } from "../src/data";
import { firstLetter } from "../src/hebrew";
import {
  canStartPerekStep, chainSatisfied, checkPerek, completeStep, dueReviews, joined, knownPrefix, mp, nextInPerek, nextLearning,
  parentCheckMishnah, passPerekChain, perekDone, perekFrontier, perekStage, resetMishnah, setStep, type Task,
} from "../src/progress";
import { perekSteps } from "../src/perekSteps";
import { gradeReview, newReview } from "../src/srs";
import { buildSteps, MAX_SEGMENT, segments } from "../src/steps";
import { newProfile } from "../src/storage";
import type { PerekProgress, Profile } from "../src/types";

describe("segments", () => {
  it("covers every chunk exactly once, each ≤ MAX", () => {
    for (const m of MASECHTA.mishnayos) {
      const segs = segments(m.chunks);
      const covered = segs.flatMap(([a, b]) => Array.from({ length: b - a + 1 }, (_, i) => a + i));
      expect(covered).toEqual(m.chunks.map((_, i) => i));
      for (const [a, b] of segs) expect(b - a + 1).toBeLessThanOrEqual(MAX_SEGMENT);
    }
  });
});

describe("buildSteps", () => {
  it("follows C1, C2, [1-2], C3, [1-3] and ends with the whole mishnah", () => {
    for (const m of MASECHTA.mishnayos) {
      const steps = buildSteps(m.chunks);
      const last = steps[steps.length - 1];
      expect(last).toMatchObject({ kind: "chain", from: 0, to: m.chunks.length - 1 });
      expect(steps.filter((s) => s.kind === "learn").length).toBe(m.chunks.length);
    }
    const m = getMishnah(1, 2);
    const s = buildSteps(m.chunks).slice(0, 5).map((x) => (x.kind === "learn" ? `L${x.chunk}` : `C${x.from}-${x.to}`));
    expect(s).toEqual(["L0", "L1", "C0-1", "L2", "C0-2"]);
  });
});

describe("firstLetter", () => {
  it("keeps nikud of the first letter", () => {
    expect(firstLetter("מֵאֵימָתַי")).toBe("מֵ");
    expect(firstLetter("שְׁמַע")).toBe("שְׁ");
    expect(firstLetter("(דברים")).toBe("ד");
  });
});

describe("srs", () => {
  it("moves boxes", () => {
    const r = newReview("2026-01-01");
    expect(r.due).toBe("2026-01-02");
    const r2 = gradeReview(r, "pass", "2026-01-02");
    expect(r2).toMatchObject({ box: 1, due: "2026-01-05" });
    expect(gradeReview(r2, "notyet", "2026-01-05").box).toBe(0);
  });
});

describe("progress", () => {
  const learnAll = (p0: Profile, perek: number, mishnah: number): Profile => {
    let p = p0;
    for (;;) {
      const r = completeStep(p, perek, mishnah);
      p = r.profile;
      if (r.finished) break;
    }
    return parentCheckMishnah(p, perek, mishnah, "pass");
  };

  it("goes mishnah 1 → 2 → chain → 3", () => {
    let p = newProfile("A", 0);
    expect(nextLearning(p)).toEqual({ type: "learn", perek: 1, mishnah: 1 });
    p = learnAll(p, 1, 1);
    expect(nextLearning(p)).toEqual({ type: "learn", perek: 1, mishnah: 2 });
    p = learnAll(p, 1, 2);
    expect(knownPrefix(p, 1)).toBe(2);
    expect(nextLearning(p)).toEqual({ type: "perek-chain", perek: 1, from: 1, to: 2 });
    p = passPerekChain(p, 1, 1, 2);
    expect(nextLearning(p)).toEqual({ type: "learn", perek: 1, mishnah: 3 });
  });
});

// ───────────── perek build-up (docs/PEREK_BUILDUP.md §13, tests 7–18) ─────────────

const learnAllM = (p0: Profile, perek: number, mishnah: number): Profile => {
  let p = p0;
  for (;;) {
    const r = completeStep(p, perek, mishnah);
    p = r.profile;
    if (r.finished) break;
  }
  return parentCheckMishnah(p, perek, mishnah, "pass");
};

const taskKey = (t: Task | null): string =>
  !t ? "none"
    : t.type === "learn" ? `M${t.mishnah}`
    : t.type === "perek-chain" ? `C${t.from}-${t.to}`
    : t.type === "perek-finish" ? "finish"
    : t.type;

/** Follows nextLearning through one perek, doing each task; returns the keys in order and the profile at the end. */
function walk(p0: Profile, perek: number): { keys: string[]; p: Profile } {
  let p = p0;
  const keys: string[] = [];
  for (let guard = 0; guard < 200; guard++) {
    const t = nextLearning(p);
    if (!t || t.perek !== perek) break;
    keys.push(taskKey(t));
    if (t.type === "learn") p = learnAllM(p, perek, t.mishnah);
    else if (t.type === "perek-chain") p = passPerekChain(p, perek, t.from, t.to);
    else if (t.type === "perek-finish") p = checkPerek(p, perek, "pass");
    else throw new Error(`unexpected ${t.type}`);
  }
  return { keys, p };
}

const withPerek = (p: Profile, perek: number, pr: Omit<Partial<PerekProgress>, "chains"> & { chains?: unknown }): Profile =>
  ({ ...p, perakim: { ...p.perakim, [String(perek)]: { chainedThrough: 0, complete: false, ...pr } as PerekProgress } });

const knowing = (perek: number, ms: number[], p0: Profile = newProfile("K", 0)): Profile =>
  ms.reduce((p, m) => learnAllM(p, perek, m), p0);

describe("perek build-up: scheduling", () => {
  it("walks perek 1 through nextLearning and moves on to perek 2", () => {
    const { keys, p } = walk(newProfile("A", 0), 1);
    expect(keys).toEqual(["M1", "M2", "C1-2", "M3", "C1-3", "M4", "C1-4", "M5", "C1-5", "finish"]);
    expect(perekStage(p, 1)).toBe("complete");
    expect(p.perakim["1"]?.review).toBeDefined();
    expect(p.perakim["1"]?.chainedThrough).toBe(5);
    expect(nextLearning(p)).toEqual({ type: "learn", perek: 2, mishnah: 1 });
  });

  it("walks an 8-mishnah perek in two parts, then joins them", () => {
    const done1 = walk(newProfile("A", 0), 1).p;
    const { keys } = walk(done1, 2);
    expect(keys).toEqual(["M1", "M2", "C1-2", "M3", "C1-3", "M4", "C1-4", "M5", "M6", "C5-6", "M7", "C5-7", "M8", "C5-8", "C1-8", "finish"]);
  });

  it("reads legacy perek records by containment", () => {
    // chainedThrough 3, M1–4 known → the chain 1–4.
    expect(nextLearning(withPerek(knowing(1, [1, 2, 3, 4]), 1, { chainedThrough: 3 }))).toEqual({ type: "perek-chain", perek: 1, from: 1, to: 4 });
    // chainedThrough 0, M1–2 known → the chain 1–2 (as the old scheduler did).
    expect(nextLearning(knowing(1, [1, 2]))).toEqual({ type: "perek-chain", perek: 1, from: 1, to: 2 });
    // chainedThrough 6 in perek 2 satisfies C5-6.
    const p2 = withPerek(knowing(2, [1, 2, 3, 4, 5, 6]), 2, { chainedThrough: 6 });
    expect(chainSatisfied(p2, 2, 5, 6)).toBe(true);
    expect(nextInPerek(p2, 2)).toEqual({ type: "learn", perek: 2, mishnah: 7 });
  });

  it("skips a legacy complete perek, and reviews it as one item when due", () => {
    const p = withPerek(newProfile("A", 0), 1, { chainedThrough: 5, complete: true, review: { box: 0, due: "2026-01-01", passes: 0 } });
    expect(perekDone(p, 1)).toBe(true);
    expect(nextLearning(p)).toEqual({ type: "learn", perek: 2, mishnah: 1 });
    expect(dueReviews(p, "2026-01-02")).toContainEqual({ type: "review-p", perek: 1 });
  });

  it("does not relearn a mishnah known out of order", () => {
    let p = knowing(1, [1, 3]);
    expect(nextLearning(p)).toEqual({ type: "learn", perek: 1, mishnah: 2 });
    p = learnAllM(p, 1, 2);
    expect(nextLearning(p)).toEqual({ type: "perek-chain", perek: 1, from: 1, to: 2 });
    p = passPerekChain(p, 1, 1, 2);
    expect(nextLearning(p)).toEqual({ type: "perek-chain", perek: 1, from: 1, to: 3 });
  });

  it("does not schedule a 'learning' mishnah beyond the frontier first", () => {
    const p = setStep(knowing(1, [1]), 1, 5, 2);
    expect(mp(p, 1, 5).state).toBe("learning");
    expect(nextLearning(p)).toEqual({ type: "learn", perek: 1, mishnah: 2 });
  });

  it("nextInPerek only returns tasks of its own perek", () => {
    const p = walk(newProfile("A", 0), 1).p;
    expect(nextInPerek(p, 1)).toBeNull();
    for (const perek of [2, 3, 9]) {
      const t = nextInPerek(knowing(perek, [1]), perek);
      expect(t?.perek).toBe(perek);
    }
  });

  it("resetting mishnah k makes it the frontier again", () => {
    let p = knowing(1, [1, 2, 3]);
    p = passPerekChain(passPerekChain(p, 1, 1, 2), 1, 1, 3);
    expect(nextLearning(p)).toEqual({ type: "learn", perek: 1, mishnah: 4 });
    p = resetMishnah(p, 1, 2);
    expect(perekSteps(1)[perekFrontier(p, 1)]).toMatchObject({ kind: "mishnah", mishnah: 2 });
    expect(nextLearning(p)).toEqual({ type: "learn", perek: 1, mishnah: 2 });
  });
});

describe("perek build-up: progress", () => {
  it("passPerekChain satisfies contained chains and keeps chainedThrough", () => {
    const p0 = knowing(1, [1, 2, 3, 4]);
    const p = passPerekChain(p0, 1, 1, 4);
    expect(chainSatisfied(p, 1, 1, 2)).toBe(true);
    expect(chainSatisfied(p, 1, 1, 3)).toBe(true);
    expect(p.perakim["1"]?.chainedThrough).toBe(4);
    expect(p.perakim["1"]?.complete).toBe(false);
    const q = passPerekChain(knowing(2, [5, 6]), 2, 5, 6);
    expect(q.perakim["2"]).toMatchObject({ chainedThrough: 0, chains: ["5-6"], complete: false });
  });

  it("prunes contained entries, keeps canonical order, and returns the same object when already satisfied", () => {
    let p = newProfile("A", 0);
    p = passPerekChain(p, 2, 5, 6);
    p = passPerekChain(p, 2, 2, 3);
    expect(p.perakim["2"]?.chains).toEqual(["2-3", "5-6"]);
    p = passPerekChain(p, 2, 5, 8);
    expect(p.perakim["2"]?.chains).toEqual(["2-3", "5-8"]);
    expect(passPerekChain(p, 2, 6, 7)).toBe(p);
    p = passPerekChain(p, 2, 1, 8);
    expect(p.perakim["2"]?.chains).toEqual(["1-8"]);
    expect(p.perakim["2"]?.chainedThrough).toBe(8);
    expect(p.perakim["2"]?.complete).toBe(false);
  });

  it("checkPerek is the gate: a no-op while building and on 'not yet'; pass completes and keeps chains", () => {
    const building = knowing(1, [1, 2]);
    expect(checkPerek(building, 1, "pass")).toBe(building);
    let ready = knowing(1, [1, 2, 3, 4, 5]);
    for (const to of [2, 3, 4, 5]) ready = passPerekChain(ready, 1, 1, to);
    expect(perekStage(ready, 1)).toBe("ready");
    expect(checkPerek(ready, 1, "notyet")).toBe(ready);
    const done = checkPerek(ready, 1, "pass");
    expect(done.perakim["1"]).toMatchObject({ complete: true, chainedThrough: 5, chains: ["1-5"] });
    expect(done.perakim["1"]?.review).toBeDefined();
  });

  it("perekStage goes building → ready → complete, and a one-mishnah perek is ready once it is known", () => {
    let p = knowing(1, [1, 2, 3, 4, 5]);
    expect(perekStage(p, 1)).toBe("building");
    p = passPerekChain(p, 1, 1, 5);
    expect(perekStage(p, 1)).toBe("ready");
    expect(nextInPerek(p, 1)).toEqual({ type: "perek-finish", perek: 1 });
    expect(perekStage(checkPerek(p, 1, "help"), 1)).toBe("complete");
  });

  it("a one-mishnah perek is 'ready' as soon as its mishnah is known", () => {
    const saved = MASECHTA;
    const one = saved.mishnayos.find((m) => m.perek === 1 && m.mishnah === 1)!;
    try {
      setMasechta("one-test", { ...saved, mishnayos: [one] });
      const p0 = newProfile("A", 0);
      expect(nextLearning(p0)).toEqual({ type: "learn", perek: 1, mishnah: 1 });
      const p = learnAllM(p0, 1, 1);
      expect(perekStage(p, 1)).toBe("ready");
      expect(nextLearning(p)).toEqual({ type: "perek-finish", perek: 1 });
      expect(perekStage(checkPerek(p, 1, "pass"), 1)).toBe("complete");
    } finally {
      setMasechta(DEFAULT_MASECHTA_ID, saved);
    }
  });

  it("ignores malformed stored chains without throwing", () => {
    const base = knowing(1, [1, 2]);
    for (const chains of [null, [3], ["3-1", "x"], "1-2", [{}]]) {
      const p = withPerek(base, 1, { chains });
      expect(chainSatisfied(p, 1, 1, 2)).toBe(false);
      expect(nextLearning(p)).toEqual({ type: "perek-chain", perek: 1, from: 1, to: 2 });
      expect(() => passPerekChain(p, 1, 1, 2)).not.toThrow();
      expect(passPerekChain(p, 1, 1, 2).perakim["1"]?.chains).toEqual(["1-2"]);
    }
  });

  it("canStartPerekStep: a chain needs every mishnah in it known; a mishnah step can always start", () => {
    const p = knowing(1, [1, 2]);
    expect(canStartPerekStep(p, 1, { kind: "chain", from: 1, to: 3, newest: 3, label: "" })).toBe(false);
    expect(canStartPerekStep(p, 1, { kind: "chain", from: 1, to: 2, newest: 2, label: "" })).toBe(true);
    expect(canStartPerekStep(p, 1, { kind: "mishnah", mishnah: 4, label: "" })).toBe(true);
  });

  it("joined follows containment, legacy chainedThrough and complete", () => {
    const p = passPerekChain(newProfile("A", 0), 2, 5, 7);
    expect([1, 2, 5, 6, 7, 8].map((m) => joined(p, 2, m))).toEqual([false, false, false, true, true, false]);
    const legacy = withPerek(newProfile("A", 0), 2, { chainedThrough: 3 });
    expect([2, 3, 4].map((m) => joined(legacy, 2, m))).toEqual([true, true, false]);
    const complete = withPerek(newProfile("A", 0), 2, { complete: true });
    expect(joined(complete, 2, 8)).toBe(true);
  });
});

describe("setStep (free navigation)", () => {
  const total = buildSteps(getMishnah(1, 1).chunks).length;
  const fresh = (): Profile => newProfile("Kid", 0);

  it("clamps to [0, total]", () => {
    const p = fresh();
    expect(mp(setStep(p, 1, 1, -3), 1, 1).stepIndex).toBe(0);
    expect(mp(setStep(p, 1, 1, total + 5), 1, 1).stepIndex).toBe(total);
  });

  it("moves backward, and completeStep continues from there", () => {
    let p = setStep(fresh(), 1, 1, 5);
    p = setStep(p, 1, 1, 4);
    expect(mp(p, 1, 1).stepIndex).toBe(4);
    expect(mp(completeStep(p, 1, 1).profile, 1, 1).stepIndex).toBe(5);
  });

  it("starts a new mishnah, so nextLearning resumes it once the build-up reaches it", () => {
    const p = setStep(fresh(), 1, 1, 2);
    expect(mp(p, 1, 1).state).toBe("learning");
    expect(nextLearning(p)).toEqual({ type: "learn", perek: 1, mishnah: 1 });
  });

  it("keeps a known mishnah known (with its review)", () => {
    const known = parentCheckMishnah(setStep(fresh(), 1, 1, total), 1, 1, "pass");
    expect(mp(known, 1, 1).state).toBe("known");
    const back = setStep(known, 1, 1, 0);
    expect(mp(back, 1, 1).state).toBe("known");
    expect(mp(back, 1, 1).review).toEqual(mp(known, 1, 1).review);
  });

  it("returns the same profile when the step does not change", () => {
    const p = setStep(fresh(), 1, 1, 2);
    expect(setStep(p, 1, 1, 2)).toBe(p);
  });

  it("jumping to the parent check: notyet sends it back to the last step", () => {
    const p = parentCheckMishnah(setStep(fresh(), 1, 1, total), 1, 1, "notyet");
    expect(mp(p, 1, 1).stepIndex).toBe(total - 1);
  });
});

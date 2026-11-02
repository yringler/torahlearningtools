import { describe, expect, it } from "vitest";
import { getMishnah, MASECHTA, mishnayosOf } from "../src/data";
import { firstLetter } from "../src/hebrew";
import { completeStep, knownPrefix, mp, nextLearning, parentCheckChain, parentCheckMishnah, setStep } from "../src/progress";
import { gradeReview, newReview } from "../src/srs";
import { buildSteps, MAX_SEGMENT, segments } from "../src/steps";
import { newProfile } from "../src/storage";
import type { Profile } from "../src/types";

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
    expect(nextLearning(p)).toEqual({ type: "perek-chain", perek: 1, through: 2 });
    p = parentCheckChain(p, 1, 2, "pass");
    expect(nextLearning(p)).toEqual({ type: "learn", perek: 1, mishnah: 3 });
  });

  it("completes a perek and moves on", () => {
    let p = newProfile("A", 0);
    const n = mishnayosOf(1).length;
    for (let m = 1; m <= n; m++) p = learnAll(p, 1, m);
    p = parentCheckChain(p, 1, n, "pass");
    expect(p.perakim["1"]?.complete).toBe(true);
    expect(nextLearning(p)).toEqual({ type: "learn", perek: 2, mishnah: 1 });
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

  it("starts a new mishnah, so nextLearning resumes it", () => {
    const p = setStep(fresh(), 1, 3, 2);
    expect(mp(p, 1, 3).state).toBe("learning");
    expect(nextLearning(p)).toEqual({ type: "learn", perek: 1, mishnah: 3 });
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

import { describe, expect, it } from "vitest";
import { MASECHTA, mishnayosOf, PERAKIM } from "../src/data";
import {
  MAX_PEREK_PART, parseChainKey, perekParts, perekPathSteps, perekPhrases, perekPracticeLabel, perekSegs, perekSteps, stepsForCount,
  type PerekStep,
} from "../src/perekSteps";
import {
  buildSteps, groupIndexOf, groupRange, pathGroups, pathGroupsFor, practiceLabel, segments, stepPosition, type PathNode,
} from "../src/steps";
import type { Chunk } from "../src/types";

/** n chunks with no sentence ends, so segments split evenly (15 → 5 + 5 + 5). */
const chunks = (n: number): Chunk[] => Array.from({ length: n }, (_, i) => ({ he: `מילה${i},`, en: "", words: [] }));

const stepNodes = (nodes: PathNode[]) => nodes.filter((n) => n.type !== "partTile");

describe("pathGroups", () => {
  it("draws a 6-piece part as 6 tiles and 5 links, alternating in step order", () => {
    const c = chunks(6);
    const groups = pathGroups(buildSteps(c), c);
    expect(groups).toHaveLength(1);
    const g = groups[0]!;
    expect(g.pieces).toBe(6);
    expect(g.nodes.map((n) => n.type)).toEqual(["tile", "tile", "link", "tile", "link", "tile", "link", "tile", "link", "tile", "link"]);
    expect(g.nodes.map((n) => (n.type === "partTile" ? -1 : n.step))).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(g.nodes.filter((n) => n.type === "tile").map((n) => (n.type === "tile" ? n.n : 0))).toEqual([1, 2, 3, 4, 5, 6]);
    const links = g.nodes.filter((n) => n.type === "link");
    expect(links.map((n) => (n.type === "link" ? n.through : 0))).toEqual([2, 3, 4, 5, 6]);
    expect(links.map((n) => (n.type === "link" ? n.final : null))).toEqual([false, false, false, false, true]);
  });

  it("gives a one-piece part a tile plus a trailing 'say it by heart' link", () => {
    const c = chunks(1);
    const groups = pathGroups(buildSteps(c), c);
    expect(groups[0]!.nodes).toEqual([
      { type: "tile", step: 0, n: 1 },
      { type: "link", step: 1, through: 1, final: true },
    ]);
  });

  it("draws a 3-part mishnah's join group as 3 part tiles and 2 join links", () => {
    const c = chunks(15);
    expect(segments(c)).toHaveLength(3);
    const steps = buildSteps(c);
    const groups = pathGroups(steps, c);
    expect(groups.map((g) => g.key)).toEqual([0, 1, 2, "join"]);
    const join = groups[3]!;
    expect(join.pieces).toBe(3);
    expect(join.nodes.map((n) => n.type)).toEqual(["partTile", "partTile", "link", "partTile", "link"]);
    const last = join.nodes[4];
    expect(last?.type === "link" && last.final && last.step === steps.length - 1).toBe(true);
    expect(steps[steps.length - 1]?.label).toBe("The whole mishnah!");
  });

  it("covers every step exactly once, for every mishnah in the data", () => {
    for (const m of MASECHTA.mishnayos) {
      const steps = buildSteps(m.chunks);
      const seen = pathGroups(steps, m.chunks)
        .flatMap((g) => stepNodes(g.nodes))
        .map((n) => (n.type === "partTile" ? -1 : n.step))
        .sort((a, b) => a - b);
      expect(seen).toEqual(steps.map((_, i) => i));
    }
  });
});

describe("stepPosition", () => {
  it("maps a step to 'piece k of n' in its part", () => {
    const c = chunks(15);
    const steps = buildSteps(c);
    const groups = pathGroups(steps, c);
    const i = steps.findIndex((s) => s.label === "Part 2 · New piece 3");
    expect(stepPosition(groups, i)).toEqual({ group: 1, piece: 3, of: 5, kind: "new" });
    const j = steps.findIndex((s) => s.label === "Part 2 · Pieces 1–3 together");
    expect(stepPosition(groups, j)).toEqual({ group: 1, piece: 3, of: 5, kind: "together" });
    expect(stepPosition(groups, steps.length - 1)).toEqual({ group: 3, piece: 3, of: 3, kind: "join" });
    expect(stepPosition(groups, steps.length)).toBeNull();
  });
});

describe("practice picker helpers", () => {
  it("every group of every mishnah is a contiguous step range, and the ranges cover each step once", () => {
    for (const m of MASECHTA.mishnayos) {
      const steps = buildSteps(m.chunks);
      const groups = pathGroups(steps, m.chunks);
      const seen = new Set<number>();
      for (const g of groups) {
        const r = groupRange(g);
        expect(r).not.toBeNull();
        const [a, b] = r!;
        expect(g.steps).toEqual(Array.from({ length: b - a + 1 }, (_, i) => a + i));
        g.steps.forEach((i) => { expect(seen.has(i)).toBe(false); seen.add(i); });
        g.steps.forEach((i) => expect(groupIndexOf(groups, i)).toBe(groups.indexOf(g)));
      }
      expect(seen.size).toBe(steps.length);
    }
  });

  it("names a single-part selection without a part prefix", () => {
    const c = chunks(4);
    const groups = pathGroups(buildSteps(c), c);
    expect(practiceLabel(groups, { group: 0 })).toBe("all the steps");
    expect(practiceLabel(groups, { step: 0 })).toBe("piece 1");
    expect(practiceLabel(groups, { step: 2 })).toBe("pieces 1–2 together");
  });

  it("names parts, pieces and joins of a multi-part mishnah", () => {
    const c = chunks(15);
    const steps = buildSteps(c);
    const groups = pathGroups(steps, c);
    expect(practiceLabel(groups, { group: 1 })).toBe("Part 2");
    expect(practiceLabel(groups, { group: 3 })).toBe("joining the parts");
    const p2 = groups[1]!.steps;
    expect(practiceLabel(groups, { step: p2[0]! })).toBe("Part 2 · piece 1");
    expect(practiceLabel(groups, { step: p2[p2.length - 1]! })).toBe("Part 2 · pieces 1–5 together");
    const joins = groups[3]!.steps;
    expect(practiceLabel(groups, { step: joins[0]! })).toBe("parts 1–2 together");
    expect(practiceLabel(groups, { step: joins[joins.length - 1]! })).toBe("the whole mishnah");
  });

  it("names a one-piece part's chain step", () => {
    const c = chunks(1);
    const groups = pathGroups(buildSteps(c), c);
    expect(practiceLabel(groups, { step: 1 })).toBe("piece 1 by heart");
  });
});

// ───────────── perek build-up steps (docs/PEREK_BUILDUP.md §13, tests 1–6) ─────────────

const keyOf = (s: PerekStep): string => (s.kind === "mishnah" ? `M${s.mishnah}` : `C${s.from}-${s.to}`);

describe("perekSteps", () => {
  it("builds a 5-mishnah perek as one cumulative chain", () => {
    expect(mishnayosOf(1)).toHaveLength(5);
    const steps = perekSteps(1);
    expect(steps.map(keyOf)).toEqual(["M1", "M2", "C1-2", "M3", "C1-3", "M4", "C1-4", "M5", "C1-5"]);
    expect(steps.map((s) => s.label)).toEqual([
      "Mishnah 1", "Mishnah 2", "Mishnayos 1–2 together", "Mishnah 3", "Mishnayos 1–3 together",
      "Mishnah 4", "Mishnayos 1–4 together", "Mishnah 5", "The whole perek!",
    ]);
    expect(steps.filter((s) => s.kind === "chain").every((s) => s.kind === "chain" && s.newest === s.to)).toBe(true);
  });

  it("builds an 8-mishnah perek in two parts, then joins them", () => {
    expect(mishnayosOf(2)).toHaveLength(8);
    const steps = perekSteps(2);
    expect(steps.map(keyOf)).toEqual(["M1", "M2", "C1-2", "M3", "C1-3", "M4", "C1-4", "M5", "M6", "C5-6", "M7", "C5-7", "M8", "C5-8", "C1-8"]);
    expect(steps.find((s) => keyOf(s) === "C5-7")?.label).toBe("Part 2 · Mishnayos 5–7 together");
    expect(steps[steps.length - 1]?.label).toBe("The whole perek!");
  });

  it("labels non-final joins of a 3-part perek", () => {
    const steps = stepsForCount(12);
    expect(perekParts(12)).toEqual([[1, 4], [5, 8], [9, 12]]);
    expect(steps.slice(-2).map((s) => [keyOf(s), s.label])).toEqual([["C1-8", "Parts 1–2 together"], ["C1-12", "The whole perek!"]]);
  });
});

describe("perekParts", () => {
  it("splits evenly by count, at most MAX_PEREK_PART each", () => {
    expect(perekParts(1)).toEqual([[1, 1]]);
    expect(stepsForCount(1).map(keyOf)).toEqual(["M1"]);
    expect(perekParts(5)).toEqual([[1, 5]]);
    expect(perekParts(6)).toEqual([[1, 3], [4, 6]]);
    expect(perekParts(7)).toEqual([[1, 4], [5, 7]]);
    expect(perekParts(8)).toEqual([[1, 4], [5, 8]]);
    expect(perekParts(0)).toEqual([]);
    for (let n = 1; n <= 40; n++) {
      const parts = perekParts(n);
      const covered = parts.flatMap(([a, b]) => Array.from({ length: b - a + 1 }, (_, i) => a + i));
      expect(covered).toEqual(Array.from({ length: n }, (_, i) => i + 1));
      for (const [a, b] of parts) {
        expect(b - a + 1).toBeLessThanOrEqual(MAX_PEREK_PART);
        if (n >= 6) expect(b - a + 1).toBeGreaterThanOrEqual(3);
      }
    }
  });

  it("every perek in the data: each mishnah once, chains after their mishnayos, ending with the whole perek", () => {
    for (const perek of PERAKIM) {
      const n = mishnayosOf(perek).length;
      const steps = perekSteps(perek);
      const ms = steps.filter((s) => s.kind === "mishnah").map((s) => (s.kind === "mishnah" ? s.mishnah : 0));
      expect(ms).toEqual(Array.from({ length: n }, (_, i) => i + 1));
      const seen = new Set<number>();
      for (const s of steps) {
        if (s.kind === "mishnah") { seen.add(s.mishnah); continue; }
        for (let m = s.from; m <= s.to; m++) expect(seen.has(m)).toBe(true);
      }
      if (n >= 2) expect(steps[steps.length - 1]).toMatchObject({ kind: "chain", from: 1, to: n });
    }
  });
});

describe("perek path groups", () => {
  it("covers every perek step once, in contiguous groups", () => {
    for (const perek of PERAKIM) {
      const steps = perekSteps(perek);
      const groups = pathGroupsFor(perekPathSteps(steps), perekSegs(perek));
      const seen = groups.flatMap((g) => stepNodes(g.nodes)).map((n) => (n.type === "partTile" ? -1 : n.step)).sort((a, b) => a - b);
      expect(seen).toEqual(steps.map((_, i) => i));
      for (const g of groups) {
        const r = groupRange(g);
        expect(r).not.toBeNull();
        expect(g.steps).toEqual(Array.from({ length: r![1] - r![0] + 1 }, (_, i) => r![0] + i));
      }
      expect(groups).toHaveLength(perekParts(mishnayosOf(perek).length).length > 1 ? perekParts(mishnayosOf(perek).length).length + 1 : 1);
    }
  });

  it("pathGroups is pathGroupsFor with the mishnah's segments", () => {
    for (const m of MASECHTA.mishnayos) {
      const steps = buildSteps(m.chunks);
      expect(pathGroups(steps, m.chunks)).toEqual(pathGroupsFor(steps, segments(m.chunks)));
    }
  });
});

describe("perek helpers", () => {
  it("names practice ranges", () => {
    expect(perekPracticeLabel(2, 2, 2)).toBe("Mishnah 2");
    expect(perekPracticeLabel(2, 1, 2)).toBe("Mishnayos 1–2 together");
    expect(perekPracticeLabel(2, 1, 8)).toBe("The whole perek");
  });

  it("parses chain keys strictly", () => {
    expect(parseChainKey("1-3")).toEqual([1, 3]);
    expect(parseChainKey("4-4")).toEqual([4, 4]);
    for (const bad of ["3-1", "0-2", "1-", "x", "1-2-3", "1234-5", 5, null, undefined, {}]) expect(parseChainKey(bad)).toBeNull();
  });

  it("splits the perek phrase by phrase", () => {
    const text = perekPhrases(1);
    expect(text.map((t) => t.mishnah)).toEqual([1, 2, 3, 4, 5]);
    expect(text[0]?.phrases).toEqual(mishnayosOf(1)[0]?.chunks.map((c) => c.he));
  });
});

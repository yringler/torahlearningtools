import { describe, expect, it } from "vitest";
import { MASECHTA } from "../src/data";
import { buildSteps, groupIndexOf, groupRange, pathGroups, practiceLabel, segments, stepPosition, type PathNode } from "../src/steps";
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

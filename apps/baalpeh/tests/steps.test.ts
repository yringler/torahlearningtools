import { describe, expect, it } from "vitest";
import { MASECHTA } from "../src/data";
import { buildSteps, pathGroups, segments, stepPosition, type PathNode } from "../src/steps";
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

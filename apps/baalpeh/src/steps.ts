import type { Chunk, Step } from "./types";

export const MAX_SEGMENT = 6;

const endsSentence = (he: string): boolean => /[.:?!]$/.test(he.trim());

/**
 * Split chunk indices into segments of ≤ MAX_SEGMENT chunks.
 * Segment count is ceil(n / MAX). Each boundary is placed near the ideal even split,
 * nudged (±2) to the closest chunk that ends a sentence, so halves start at a natural place.
 */
export function segments(chunks: Chunk[]): Array<[number, number]> {
  const n = chunks.length;
  const count = Math.max(1, Math.ceil(n / MAX_SEGMENT));
  const bounds: number[] = [0];
  for (let s = 1; s < count; s++) {
    const ideal = Math.round((n * s) / count);
    const prev = bounds[bounds.length - 1] ?? 0;
    let best = ideal;
    let bestScore = Number.POSITIVE_INFINITY;
    for (let b = ideal - 2; b <= ideal + 2; b++) {
      // segment [prev, b) must be 2..MAX long, and leave room for the rest
      if (b - prev < 2 || b - prev > MAX_SEGMENT) continue;
      if ((n - b) > MAX_SEGMENT * (count - s)) continue;
      const sentence = endsSentence(chunks[b - 1]?.he ?? "");
      const score = Math.abs(b - ideal) + (sentence ? 0 : 3);
      if (score < bestScore) { bestScore = score; best = b; }
    }
    bounds.push(best);
  }
  bounds.push(n);
  const out: Array<[number, number]> = [];
  for (let i = 0; i + 1 < bounds.length; i++) {
    const a = bounds[i] ?? 0;
    const b = bounds[i + 1] ?? n;
    out.push([a, b - 1]);
  }
  return out;
}

/**
 * The cumulative-chaining sequence for one mishnah:
 * per segment: C1, C2, [1-2], C3, [1-3] … [1-n]; then cumulative joins of the segments
 * ([A+B], [A+B+C] …). The final step is always the whole mishnah.
 */
export function buildSteps(chunks: Chunk[]): Step[] {
  const segs = segments(chunks);
  const steps: Step[] = [];
  segs.forEach(([a, b], si) => {
    const part = segs.length > 1 ? `Part ${si + 1} · ` : "";
    for (let c = a; c <= b; c++) {
      steps.push({ kind: "learn", chunk: c, label: `${part}New piece ${c - a + 1}` });
      if (c > a) {
        steps.push({ kind: "chain", from: a, to: c, newest: c, label: `${part}Pieces 1–${c - a + 1} together` });
      }
    }
    if (a === b) {
      // A one-chunk segment still needs a chain step to count as "said cold".
      steps.push({ kind: "chain", from: a, to: b, newest: b, label: `${part}Say it by heart` });
    }
  });
  for (let si = 1; si < segs.length; si++) {
    const seg = segs[si];
    const first = segs[0];
    if (!seg || !first) continue;
    const label = si === segs.length - 1 ? "The whole mishnah!" : `Parts 1–${si + 1} together`;
    steps.push({ kind: "chain", from: first[0], to: seg[1], newest: seg[1], label });
  }
  return steps;
}

export const stepKey = (s: Step): string =>
  s.kind === "learn" ? `L${s.chunk}` : `C${s.from}-${s.to}`;

/** Which group a step belongs to: its segment index, or "join" for steps spanning segments. */
export function groupOf(s: Step, segs: Array<[number, number]>): number | "join" {
  const lo = s.kind === "learn" ? s.chunk : s.from;
  const hi = s.kind === "learn" ? s.chunk : s.to;
  const i = segs.findIndex(([a, b]) => lo >= a && hi <= b);
  return i < 0 ? "join" : i;
}

/**
 * One drawn node of the step path.
 * - tile: a "New piece n" step (n is 1-based within its part).
 * - link: a "together" step that chains items 1..through (pieces in a part, or parts in the join group).
 * - partTile: in the join group, a whole part (not a step itself; tapping goes to that part's first step).
 */
export type PathNode =
  | { type: "tile"; step: number; n: number }
  | { type: "partTile"; part: number; firstStep: number; lastStep: number }
  | { type: "link"; step: number; through: number; final: boolean };

export interface PathGroup {
  key: number | "join";
  nodes: PathNode[];
  /** Step indices in this group, ascending. */
  steps: number[];
  /** Pieces in the part, or the number of parts for the join group. */
  pieces: number;
}

/** Groups the steps into drawable parts: one per segment, then (for 2+ segments) the join group. */
export function pathGroups(steps: Step[], chunks: Chunk[]): PathGroup[] {
  const segs = segments(chunks);
  const keys = steps.map((s) => groupOf(s, segs));
  const groups: PathGroup[] = segs.map(([a, b], si) => {
    const nodes: PathNode[] = [];
    const idx: number[] = [];
    steps.forEach((s, i) => {
      if (keys[i] !== si) return;
      idx.push(i);
      if (s.kind === "learn") nodes.push({ type: "tile", step: i, n: s.chunk - a + 1 });
      else nodes.push({ type: "link", step: i, through: s.to - a + 1, final: s.to === b });
    });
    return { key: si, nodes, steps: idx, pieces: b - a + 1 };
  });
  if (segs.length > 1) {
    const nodes: PathNode[] = [];
    const idx = steps.map((_, i) => i).filter((i) => keys[i] === "join");
    segs.forEach(([, b], si) => {
      const own = groups[si]?.steps ?? [];
      nodes.push({ type: "partTile", part: si + 1, firstStep: own[0] ?? 0, lastStep: own[own.length - 1] ?? 0 });
      const join = idx.find((i) => { const s = steps[i]; return s?.kind === "chain" && s.to === b; });
      if (join !== undefined) nodes.push({ type: "link", step: join, through: si + 1, final: si === segs.length - 1 });
    });
    groups.push({ key: "join", nodes, steps: idx, pieces: segs.length });
  }
  return groups;
}

export interface StepPosition {
  /** Index into pathGroups(). */
  group: number;
  /** Piece number (or, in the join group, the last part joined), 1-based. */
  piece: number;
  of: number;
  kind: "new" | "together" | "join";
}

/** Where step i sits: e.g. "piece 3 of 6 in part 2". Null past the last step. */
export function stepPosition(groups: PathGroup[], i: number): StepPosition | null {
  for (let g = 0; g < groups.length; g++) {
    const grp = groups[g];
    if (!grp) continue;
    for (const node of grp.nodes) {
      if (node.type === "partTile" || node.step !== i) continue;
      const kind = grp.key === "join" ? "join" : node.type === "tile" ? "new" : "together";
      return { group: g, piece: node.type === "tile" ? node.n : node.through, of: grp.pieces, kind };
    }
  }
  return null;
}

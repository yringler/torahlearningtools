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

/** Chain steps that join whole segments (start + end on segment bounds) are "big stones". */
export function isBigStep(s: Step, chunks: Chunk[]): boolean {
  if (s.kind !== "chain") return false;
  return segments(chunks).some(([, b]) => b === s.to) && s.to > s.from;
}

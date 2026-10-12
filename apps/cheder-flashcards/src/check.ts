/** Pure answer-checking helpers. */

const APOSTROPHES = /['’‘`´]/g;

function basicNormalize(s: string): string {
  return s
    .toLowerCase()
    .replace(APOSTROPHES, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Normalize an answer; strips a leading "to " when that leaves something and the answer isn't "to". */
export function normalize(s: string): string {
  const n = basicNormalize(s);
  if (n !== "to" && n.startsWith("to ")) {
    const rest = n.slice(3).trim();
    if (rest.length > 0) return rest;
  }
  return n;
}

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  let prev: number[] = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur: number[] = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min((prev[j] ?? 0) + 1, (cur[j - 1] ?? 0) + 1, (prev[j - 1] ?? 0) + cost);
    }
    prev = cur;
  }
  return prev[b.length] ?? 0;
}

/** Allowed typos for an expected answer of the given length. */
export function allowedDistance(expectedLength: number): number {
  if (expectedLength >= 8) return 2;
  if (expectedLength >= 4) return 1;
  return 0;
}

function matches(candidate: string, expected: string): boolean {
  if (candidate.length === 0 || expected.length === 0) return false;
  if (candidate === expected) return true;
  return levenshtein(candidate, expected) <= allowedDistance(expected.length);
}

/** Split raw input into possible separate meanings (whole input is always included). */
function candidates(raw: string): string[] {
  const parts = raw.split(/,|;|\/|\s+or\s+|\s+and\s+/i);
  const all = [raw, ...parts].map(normalize).filter((p) => p.length > 0);
  return Array.from(new Set(all));
}

/** True if the input matches any accepted English answer. */
export function isCorrect(input: string, accepted: readonly string[]): boolean {
  const cands = candidates(input);
  if (cands.length === 0) return false;
  for (const answer of accepted) {
    const expected = normalize(answer);
    if (cands.some((c) => matches(c, expected))) return true;
  }
  return false;
}

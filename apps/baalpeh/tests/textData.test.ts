import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { CATALOG } from "../src/data";
import type { Masechta } from "../src/types";

// worker/data/text.json (the Worker's copy of the text, for the perek-test email) must match the app's data.
// Regenerate both with `npm run data`.
const read = (rel: string): unknown => JSON.parse(readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8"));
const text = read("../worker/data/text.json") as Record<string, { source: string; he: string; en: string; perakim: Record<string, string[][]> }>;

describe("worker/data/text.json", () => {
  it("has exactly the catalog's masechtos", () => {
    expect(Object.keys(text).sort()).toEqual(CATALOG.map((e) => e.id).sort());
  });

  for (const e of CATALOG) {
    it(`matches ${e.file} piece by piece`, () => {
      const t = text[e.id]!;
      expect(t.source).toBe(e.file);
      expect([t.he, t.en]).toEqual([e.he, e.en]);
      const m = read(`../public${e.file}`) as Masechta;
      const expected: Record<string, string[][]> = {};
      for (const x of m.mishnayos) (expected[String(x.perek)] ??= []).push(x.chunks.map((c) => c.he));
      expect(t.perakim).toEqual(expected);
      expect(Object.values(t.perakim).map((p) => p.length)).toEqual(e.perakim);
    });
  }
});

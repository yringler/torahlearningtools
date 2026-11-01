import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { CATALOG, fetchMasechta, hebNum, MASECHTA, mishnayosOf, PERAKIM } from "../src/data";

const publicDir = fileURLToPath(new URL("../public", import.meta.url));

describe("data catalog", () => {
  it("points every masechta at an existing file whose perek sizes match", () => {
    for (const e of CATALOG) {
      const data = JSON.parse(readFileSync(publicDir + e.file, "utf8")) as { mishnayos: { perek: number }[] };
      const counts: number[] = [];
      for (const m of data.mishnayos) counts[m.perek - 1] = (counts[m.perek - 1] ?? 0) + 1;
      expect(counts).toEqual(e.perakim);
    }
  });

  it("has no stale masechta files left in public/data/m", () => {
    const listed = new Set(CATALOG.map((e) => e.file.replace("/data/m/", "")));
    expect(readdirSync(`${publicDir}/data/m`).filter((f) => !listed.has(f))).toEqual([]);
  });

  it("loads the active masechta (via tests/setup-data.ts)", () => {
    expect(MASECHTA.mishnayos.length).toBeGreaterThan(0);
    expect(PERAKIM.reduce((n, p) => n + mishnayosOf(p).length, 0)).toBe(MASECHTA.mishnayos.length);
  });

  it("rejects a failed fetch", async () => {
    const id = CATALOG[0]?.id ?? "";
    const fail = (() => Promise.resolve(new Response("nope", { status: 404 }))) as typeof fetch;
    await expect(fetchMasechta(id, fail)).rejects.toThrow("404");
  });
});

describe("hebNum", () => {
  it("writes 1–30 as Hebrew numerals", () => {
    expect([1, 9, 10, 11, 15, 16, 20, 30].map(hebNum)).toEqual(["א׳", "ט׳", "י׳", "יא׳", "טו׳", "טז׳", "כ׳", "ל׳"]);
  });
});

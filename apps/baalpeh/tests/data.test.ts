import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  CATALOG, DEFAULT_MASECHTA_ID, entryOf, fetchMasechta, hebNum, isTranslated, MASECHTA, mishnayosOf, PERAKIM, SEDARIM,
  sederOf, shapeOf,
} from "../src/data";
import type { Masechta } from "../src/types";

const publicDir = fileURLToPath(new URL("../public", import.meta.url));
const read = (rel: string): unknown => JSON.parse(readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8"));
const built = (file: string): Masechta => JSON.parse(readFileSync(publicDir + file, "utf8")) as Masechta;

/** data/catalog.json, the pipeline's source of truth that src/data/index.json is built from. */
const source = read("../data/catalog.json") as {
  sedarim: { id: string; he: string; en: string }[];
  masechtos: { id: string; seder: string; sefaria: string; he: string; en: string; sources: string[]; glossPending?: boolean }[];
};
/** The sources a masechta ships with: none while its gloss is pending (build_data.py builds it Hebrew only). */
const shipped = (m: (typeof source.masechtos)[number]): string[] => (m.glossPending ? [] : m.sources);

describe("data catalog", () => {
  it("has unique masechta and seder ids", () => {
    const ids = CATALOG.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(SEDARIM.map((s) => s.id)).size).toBe(SEDARIM.length);
  });

  it("matches data/catalog.json: order, seder, names, Sefaria book and sources", () => {
    expect(CATALOG.map((e) => [e.id, e.seder, e.he, e.en, e.sefaria, e.translated, e.sources])).toEqual(
      source.masechtos.map((m) => [m.id, m.seder, m.he, m.en, m.sefaria, shipped(m).length > 0, shipped(m)]),
    );
    for (const m of source.masechtos) expect(m.sefaria).toMatch(/^(Mishnah_[A-Z][A-Za-z_']+|Pirkei_Avot)$/);
  });

  it("covers the whole Mishnah: six sedarim, 63 masechtos", () => {
    expect(SEDARIM.map((s) => s.id)).toEqual(["zeraim", "moed", "nashim", "nezikin", "kodashim", "tahorot"]);
    expect(CATALOG.length).toBe(63);
    expect(entryOf("avot")?.sefaria).toBe("Pirkei_Avot");
  });

  it("gives Steinsaltz excerpts only to masechtos that list Steinsaltz", () => {
    for (const e of CATALOG.filter((x) => x.translated && !x.sources.includes("steinsaltz"))) {
      for (const m of built(e.file).mishnayos) {
        expect(m.stIntro).toBeUndefined();
        for (const c of m.chunks) expect([c.st, c.stMore]).toEqual([undefined, undefined]);
      }
    }
  });

  it("puts every masechta in a seder", () => {
    for (const e of CATALOG) {
      const s = sederOf(e.id);
      expect(s?.id).toBe(e.seder);
      expect(s?.masechtos.some((m) => m.id === e.id)).toBe(true);
      expect(source.sedarim.find((x) => x.id === e.seder)).toEqual({ id: s?.id, he: s?.he, en: s?.en });
    }
    expect(sederOf("nope")).toBeUndefined();
  });

  it("keeps Berakhot as the default masechta (it defines what unqualified progress keys mean)", () => {
    expect(DEFAULT_MASECHTA_ID).toBe("berakhot");
    expect(entryOf(DEFAULT_MASECHTA_ID)?.translated).toBe(true);
  });

  it("points every masechta at an existing file whose perek sizes and names match", () => {
    for (const e of CATALOG) {
      const data = built(e.file);
      const counts: number[] = [];
      for (const m of data.mishnayos) counts[m.perek - 1] = (counts[m.perek - 1] ?? 0) + 1;
      expect(counts).toEqual(e.perakim);
      expect([data.masechta, data.masechtaEn]).toEqual([e.he, e.en]);
      expect(shapeOf(e.id)).toEqual({ id: e.id, perakim: e.perakim });
    }
  });

  it("has Sefaria's perek and mishnah counts for Peah and Demai", () => {
    expect(entryOf("peah")?.perakim).toEqual([6, 8, 8, 11, 8, 11, 8, 9]);
    expect(entryOf("demai")?.perakim).toEqual([4, 5, 6, 7, 11, 12, 8]);
    expect(entryOf("peah")?.perakim.reduce((a, b) => a + b)).toBe(69);
    expect(entryOf("demai")?.perakim.reduce((a, b) => a + b)).toBe(53);
    expect(() => shapeOf("nope")).toThrow("Unknown masechta");
  });

  it("gives translated masechtos a meaning for every piece and word", () => {
    for (const e of CATALOG.filter((x) => x.translated)) {
      expect(isTranslated(e.id)).toBe(true);
      const empty: string[] = [];
      for (const m of built(e.file).mishnayos) {
        if (!m.summary) empty.push(`${e.id} ${m.perek}:${m.mishnah} summary`);
        m.chunks.forEach((c, j) => {
          if (!c.en) empty.push(`${e.id} ${m.perek}:${m.mishnah} piece ${j + 1}`);
          for (const w of c.words) if (!w.en) empty.push(`${e.id} ${m.perek}:${m.mishnah} piece ${j + 1} ${w.he}`);
        });
      }
      expect(empty).toEqual([]);
    }
  });

  it("ships Hebrew-only masechtos with empty meanings and no Steinsaltz", () => {
    const untranslated = CATALOG.filter((x) => !x.translated);
    expect(untranslated.map((e) => e.id)).toEqual(expect.arrayContaining(["peah", "demai"]));
    for (const e of untranslated) {
      expect(isTranslated(e.id)).toBe(false);
      for (const m of built(e.file).mishnayos) {
        expect(m.summary).toBe("");
        expect(m.stIntro).toBeUndefined();
        for (const c of m.chunks) {
          expect(Object.keys(c).sort()).toEqual(["en", "he", "words"]);
          expect(c.en).toBe("");
          expect(c.words.map((w) => w.he)).toEqual(c.he.split(" "));
          for (const w of c.words) expect(w).toEqual({ he: w.he, en: "" });
        }
      }
    }
  });

  it("has no stale masechta files left in public/data/m", () => {
    const listed = new Set(CATALOG.map((e) => e.file.replace("/data/m/", "")));
    expect(readdirSync(`${publicDir}/data/m`).filter((f) => !listed.has(f))).toEqual([]);
  });

  it("loads the active masechta (via tests/setup-data.ts)", () => {
    expect(MASECHTA.masechtaEn).toBe("Berakhot");
    expect(MASECHTA.mishnayos.length).toBeGreaterThan(0);
    expect(PERAKIM.reduce((n, p) => n + mishnayosOf(p).length, 0)).toBe(MASECHTA.mishnayos.length);
  });

  it("rejects a failed fetch", async () => {
    const fail = (() => Promise.resolve(new Response("nope", { status: 404 }))) as typeof fetch;
    await expect(fetchMasechta(DEFAULT_MASECHTA_ID, fail)).rejects.toThrow("404");
  });
});

describe("hebNum", () => {
  it("writes 1–30 as Hebrew numerals", () => {
    expect([1, 9, 10, 11, 15, 16, 20, 30].map(hebNum)).toEqual(["א׳", "ט׳", "י׳", "יא׳", "טו׳", "טז׳", "כ׳", "ל׳"]);
  });
});

describe("hidden content (data/<id>/hide.json)", () => {
  // Words that should never reach a child's screen; see README "Hidden content".
  const BLOCKED = /semen|seminal|consummat|conjugal|intercourse|menstrua|feces/i;

  it("keeps explicit wording out of the built masechta files", () => {
    for (const e of CATALOG) {
      const hits: string[] = [];
      for (const m of built(e.file).mishnayos) {
        const texts = [m.summary, m.stIntro ?? "", ...m.chunks.map((c) => JSON.stringify(c))];
        if (texts.some((t) => BLOCKED.test(t))) hits.push(`${e.id} ${m.perek}:${m.mishnah}`);
      }
      expect(hits).toEqual([]);
    }
  });
});

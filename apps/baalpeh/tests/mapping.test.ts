import { describe, expect, it } from "vitest";
import type { PerekProgressData } from "../shared/api";
import { blankProfileFromRow, cleanPerek, diffProfiles, metaOf, profileToRows, settingsOf } from "../src/sync/mapping";
import { kid } from "./helpers";

const NOW = 1_700_000_000_000;

describe("diffProfiles", () => {
  it("emits nothing for identical input", () => {
    const a = kid("A", { mishnayos: { "1:1": { stepIndex: 2, state: "learning", fails: {} } }, days: ["2026-01-01"] });
    expect(diffProfiles([a], [structuredClone(a)], NOW)).toEqual({ children: [], records: [] });
  });

  it("a meta change produces one ChildRow", () => {
    const a = kid("A");
    const d = diffProfiles([a], [{ ...a, name: "Avi" }], NOW);
    expect(d.records).toEqual([]);
    expect(d.children).toHaveLength(1);
    expect(d.children[0]).toMatchObject({ id: a.id, deleted: false, updatedAt: NOW, meta: { name: "Avi", sort: 0 } });
  });

  it("a settings change produces one ChildRow", () => {
    const a = kid("A");
    const d = diffProfiles([a], [{ ...a, settings: { ...a.settings, meaningView: "steinsaltz" } }], NOW);
    expect(d.children).toHaveLength(1);
    expect(d.children[0]?.meta.settings.meaningView).toBe("steinsaltz");
  });

  it("a mishnah change produces one m record", () => {
    const a = kid("A", { mishnayos: { "1:1": { stepIndex: 0, state: "new", fails: {} } } });
    const b = { ...a, mishnayos: { ...a.mishnayos, "1:1": { stepIndex: 1, state: "learning" as const, fails: {} } } };
    const d = diffProfiles([a], [b], NOW);
    expect(d.children).toEqual([]);
    expect(d.records).toEqual([{ kind: "m", childId: a.id, key: "1:1", updatedAt: NOW, data: { stepIndex: 1, state: "learning", fails: {} } }]);
  });

  it("a perek change produces one p record", () => {
    const a = kid("A");
    const d = diffProfiles([a], [{ ...a, perakim: { "2": { chainedThrough: 2, complete: false } } }], NOW);
    expect(d.records).toEqual([{ kind: "p", childId: a.id, key: "2", updatedAt: NOW, data: { chainedThrough: 2, complete: false } }]);
  });

  it("a new day produces one d record", () => {
    const a = kid("A", { days: ["2026-01-01"] });
    const d = diffProfiles([a], [{ ...a, days: ["2026-01-01", "2026-01-02"] }], NOW);
    expect(d.records).toEqual([{ kind: "d", childId: a.id, key: "2026-01-02", data: {}, updatedAt: NOW }]);
  });

  it("removed map keys and removed days produce nothing", () => {
    const a = kid("A", { days: ["2026-01-01"], mishnayos: { "1:1": { stepIndex: 1, state: "learning", fails: {} } } });
    expect(diffProfiles([a], [{ ...a, days: [], mishnayos: {} }], NOW)).toEqual({ children: [], records: [] });
  });

  it("a removed child produces a tombstone with its last meta", () => {
    const a = kid("A");
    const b = kid("B");
    const d = diffProfiles([a, b], [a], NOW);
    expect(d.children).toEqual([{ id: b.id, updatedAt: NOW, deleted: true, meta: metaOf(b, 1) }]);
  });

  it("removing a child sends only its tombstone: later siblings keep their rows (and sort gaps are fine)", () => {
    const a = kid("A");
    const b = kid("B");
    const c = kid("C");
    const d = diffProfiles([a, b, c], [b, c], NOW);
    expect(d.children).toEqual([{ id: a.id, updatedAt: NOW, deleted: true, meta: metaOf(a, 0) }]);
    expect(d.records).toEqual([]);
    const e = diffProfiles([a, b, c], [b, { ...c, name: "Chana" }], NOW);
    expect(e.children.map((x) => [x.id, x.deleted, x.meta.name])).toEqual([[c.id, false, "Chana"], [a.id, true, "A"]]);
  });

  it("adding a child sends only the new child", () => {
    const a = kid("A");
    const b = kid("B");
    expect(diffProfiles([a], [b, a], NOW).children.map((x) => x.id)).toEqual([b.id]);
  });

  it("a reorder produces sort changes", () => {
    const a = kid("A");
    const b = kid("B");
    const d = diffProfiles([a, b], [b, a], NOW);
    expect(d.children.map((c) => [c.id, c.meta.sort])).toEqual([[b.id, 0], [a.id, 1]]);
  });

  it("a new child produces a ChildRow and all of its records", () => {
    const a = kid("A", { mishnayos: { "1:1": { stepIndex: 1, state: "learning", fails: {} } }, days: ["2026-01-01"] });
    const d = diffProfiles([], [a], NOW);
    expect(d.children).toHaveLength(1);
    expect(d.records.map((r) => r.kind).sort()).toEqual(["d", "m"]);
  });
});

describe("profileToRows", () => {
  it("emits every key", () => {
    const a = kid("A", {
      mishnayos: { "1:1": { stepIndex: 1, state: "learning", fails: { "0": 1 } }, "1:2": { stepIndex: 9, state: "known", fails: {}, review: { box: 1, due: "2026-02-01", passes: 1 } } },
      perakim: { "1": { chainedThrough: 2, complete: false } },
      days: ["2026-01-01", "2026-01-03"],
    });
    const { child, records } = profileToRows(a, 3, NOW);
    expect(child).toMatchObject({ id: a.id, deleted: false, meta: { sort: 3, name: "A" } });
    expect(records.map((r) => `${r.kind}|${r.key}`).sort()).toEqual(["d|2026-01-01", "d|2026-01-03", "m|1:1", "m|1:2", "p|1"]);
    expect(records.every((r) => r.updatedAt === NOW && r.childId === a.id)).toBe(true);
  });
});

describe("metaOf", () => {
  it("keeps values inside the server's limits", () => {
    const a = kid("  ", { settings: { fontScale: 9, breakMinutes: 7.6 } });
    expect(metaOf(a, 0)).toMatchObject({ name: "Child", settings: { fontScale: 3, breakMinutes: 8 } });
  });

  it("sends no break setting when breaks are off", () => {
    expect(metaOf(kid("A"), 0).settings).toEqual({ fontScale: 1 });
  });
});

describe("blankProfileFromRow", () => {
  it("creates an empty profile", () => {
    const a = kid("A");
    const p = blankProfileFromRow({ id: a.id, updatedAt: NOW, deleted: false, meta: metaOf(a, 0) });
    expect(p).toEqual({ ...a, mishnayos: {}, perakim: {}, days: [] });
  });
});

describe("cleanPerek", () => {
  it("keeps valid chains", () => {
    expect(cleanPerek({ chainedThrough: 4, complete: false, chains: ["1-4", "5-6"] })).toEqual({ chainedThrough: 4, complete: false, chains: ["1-4", "5-6"] });
  });

  it("drops malformed entries, from > to, duplicates and entries past 64, and sorts", () => {
    const raw = { chainedThrough: 0, complete: false, chains: ["5-6", "3-1", "x", 7, "1-2", "5-6", null, "0-3"] } as unknown as PerekProgressData;
    expect(cleanPerek(raw).chains).toEqual(["1-2", "5-6"]);
    const many = Array.from({ length: 80 }, (_, i) => `${i + 1}-${i + 1}`);
    const out = cleanPerek({ chainedThrough: 0, complete: false, chains: many }).chains ?? [];
    expect(out).toHaveLength(64);
    expect(out[0]).toBe("1-1");
    expect(cleanPerek({ chainedThrough: 0, complete: false, chains: ["x"] })).toEqual({ chainedThrough: 0, complete: false, chains: [] });
  });

  it("adds no chains key to old-shape data", () => {
    expect(cleanPerek({ chainedThrough: 2, complete: true })).toEqual({ chainedThrough: 2, complete: true });
    expect("chains" in cleanPerek({ chainedThrough: 2, complete: false, chains: "1-2" } as unknown as PerekProgressData)).toBe(false);
  });

  it("a change to chains alone produces one p record carrying them", () => {
    const a = kid("A", { perakim: { "2": { chainedThrough: 0, complete: false } } });
    const d = diffProfiles([a], [{ ...a, perakim: { "2": { chainedThrough: 0, complete: false, chains: ["5-6"] } } }], NOW);
    expect(d.records).toEqual([{ kind: "p", childId: a.id, key: "2", updatedAt: NOW, data: { chainedThrough: 0, complete: false, chains: ["5-6"] } }]);
  });
});

describe("multi-masechta keys", () => {
  const m = { stepIndex: 1, state: "learning" as const, fails: {} };
  const pk = { chainedThrough: 1, complete: false };

  it("emits qualified keys for Peah next to Berakhot's unqualified ones", () => {
    const a = kid("A");
    const b = { ...a, mishnayos: { "1:2": m, "peah/1:2": m }, perakim: { "1": pk, "peah/1": pk } };
    const keys = diffProfiles([a], [b], NOW).records.map((r) => `${r.kind}|${r.key}`).sort();
    expect(keys).toEqual(["m|1:2", "m|peah/1:2", "p|1", "p|peah/1"]);
  });

  it("never emits non-canonical or garbage keys", () => {
    const a = kid("A", {
      mishnayos: { "berakhot/1:2": m, "Peah/1:2": m, "peah/1:2:3": m, "../1:2": m, "1234:1": m, "peah/1:2": m },
      perakim: { "berakhot/1": pk, "peah/": pk, "peah/1:2": pk, "demai/3": pk },
    });
    const keys = profileToRows(a, 0, NOW).records.map((r) => `${r.kind}|${r.key}`).sort();
    expect(keys).toEqual(["m|peah/1:2", "p|demai/3"]);
  });

  it("keeps a valid lastMasechta and drops an invalid one", () => {
    expect(metaOf(kid("A", { settings: { fontScale: 1, lastMasechta: "peah" } }), 0).settings).toEqual({ fontScale: 1, lastMasechta: "peah" });
    expect(metaOf(kid("A", { settings: { fontScale: 1, lastMasechta: "Peah!" } }), 0).settings).toEqual({ fontScale: 1 });
    expect(settingsOf({ fontScale: 1, lastMasechta: "demai" })).toEqual({ fontScale: 1, lastMasechta: "demai" });
    expect(settingsOf({ fontScale: 1, lastMasechta: "../x" })).toEqual({ fontScale: 1 });
  });

  it("keeps a valid libraryPlace and drops an invalid one", () => {
    expect(metaOf(kid("A", { settings: { fontScale: 1, libraryPlace: "peah/2/3" } }), 0).settings).toEqual({ fontScale: 1, libraryPlace: "peah/2/3" });
    expect(metaOf(kid("A", { settings: { fontScale: 1, libraryPlace: "peah/2" } }), 0).settings).toEqual({ fontScale: 1 });
    expect(settingsOf({ fontScale: 1, libraryPlace: "demai/1/1" })).toEqual({ fontScale: 1, libraryPlace: "demai/1/1" });
    expect(settingsOf({ fontScale: 1, libraryPlace: "../x/1/1" })).toEqual({ fontScale: 1 });
  });

  it("a lastMasechta change produces one ChildRow", () => {
    const a = kid("A");
    const d = diffProfiles([a], [{ ...a, settings: { ...a.settings, lastMasechta: "peah" } }], NOW);
    expect(d.records).toEqual([]);
    expect(d.children.map((c) => c.meta.settings.lastMasechta)).toEqual(["peah"]);
  });
});

import { describe, expect, it } from "vitest";
import { blankProfileFromRow, diffProfiles, metaOf, profileToRows } from "../src/sync/mapping";
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
    const a = kid("  ", { settings: { fontScale: 9, tts: false, dailyMinutes: 7.6 } });
    expect(metaOf(a, 0)).toMatchObject({ name: "Child", settings: { fontScale: 3, dailyMinutes: 8 } });
  });
});

describe("blankProfileFromRow", () => {
  it("creates an empty profile", () => {
    const a = kid("A");
    const p = blankProfileFromRow({ id: a.id, updatedAt: NOW, deleted: false, meta: metaOf(a, 0) });
    expect(p).toEqual({ ...a, mishnayos: {}, perakim: {}, days: [] });
  });
});

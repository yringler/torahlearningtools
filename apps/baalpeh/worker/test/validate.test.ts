import { describe, expect, it } from "vitest";
import { childMeta, validateSync } from "../lib/validate";

const base = { name: "Avi", color: "#336699", emoji: "🐮", sort: 0 };

describe("child settings", () => {
  it("has no break setting unless one is sent", () => {
    expect(childMeta({ ...base, settings: { fontScale: 1 } }, "meta").settings).toEqual({ fontScale: 1 });
  });

  it("drops the retired dailyMinutes that older clients send", () => {
    expect(childMeta({ ...base, settings: { fontScale: 1, dailyMinutes: 15 } }, "meta").settings).toEqual({ fontScale: 1 });
  });

  it("keeps breakMinutes in range", () => {
    expect(childMeta({ ...base, settings: { fontScale: 1, breakMinutes: 20 } }, "meta").settings).toEqual({ fontScale: 1, breakMinutes: 20 });
    expect(() => childMeta({ ...base, settings: { fontScale: 1, breakMinutes: 0 } }, "meta")).toThrow();
  });
});

describe("recite events", () => {
  const sync = (task: string) => validateSync({
    cursor: 0, children: [], records: [],
    events: [{ id: crypto.randomUUID(), childId: crypto.randomUUID(), at: Date.now(), day: "2026-11-03", type: "recite", task, perek: 2, mishnah: 1, step: 3, grade: "help", peeks: 1, ms: 4000 }],
  });

  it("accepts practice of a known mishnah", () => {
    const r = sync("practice");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.events[0]).toMatchObject({ type: "recite", task: "practice", step: 3 });
  });

  it("still rejects an unknown task", () => {
    expect(sync("cramming").ok).toBe(false);
  });
});

describe("perek records", () => {
  const p = (data: unknown) => validateSync({
    cursor: 0, children: [], events: [],
    records: [{ kind: "p", childId: crypto.randomUUID(), key: "2", updatedAt: Date.now(), data }],
  });

  it("accepts chains", () => {
    const r = p({ chainedThrough: 4, complete: false, chains: ["1-4", "5-6"] });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.records[0]?.data).toEqual({ chainedThrough: 4, complete: false, chains: ["1-4", "5-6"] });
  });

  it("rejects a non-array, a bad string, from > to and more than 64 entries", () => {
    expect(p({ chainedThrough: 0, complete: false, chains: "1-2" }).ok).toBe(false);
    expect(p({ chainedThrough: 0, complete: false, chains: ["1-x"] }).ok).toBe(false);
    expect(p({ chainedThrough: 0, complete: false, chains: [3] }).ok).toBe(false);
    expect(p({ chainedThrough: 0, complete: false, chains: ["0-2"] }).ok).toBe(false);
    expect(p({ chainedThrough: 0, complete: false, chains: ["3-1"] }).ok).toBe(false);
    expect(p({ chainedThrough: 0, complete: false, chains: Array.from({ length: 65 }, (_, i) => `${i + 1}-${i + 1}`) }).ok).toBe(false);
    expect(p({ chainedThrough: 0, complete: false, chains: Array.from({ length: 64 }, (_, i) => `${i + 1}-${i + 1}`) }).ok).toBe(true);
  });

  it("leaves an absent chains key absent", () => {
    const r = p({ chainedThrough: 2, complete: false });
    expect(r.ok).toBe(true);
    if (r.ok) expect("chains" in (r.value.records[0]?.data ?? {})).toBe(false);
  });
});

describe("perek-level recite ranges", () => {
  const ev = (extra: Record<string, unknown>) => validateSync({
    cursor: 0, children: [], records: [],
    events: [{ id: crypto.randomUUID(), childId: crypto.randomUUID(), at: Date.now(), day: "2026-11-03", type: "recite", task: "perek-chain", perek: 2, mishnah: null, step: 9, grade: "pass", peeks: 0, ms: 4000, ...extra }],
  });

  it("accepts from/to, rejects from > to, and still accepts an event without them", () => {
    const r = ev({ from: 5, to: 7 });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.events[0]).toMatchObject({ task: "perek-chain", from: 5, to: 7 });
    expect(ev({ from: 7, to: 5 }).ok).toBe(false);
    expect(ev({ from: 0, to: 5 }).ok).toBe(false);
    const old = ev({});
    expect(old.ok).toBe(true);
    if (old.ok) expect("from" in (old.value.events[0] ?? {})).toBe(false);
  });
});

describe("multi-masechta keys and ids", () => {
  const rec = (kind: "m" | "p", key: string) => {
    const data = kind === "m" ? { stepIndex: 1, state: "learning", fails: {} } : { chainedThrough: 1, complete: false };
    return validateSync({ cursor: 0, children: [], events: [], records: [{ kind, childId: crypto.randomUUID(), key, updatedAt: Date.now(), data }] });
  };

  it("accepts Berakhot's unqualified keys and other masechtos' qualified keys", () => {
    for (const k of ["1:2", "peah/1:2", "demai/7:8", "bava_kamma/10:3"]) expect(rec("m", k).ok, k).toBe(true);
    for (const k of ["1", "peah/1", "demai/7"]) expect(rec("p", k).ok, k).toBe(true);
  });

  it("rejects berakhot/ keys and bad shapes", () => {
    for (const k of ["berakhot/1:2", "Peah/1:2", "peah/", "peah/1:2:3", "../1:2", "1234:1", "peah/1:1000", "peah/1", "x"]) expect(rec("m", k).ok, k).toBe(false);
    for (const k of ["berakhot/1", "Peah/1", "peah/", "peah/1:2", "../1", "1000"]) expect(rec("p", k).ok, k).toBe(false);
  });

  it("keeps a valid lastMasechta and rejects an invalid one", () => {
    expect(childMeta({ ...base, settings: { fontScale: 1, lastMasechta: "peah" } }, "meta").settings).toEqual({ fontScale: 1, lastMasechta: "peah" });
    for (const v of ["Peah", "p", "../x", 3, null, "a".repeat(33)]) {
      expect(() => childMeta({ ...base, settings: { fontScale: 1, lastMasechta: v } }, "meta"), String(v)).toThrow();
    }
  });

  it("keeps a valid libraryPlace and rejects an invalid one", () => {
    expect(childMeta({ ...base, settings: { fontScale: 1, libraryPlace: "peah/2/3" } }, "meta").settings).toEqual({ fontScale: 1, libraryPlace: "peah/2/3" });
    for (const v of ["peah/0/1", "peah/2", "../x/1/1", "Peah/1/1", "peah/1/1/1", "peah/01/1", 3, null]) {
      expect(() => childMeta({ ...base, settings: { fontScale: 1, libraryPlace: v } }, "meta"), String(v)).toThrow();
    }
  });

  it("validates and carries event.masechta on every event type; absent stays absent", () => {
    const env = { id: crypto.randomUUID(), childId: crypto.randomUUID(), at: Date.now(), day: "2026-11-03" };
    const bodies = [
      { type: "recite", task: "learn", perek: 1, mishnah: 1, step: 0, grade: "pass", peeks: 0, ms: 1000 },
      { type: "check", scope: "mishnah", perek: 1, mishnah: 1, through: null, grade: "pass", slipped: [], slipWords: 0 },
      { type: "session", startedAt: Date.now() - 1000, ms: 1000, steps: 1 },
      { type: "reset", perek: 1, mishnah: 1 },
    ];
    for (const b of bodies) {
      const withM = validateSync({ cursor: 0, children: [], records: [], events: [{ ...env, ...b, masechta: "peah" }] });
      expect(withM.ok, b.type).toBe(true);
      if (withM.ok) expect(withM.value.events[0]?.masechta).toBe("peah");
      const without = validateSync({ cursor: 0, children: [], records: [], events: [{ ...env, ...b }] });
      expect(without.ok).toBe(true);
      if (without.ok) expect("masechta" in (without.value.events[0] ?? {})).toBe(false);
      for (const bad of ["Peah", "../x", 1, null]) {
        expect(validateSync({ cursor: 0, children: [], records: [], events: [{ ...env, ...b, masechta: bad }] }).ok, `${b.type} ${String(bad)}`).toBe(false);
      }
    }
  });
});

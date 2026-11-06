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

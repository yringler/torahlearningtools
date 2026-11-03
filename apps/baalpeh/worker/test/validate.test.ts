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

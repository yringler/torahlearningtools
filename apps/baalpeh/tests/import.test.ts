import { describe, expect, it } from "vitest";
import { importDefaults, importLegacy, normalizeProfile } from "../src/legacy/import";
import type { Profile } from "../src/types";
import { kid, store } from "./helpers";

describe("importLegacy", () => {
  it("gives v1 profiles new UUIDs, queues all their rows and records the decision", () => {
    const old = kid("Dina", {
      mishnayos: { "1:1": { stepIndex: 9, state: "known", fails: {}, review: { box: 0, due: "2026-01-02", passes: 0 } } },
      perakim: { "1": { chainedThrough: 0, complete: false } },
      days: ["2026-01-01"],
    });
    const existing = kid("Avi");
    let i = 0;
    const s = importLegacy(store([existing]), [old], 1000, () => `uuid-${++i}-xxxx`);
    expect(s.importDecision).toBe("imported");
    expect(s.profiles.map((p) => p.id)).toEqual([existing.id, "uuid-1-xxxx"]);
    expect(s.profiles[1]).toEqual({ ...old, id: "uuid-1-xxxx" });
    expect(s.pending.children["uuid-1-xxxx"]).toMatchObject({ deleted: false, updatedAt: 1000, meta: { name: "Dina", sort: 1 } });
    expect(Object.keys(s.pending.records).sort()).toEqual(["uuid-1-xxxx|d|2026-01-01", "uuid-1-xxxx|m|1:1", "uuid-1-xxxx|p|1"]);
    expect(Object.values(s.pending.records).every((r) => r.updatedAt === 1000)).toBe(true);
  });
});

describe("importDefaults", () => {
  it("pre-unchecks a profile whose name is already in the account", () => {
    const a = kid("Dina");
    const b = kid("Avi");
    expect(importDefaults([a, b], [kid(" dina ")])).toEqual({ [a.id]: false, [b.id]: true });
  });
});

describe("normalizeProfile", () => {
  it("fills missing fields of an old backup", () => {
    const p = normalizeProfile({ id: "x1234567", name: "Z" } as unknown as Profile, 0);
    expect(p).toMatchObject({ mishnayos: {}, perakim: {}, days: [], settings: { fontScale: 1, tts: false, dailyMinutes: 15 } });
  });

  it("drops progress entries that are not objects", () => {
    const m = { stepIndex: 1, state: "learning", fails: {} };
    const p = normalizeProfile({ id: "x1234567", name: "Z", mishnayos: { "1:1": null, "1:2": 5, "1:3": m }, perakim: { "1": null } } as unknown as Profile, 0);
    expect(p.mishnayos).toEqual({ "1:3": m });
    expect(p.perakim).toEqual({});
  });
});

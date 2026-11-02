import { describe, expect, it } from "vitest";
import type { ChildRow, LearningEvent, RecordRow, SyncResponse } from "../shared/api";
import { metaOf } from "../src/sync/mapping";
import {
  applyLocalEdit, applyServerResponse, enqueueEvent, loadCurrentUser, loadStore, MAX_PENDING_EVENTS, pendingCount, saveStore,
  setCurrentUser, storeKey, type KV, type SentBatch,
} from "../src/sync/store";
import type { Profile } from "../src/types";
import { kid, store, USER } from "./helpers";

const T0 = 1_700_000_000_000;
const learning = (stepIndex: number) => ({ stepIndex, state: "learning" as const, fails: {} });
const withM = (p: Profile, key: string, stepIndex: number): Profile => ({ ...p, mishnayos: { ...p.mishnayos, [key]: learning(stepIndex) } });
const resp = (r: Partial<SyncResponse>): SyncResponse => ({ cursor: 1, children: [], records: [], serverTime: T0, ...r });
const sentOf = (s: ReturnType<typeof store>): SentBatch => ({
  children: Object.values(s.pending.children), records: Object.values(s.pending.records), events: s.pending.events,
});
const mem = (): KV & { m: Map<string, string> } => {
  const m = new Map<string, string>();
  return { m, getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v), removeItem: (k) => void m.delete(k) };
};
const ev = (id: string, childId: string): LearningEvent => ({ id, childId, at: T0, day: "2026-01-01", type: "reset", perek: 1, mishnah: 1 });

describe("applyLocalEdit", () => {
  it("coalesces two edits of the same key into one pending row (the latest)", () => {
    const a = kid("A");
    let s = applyLocalEdit(store(), [a], T0);
    s = applyLocalEdit(s, [withM(a, "1:1", 1)], T0 + 1);
    s = applyLocalEdit(s, [withM(a, "1:1", 2)], T0 + 2);
    const recs = Object.values(s.pending.records);
    expect(recs).toHaveLength(1);
    expect(recs[0]).toMatchObject({ key: "1:1", updatedAt: T0 + 2, data: { stepIndex: 2 } });
    expect(Object.keys(s.pending.children)).toEqual([a.id]);
    expect(s.profiles[0]?.mishnayos["1:1"]?.stepIndex).toBe(2);
  });

  it("gives a re-edit in the same millisecond a newer updatedAt", () => {
    const a = kid("A");
    let s = applyLocalEdit(store([a]), [withM(a, "1:1", 1)], T0);
    s = applyLocalEdit(s, [withM(a, "1:1", 2)], T0);
    expect(Object.values(s.pending.records)[0]?.updatedAt).toBe(T0 + 1);
  });
});

describe("applyServerResponse", () => {
  it("clears only sent-and-unchanged rows and keeps an edit made after the send", () => {
    const a = kid("A");
    let s = applyLocalEdit(store([a]), [withM(withM(a, "1:1", 1), "1:2", 1)], T0);
    const sent = sentOf(s);
    s = applyLocalEdit(s, [withM(s.profiles[0] as Profile, "1:2", 5)], T0 + 10); // during the request
    s = applyServerResponse(s, sent, resp({ cursor: 7 }), T0 + 20);
    expect(Object.keys(s.pending.records)).toEqual([`${a.id}|m|1:2`]);
    expect(s.pending.records[`${a.id}|m|1:2`]?.updatedAt).toBe(T0 + 10);
    expect(s.cursor).toBe(7);
    expect(s.lastSyncAt).toBe(T0 + 20);
  });

  it("never overwrites a key that is still pending", () => {
    const a = kid("A");
    let s = applyLocalEdit(store([a]), [withM(a, "1:1", 3)], T0);
    const server: RecordRow = { kind: "m", childId: a.id, key: "1:1", updatedAt: T0 - 5, data: learning(1) };
    s = applyServerResponse(s, { children: [], records: [], events: [] }, resp({ records: [server] }), T0);
    expect(s.profiles[0]?.mishnayos["1:1"]?.stepIndex).toBe(3);
    expect(pendingCount(s)).toBe(1);
  });

  it("applies the server's version of a pushed key that lost last-write-wins", () => {
    const a = kid("A");
    let s = applyLocalEdit(store([a]), [withM(a, "1:1", 1)], T0);
    const sent = sentOf(s);
    const server: RecordRow = { kind: "m", childId: a.id, key: "1:1", updatedAt: T0 + 99, data: learning(8) };
    s = applyServerResponse(s, sent, resp({ records: [server] }), T0);
    expect(s.profiles[0]?.mishnayos["1:1"]?.stepIndex).toBe(8);
    expect(pendingCount(s)).toBe(0);
  });

  it("removes profiles for tombstones and creates profiles for new children (ordered by sort)", () => {
    const a = kid("A");
    const b = kid("B");
    const c = kid("C");
    const s0 = store([a, b]);
    const rows: ChildRow[] = [
      { id: a.id, updatedAt: T0, deleted: true, meta: metaOf(a, 0) },
      { id: c.id, updatedAt: T0, deleted: false, meta: metaOf(c, 0) },
      { id: b.id, updatedAt: T0, deleted: false, meta: metaOf({ ...b, name: "Bea" }, 1) },
    ];
    const s = applyServerResponse(s0, { children: [], records: [], events: [] }, resp({ children: rows }), T0);
    expect(s.profiles.map((p) => p.name)).toEqual(["C", "Bea"]);
    expect(s.profiles[0]).toMatchObject({ id: c.id, mishnayos: {}, perakim: {}, days: [] });
  });

  it("merges days (union, sorted, at most 60)", () => {
    const days = Array.from({ length: 59 }, (_, i) => `2025-0${1 + Math.floor(i / 28)}-${String((i % 28) + 1).padStart(2, "0")}`);
    const a = kid("A", { days });
    const recs: RecordRow[] = ["2026-01-02", "2026-01-01", days[0] as string].map((d) => ({ kind: "d", childId: a.id, key: d, data: {}, updatedAt: T0 }));
    const s = applyServerResponse(store([a]), { children: [], records: [], events: [] }, resp({ records: recs }), T0);
    const out = s.profiles[0]?.days ?? [];
    expect(out).toHaveLength(60);
    expect(out.slice(-2)).toEqual(["2026-01-01", "2026-01-02"]);
    expect([...out].sort()).toEqual(out);
  });

  it("skips records of missing profiles and never adds pending rows", () => {
    const a = kid("A");
    const rows: ChildRow[] = [{ id: "new-child-1", updatedAt: T0, deleted: false, meta: metaOf(kid("N"), 1) }];
    const recs: RecordRow[] = [
      { kind: "m", childId: "ghost-child", key: "1:1", updatedAt: T0, data: learning(1) },
      { kind: "p", childId: a.id, key: "1", updatedAt: T0, data: { chainedThrough: 2, complete: false } },
    ];
    const s = applyServerResponse(store([a]), { children: [], records: [], events: [] }, resp({ children: rows, records: recs }), T0);
    expect(pendingCount(s)).toBe(0);
    expect(s.profiles.map((p) => p.id)).toEqual([a.id, "new-child-1"]);
    expect(s.profiles[0]?.perakim["1"]?.chainedThrough).toBe(2);
  });

  it("removes sent events by id", () => {
    let s = enqueueEvent(store(), ev("e1aaaaaa", "c"));
    const sent = sentOf(s);
    s = enqueueEvent(s, ev("e2aaaaaa", "c"));
    s = applyServerResponse(s, sent, resp({}), T0);
    expect(s.pending.events.map((e) => e.id)).toEqual(["e2aaaaaa"]);
  });
});

describe("events", () => {
  it("caps pending events, dropping the oldest", () => {
    let s = store();
    for (let i = 0; i < MAX_PENDING_EVENTS + 3; i++) s = enqueueEvent(s, ev(`ev-${i}-xxxxx`, "c"));
    expect(s.pending.events).toHaveLength(MAX_PENDING_EVENTS);
    expect(s.pending.events[0]?.id).toBe("ev-3-xxxxx");
  });
});

describe("persistence", () => {
  it("round-trips the store and the current user, and recovers from corrupt data", () => {
    const kv = mem();
    const s = applyLocalEdit(store(), [kid("A")], T0);
    saveStore(kv, s);
    expect(loadStore(kv, USER)).toEqual(s);
    kv.setItem(storeKey(USER.id), "{not json");
    expect(loadStore(kv, USER).profiles).toEqual([]);
    setCurrentUser(kv, USER);
    expect(loadCurrentUser(kv)).toEqual(USER);
    setCurrentUser(kv, null);
    expect(loadCurrentUser(kv)).toBeNull();
  });
});

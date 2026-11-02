import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RecordRow, SyncRequest, SyncResponse } from "../shared/api";
import { ApiFailure, NetworkFailure } from "../src/api/client";
import { BACKOFF_MS, SyncEngine, type SyncStatus } from "../src/sync/engine";
import { addPending, pendingCount, type AccountStore } from "../src/sync/store";
import { kid, store } from "./helpers";

const T0 = 1_700_000_000_000;

function withRows(n: number): AccountStore {
  const a = kid("A");
  const records: RecordRow[] = Array.from({ length: n }, (_, i) => ({
    kind: "m", childId: a.id, key: `${1 + Math.floor(i / 100)}:${i % 100}`, updatedAt: T0, data: { stepIndex: 1, state: "learning", fails: {} },
  }));
  return addPending(store([a]), { children: [], records });
}

function setup(initial: AccountStore, sync: (b: SyncRequest) => Promise<SyncResponse>) {
  let s = initial;
  const statuses: SyncStatus[] = [];
  const calls: SyncRequest[] = [];
  const engine = new SyncEngine({
    api: { sync: (b) => { calls.push(b); return sync(b); } },
    get: () => s,
    set: (n) => { s = n; },
    onStatus: (st) => statuses.push(st),
    now: () => T0,
  });
  return { engine, statuses, calls, get: () => s };
}

const ok = (cursor = 1) => async (): Promise<SyncResponse> => ({ cursor, children: [], records: [], serverTime: T0 });

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe("SyncEngine", () => {
  it("sends 1,200 pending rows in 3 requests", async () => {
    const t = setup(withRows(1200), ok(5));
    await t.engine.syncNow();
    expect(t.calls.map((c) => c.records.length + c.children.length)).toEqual([500, 500, 200]);
    expect(pendingCount(t.get())).toBe(0);
    expect(t.get().cursor).toBe(5);
    expect(t.statuses.at(-1)?.state).toBe("idle");
  });

  it("a 401 sets signedOut and keeps pending rows", async () => {
    const t = setup(withRows(3), () => Promise.reject(new ApiFailure(401, { error: "unauthorized", message: "no" })));
    await t.engine.syncNow();
    expect(t.statuses.at(-1)?.state).toBe("signedOut");
    expect(pendingCount(t.get())).toBe(3);
    t.engine.kick(0);
    await vi.runAllTimersAsync();
    expect(t.calls).toHaveLength(1);
  });

  it("a NetworkFailure sets offline and retries with backoff", async () => {
    let fail = 3;
    const t = setup(withRows(2), () => (fail-- > 0 ? Promise.reject(new NetworkFailure("down")) : ok(2)()));
    await t.engine.syncNow();
    expect(t.statuses.at(-1)?.state).toBe("offline");
    expect(t.calls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(BACKOFF_MS[0] - 1);
    expect(t.calls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(t.calls).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(BACKOFF_MS[1]);
    expect(t.calls).toHaveLength(3);
    await vi.advanceTimersByTimeAsync(BACKOFF_MS[2]);
    expect(t.calls).toHaveLength(4);
    expect(t.statuses.at(-1)?.state).toBe("idle");
    expect(pendingCount(t.get())).toBe(0);
  });

  it("a 5xx sets error and retries", async () => {
    let fail = 1;
    const t = setup(withRows(1), () => (fail-- > 0 ? Promise.reject(new ApiFailure(500, null)) : ok()()));
    await t.engine.syncNow();
    expect(t.statuses.at(-1)?.state).toBe("error");
    await vi.advanceTimersByTimeAsync(BACKOFF_MS[0]);
    expect(t.calls).toHaveLength(2);
    expect(pendingCount(t.get())).toBe(0);
  });

  it("drops a batch the server rejects with 400", async () => {
    const t = setup(withRows(2), () => Promise.reject(new ApiFailure(400, { error: "bad_request", message: "bad" })));
    vi.spyOn(console, "warn").mockImplementation(() => {});
    await t.engine.syncNow();
    expect(pendingCount(t.get())).toBe(0);
    expect(t.statuses.at(-1)?.state).toBe("error");
  });

  it("concurrent syncNow() calls make one request at a time", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const t = setup(withRows(1), async () => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 100));
      inFlight--;
      return ok()();
    });
    const p1 = t.engine.syncNow();
    const p2 = t.engine.syncNow();
    const p3 = t.engine.syncNow();
    expect(p2).toBe(p1);
    expect(p3).toBe(p1);
    await vi.runAllTimersAsync();
    await p1;
    expect(maxInFlight).toBe(1);
    expect(t.calls.length).toBe(2); // the first round, then one "again" round
  });

  it("kick() debounces", async () => {
    const t = setup(withRows(1), ok());
    t.engine.kick();
    t.engine.kick();
    await vi.advanceTimersByTimeAsync(1999);
    expect(t.calls).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(t.calls).toHaveLength(1);
  });
});

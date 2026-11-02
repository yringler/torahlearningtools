import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChildStatsResponse, EventsResponse, LearningEvent } from "../../shared/api";
import { child, login, mockTurnstile, recite, req, sync } from "./helpers";

beforeEach(() => {
  mockTurnstile(true);
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("parent views", () => {
  it("pages events newest first", async () => {
    const { cookie } = await login();
    const cid = crypto.randomUUID();
    const t = Date.now() - 100_000;
    const events = Array.from({ length: 5 }, (_, i) => recite(cid, t + i * 1000));
    expect((await sync(cookie, { children: [child(cid, t)], events })).status).toBe(200);

    const seen: LearningEvent[] = [];
    let before: number | null = null;
    let pages = 0;
    do {
      const q: string = before === null ? "limit=2" : `limit=2&before=${before}`;
      const r = await req(`/api/children/${cid}/events?${q}`, { cookie });
      expect(r.status).toBe(200);
      const body: EventsResponse = await r.json<EventsResponse>();
      seen.push(...body.events);
      before = body.nextBefore;
      pages++;
    } while (before !== null && pages < 10);
    expect(pages).toBe(3);
    expect(seen.map((e) => e.id)).toEqual([...events].reverse().map((e) => e.id));
    expect(seen[0]).toEqual(events[4]);
  });

  it("aggregates stats and sorts by struggle", async () => {
    const { cookie } = await login();
    const cid = crypto.randomUUID();
    const t = Date.now() - 3_600_000;
    const day = "2026-10-31";
    const events: LearningEvent[] = [
      recite(cid, t, { perek: 1, mishnah: 1, grade: "pass", peeks: 0, day }),
      recite(cid, t + 1, { perek: 1, mishnah: 1, grade: "help", peeks: 2, day }),
      recite(cid, t + 2, { perek: 1, mishnah: 2, grade: "notyet", peeks: 1, day }),
      { id: crypto.randomUUID(), childId: cid, at: t + 3, day, type: "check", scope: "mishnah", perek: 1, mishnah: 2, through: null, grade: "help", slipped: [0, 3], slipWords: 4 },
      { id: crypto.randomUUID(), childId: cid, at: t + 4, day, type: "check", scope: "chain", perek: 1, mishnah: null, through: 2, grade: "pass", slipped: [], slipWords: 0 },
      { id: crypto.randomUUID(), childId: cid, at: t + 5, day, type: "session", startedAt: t, ms: 150_000, steps: 4 },
      { id: crypto.randomUUID(), childId: cid, at: t + 6, day: "2026-11-01", type: "session", startedAt: t, ms: 60_000, steps: 1 },
      { id: crypto.randomUUID(), childId: cid, at: t + 7, day: "2026-11-01", type: "reset", perek: 1, mishnah: 1 },
      recite(cid, t - 40 * 86_400_000, { perek: 3, mishnah: 3, grade: "notyet" }), // outside the 30-day window
    ];
    expect((await sync(cookie, { children: [child(cid, t)], events })).status).toBe(200);

    const r = await req(`/api/children/${cid}/stats`, { cookie });
    expect(r.status).toBe(200);
    const s = await r.json<ChildStatsResponse>();
    expect(s.childId).toBe(cid);
    expect(s.items).toEqual([
      { perek: 1, mishnah: 2, attempts: 2, pass: 0, help: 1, notyet: 1, peeks: 1, slips: 2, lastAt: t + 3, struggle: 6.5 },
      { perek: 1, mishnah: 1, attempts: 2, pass: 1, help: 1, notyet: 0, peeks: 2, slips: 0, lastAt: t + 1, struggle: 2 },
      { perek: 1, mishnah: null, attempts: 1, pass: 1, help: 0, notyet: 0, peeks: 0, slips: 0, lastAt: t + 4, struggle: 0 },
    ]);
    expect(s.days).toEqual([
      { day: "2026-10-31", minutes: 3, recites: 3 },
      { day: "2026-11-01", minutes: 1, recites: 0 },
    ]);
    expect((await req(`/api/children/${cid}/stats?days=0`, { cookie })).status).toBe(400);
    expect((await req(`/api/children/${cid}/events?limit=101`, { cookie })).status).toBe(400);
  });

  it("404s for another user's child and for a deleted child", async () => {
    const a = await login();
    const b = await login();
    const cid = crypto.randomUUID();
    const t = Date.now() - 10_000;
    await sync(a.cookie, { children: [child(cid, t)] });
    expect((await req(`/api/children/${cid}/events`, { cookie: b.cookie })).status).toBe(404);
    expect((await req(`/api/children/${cid}/stats`, { cookie: b.cookie })).status).toBe(404);
    expect((await req(`/api/children/${cid}/events`, { cookie: a.cookie })).status).toBe(200);
    await sync(a.cookie, { children: [child(cid, t + 1, { deleted: true })] });
    expect((await req(`/api/children/${cid}/events`, { cookie: a.cookie })).status).toBe(404);
    expect((await req(`/api/children/${cid}/stats`, { cookie: a.cookie })).status).toBe(404);
    expect((await req(`/api/children/${cid}/stats`)).status).toBe(401);
  });
});

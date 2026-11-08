import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ApiError, RecordRow, SyncResponse } from "../../shared/api";
import { adminSync, child, db, dRec, login, meta, mockTurnstile, mRec, pRec, recite, req, sync } from "./helpers";

beforeEach(() => {
  mockTurnstile(true);
});
afterEach(() => {
  vi.restoreAllMocks();
});

const YEAR = 365 * 86_400_000;
const key = (r: RecordRow) => `${r.childId}|${r.kind}|${r.key}`;

async function ok(res: Response): Promise<SyncResponse> {
  expect(res.status).toBe(200);
  return res.json<SyncResponse>();
}

async function rev(userId: string): Promise<number> {
  return (await db.prepare("SELECT rev FROM users WHERE id = ?").bind(userId).first<{ rev: number }>())!.rev;
}

describe("POST /api/sync", () => {
  it("pushes, pulls on a second device, and pulls incrementally", async () => {
    const { cookie, email } = await login();
    const cid = crypto.randomUUID();
    const t = Date.now() - 1000;
    await ok(await adminSync(email, { children: [child(cid, t)] }));
    const records = [mRec(cid, "1:1", t), mRec(cid, "1:2", t), pRec(cid, "1", t), dRec(cid, "2026-11-01", t)];
    const a = await ok(await sync(cookie, { records, events: [recite(cid, t), recite(cid, t + 1)] }));
    expect(a.cursor).toBeGreaterThanOrEqual(1);
    expect(a.children.map((c) => c.id)).toEqual([cid]);
    expect(a.records.map(key).sort()).toEqual(records.map(key).sort());
    expect(a.serverTime).toBeGreaterThan(t);

    const b = await ok(await sync(cookie, { cursor: 0 }));
    expect(b.cursor).toBe(a.cursor);
    expect(b.children).toEqual(a.children);
    expect(b.records.map(key).sort()).toEqual(records.map(key).sort());
    expect(b.records.find((r) => r.kind === "p")).toEqual(records[2]);

    const newRow = mRec(cid, "1:3", t + 5);
    const a2 = await ok(await sync(cookie, { cursor: a.cursor, records: [newRow] }));
    const b2 = await ok(await sync(cookie, { cursor: b.cursor }));
    expect(b2.children).toEqual([]);
    expect(b2.records).toEqual([newRow]);
    expect(b2.cursor).toBe(a2.cursor);

    const ev = await db.prepare("SELECT count(*) AS n FROM events WHERE child_id = ?").bind(cid).first<{ n: number }>();
    expect(ev!.n).toBe(2);
  });

  it("carries perek chains from one device to another", async () => {
    const { cookie, email } = await login();
    const cid = crypto.randomUUID();
    const t = Date.now() - 10_000;
    await ok(await adminSync(email, { children: [child(cid, t)] }));
    const rec: RecordRow = { kind: "p", childId: cid, key: "2", updatedAt: t, data: { chainedThrough: 4, complete: false, chains: ["1-4", "5-6"] } };
    await ok(await sync(cookie, { records: [rec] }));
    const b = await ok(await sync(cookie, { cursor: 0 }));
    expect(b.records.find((r) => r.kind === "p" && r.key === "2")).toEqual(rec);
  });

  it("keeps stored chains when an old client pushes a perek without them; an empty list clears them", async () => {
    const { cookie, email } = await login();
    const cid = crypto.randomUUID();
    const t = Date.now() - 10_000;
    await ok(await adminSync(email, { children: [child(cid, t)] }));
    const withChains: RecordRow = { kind: "p", childId: cid, key: "2", updatedAt: t, data: { chainedThrough: 4, complete: false, chains: ["1-4", "5-6"] } };
    await ok(await sync(cookie, { records: [withChains] }));
    // An old cached client: newer, but it drops the unknown field.
    await ok(await sync(cookie, { records: [{ kind: "p", childId: cid, key: "2", updatedAt: t + 5, data: { chainedThrough: 4, complete: false } }] }));
    const kept = await ok(await sync(cookie, { cursor: 0 }));
    expect(kept.records.find((r) => r.kind === "p" && r.key === "2")).toEqual({ ...withChains, updatedAt: t + 5 });
    // A new client clearing them on purpose.
    await ok(await sync(cookie, { records: [{ kind: "p", childId: cid, key: "2", updatedAt: t + 9, data: { chainedThrough: 4, complete: false, chains: [] } }] }));
    const cleared = await ok(await sync(cookie, { cursor: 0 }));
    expect(cleared.records.find((r) => r.kind === "p" && r.key === "2")?.data).toEqual({ chainedThrough: 4, complete: false, chains: [] });
  });

  it("last write wins, and the response corrects a losing push", async () => {
    const { cookie, email } = await login();
    const cid = crypto.randomUUID();
    const t = Date.now() - 10_000;
    await ok(await adminSync(email, { children: [child(cid, t)] }));
    await ok(await sync(cookie, { records: [mRec(cid, "2:1", t, 7)] }));
    const res = await ok(await sync(cookie, { cursor: 999_999, children: [child(cid, t - 5, { meta: meta({ name: "Old" }) })], records: [mRec(cid, "2:1", t - 5, 1)] }));
    expect(res.records).toEqual([mRec(cid, "2:1", t, 7)]);
    expect(res.children[0]!.meta.name).toBe("Avi");
    // A newer write does win.
    const win = await ok(await sync(cookie, { records: [mRec(cid, "2:1", t + 5, 9)] }));
    expect(win.records.find((r) => r.key === "2:1")).toEqual(mRec(cid, "2:1", t + 5, 9));
  });

  it("clamps future timestamps to server time", async () => {
    const { cookie, email } = await login();
    const cid = crypto.randomUUID();
    const before = Date.now();
    const { cursor } = await ok(await adminSync(email, { children: [child(cid, before)] }));
    const res = await ok(await sync(cookie, { cursor, children: [child(cid, before + YEAR, { meta: meta({ settings: { fontScale: 1.2 } }) })], records: [mRec(cid, "1:1", before + YEAR)] }));
    expect(res.children[0]!.updatedAt).toBeLessThanOrEqual(res.serverTime);
    expect(res.children[0]!.meta.settings.fontScale).toBe(1.2);
    expect(res.records[0]!.updatedAt).toBeLessThanOrEqual(res.serverTime);
    const row = await db.prepare("SELECT updated_at FROM progress WHERE child_id = ?").bind(cid).first<{ updated_at: number }>();
    expect(row!.updated_at).toBeLessThanOrEqual(Date.now());
  });

  it("stores a repeated event once", async () => {
    const { cookie, email } = await login();
    const cid = crypto.randomUUID();
    const t = Date.now();
    await ok(await adminSync(email, { children: [child(cid, t)] }));
    const e = recite(cid, t);
    await ok(await sync(cookie, { events: [e] }));
    await ok(await sync(cookie, { events: [e, { ...e }] }));
    const n = await db.prepare("SELECT count(*) AS n FROM events WHERE id = ?").bind(e.id).first<{ n: number }>();
    expect(n!.n).toBe(1);
  });

  it("tombstones are final and purge data", async () => {
    const { cookie, email } = await login();
    const cid = crypto.randomUUID();
    const t = Date.now() - 10_000;
    await ok(await adminSync(email, { children: [child(cid, t)] }));
    const first = await ok(await sync(cookie, { records: [mRec(cid, "1:1", t)], events: [recite(cid, t)] }));
    await ok(await adminSync(email, { children: [child(cid, t + 1, { deleted: true })] }));
    const count = async (table: string) => (await db.prepare(`SELECT count(*) AS n FROM ${table} WHERE child_id = ?`).bind(cid).first<{ n: number }>())!.n;
    expect(await count("progress")).toBe(0);
    expect(await count("events")).toBe(0);

    const later = await ok(await sync(cookie, { records: [mRec(cid, "1:2", t + 2)], events: [recite(cid, t + 2)], children: [child(cid, t + 3)] }));
    expect(await count("progress")).toBe(0);
    expect(await count("events")).toBe(0);
    expect(later.children).toEqual([expect.objectContaining({ id: cid, deleted: true })]);
    expect(later.records).toEqual([]);

    const pull = await ok(await sync(cookie, { cursor: first.cursor }));
    expect(pull.children).toEqual([expect.objectContaining({ id: cid, deleted: true })]);
    expect(pull.records).toEqual([]);
  });

  it("refuses another account's child ids", async () => {
    const a = await login();
    const b = await login();
    const cid = crypto.randomUUID();
    const t = Date.now() - 10_000;
    await ok(await adminSync(a.email, { children: [child(cid, t)] }));
    await ok(await sync(a.cookie, { records: [mRec(cid, "1:1", t, 3)] }));
    for (const body of [
      { children: [child(cid, t + 1, { meta: meta({ name: "Hacked" }) })] },
      { records: [mRec(cid, "1:1", t + 1, 99)] },
      { events: [recite(cid, t + 1)] },
    ]) {
      for (const r of [await sync(b.cookie, body), await adminSync(b.email, body)]) {
        expect(r.status).toBe(403);
        expect((await r.json<ApiError>()).error).toBe("forbidden");
      }
    }
    const pull = await ok(await sync(a.cookie, {}));
    expect(pull.children[0]!.meta.name).toBe("Avi");
    expect(pull.records).toEqual([mRec(cid, "1:1", t, 3)]);
  });

  it("enforces limits and validation", async () => {
    const { cookie, email } = await login();
    const cid = crypto.randomUUID();
    const t = Date.now();
    const many = Array.from({ length: 501 }, (_, i) => mRec(cid, `1:${i % 999}`, t));
    expect((await sync(cookie, { records: many })).status).toBe(413);
    expect((await sync(cookie, { events: Array.from({ length: 501 }, () => recite(cid, t)) })).status).toBe(413);

    const bad = async (body: unknown) => {
      const r = await req("/api/sync", { cookie, body });
      expect(r.status).toBe(400);
      expect((await r.json<ApiError>()).error).toBe("bad_request");
    };
    const base = { cursor: 0, children: [], records: [], events: [] };
    await bad({ ...base, records: [{ ...mRec(cid, "1:1", t), key: "x:y" }] });
    await bad({ ...base, records: [{ ...mRec(cid, "1:1", t), kind: "z" }] });
    await bad({ ...base, records: [{ ...dRec(cid, "2026-11-01", t), data: { a: 1 } }] });
    await bad({ ...base, children: [{ ...child(cid, t), meta: { ...meta(), junk: "x".repeat(5000) } }] });
    await bad({ ...base, children: [{ ...child(cid, t), meta: meta({ name: "  " }) }] });
    await bad({ ...base, children: [{ ...child(cid, t), meta: meta({ color: "red" }) }] });
    await bad({ ...base, children: [child("short", t)] });
    await bad({ ...base, children: [child(cid, 0)] });
    await bad({ ...base, events: [{ ...recite(cid, t), grade: "great" }] });
    await bad({ ...base, events: [{ ...recite(cid, t), type: "nope" }] });
    await bad({ ...base, cursor: -1 });
    await bad({ cursor: 0 });

    // Unknown properties are dropped, not stored.
    await ok(await adminSync(email, { children: [{ ...child(cid, t), meta: { ...meta(), extra: 1 } as never }] }));
    const stored = await db.prepare("SELECT data FROM children WHERE id = ?").bind(cid).first<{ data: string }>();
    expect(JSON.parse(stored!.data)).toEqual(meta());
  });

  it("caps live children at 50 (parent sync)", async () => {
    const { email } = await login();
    const t = Date.now();
    const fifty = Array.from({ length: 50 }, (_, i) => child(crypto.randomUUID(), t, { meta: meta({ sort: i }) }));
    await ok(await adminSync(email, { children: fifty }));
    const r = await adminSync(email, { children: [child(crypto.randomUUID(), t)] });
    expect(r.status).toBe(400);
    // Deleting one frees a slot.
    await ok(await adminSync(email, { children: [{ ...fifty[0]!, updatedAt: t + 1, deleted: true }] }));
    await ok(await adminSync(email, { children: [child(crypto.randomUUID(), t)] }));
  });

  it("a pull-only sync does not bump the revision", async () => {
    const { cookie, user } = await login();
    const before = await rev(user.id);
    const r = await ok(await sync(cookie, {}));
    expect(r.cursor).toBe(before);
    expect(await rev(user.id)).toBe(before);
  });

  it("requires a session", async () => {
    expect((await sync("", {})).status).toBe(401);
  });
});

describe("multi-masechta sync", () => {
  it("stores Peah and Berakhot rows of the same perek:mishnah separately, and rejects berakhot/ keys", async () => {
    const { cookie, email } = await login();
    const cid = crypto.randomUUID();
    const t = Date.now() - 10_000;
    await ok(await adminSync(email, { children: [child(cid, t)] }));
    const records = [mRec(cid, "1:2", t, 3), mRec(cid, "peah/1:2", t, 5), pRec(cid, "1", t), pRec(cid, "peah/1", t)];
    await ok(await sync(cookie, { records }));
    const pull = await ok(await sync(cookie, { cursor: 0 }));
    expect(pull.records.map(key).sort()).toEqual(records.map(key).sort());
    expect(pull.records.find((r) => r.key === "1:2")).toEqual(records[0]);
    expect(pull.records.find((r) => r.key === "peah/1:2")).toEqual(records[1]);

    const r = await sync(cookie, { records: [mRec(cid, "berakhot/1:2", t + 1, 9)] });
    expect(r.status).toBe(400);
    const n = await db.prepare("SELECT count(*) AS n FROM progress WHERE child_id = ? AND key LIKE 'berakhot/%'").bind(cid).first<{ n: number }>();
    expect(n!.n).toBe(0);
  });

  it("fills events.masechta, NULL when the event has none", async () => {
    const { cookie, email } = await login();
    const cid = crypto.randomUUID();
    const t = Date.now() - 10_000;
    await ok(await adminSync(email, { children: [child(cid, t)] }));
    const old = recite(cid, t);
    const peah = recite(cid, t + 1, { masechta: "peah" });
    await ok(await sync(cookie, { events: [old, peah] }));
    const col = async (id: string) => (await db.prepare("SELECT masechta FROM events WHERE id = ?").bind(id).first<{ masechta: string | null }>())!.masechta;
    expect(await col(old.id)).toBeNull();
    expect(await col(peah.id)).toBe("peah");
  });

  it("an old client (no lastMasechta in settings) can't wipe the stored one, on either sync", async () => {
    const { cookie, email } = await login();
    const cid = crypto.randomUUID();
    const t = Date.now() - 10_000;
    const stored = async () => (JSON.parse((await db.prepare("SELECT data FROM children WHERE id = ?").bind(cid).first<{ data: string }>())!.data) as { settings: Record<string, unknown>; name: string });
    await ok(await adminSync(email, { children: [child(cid, t, { meta: meta({ settings: { fontScale: 1, lastMasechta: "peah" } }) })] }));
    expect((await stored()).settings).toEqual({ fontScale: 1, lastMasechta: "peah" });

    // Old parent client: a rename that drops the unknown setting.
    await ok(await adminSync(email, { children: [child(cid, t, { meta: meta({ name: "Avraham", settings: { fontScale: 1.2 } }) })] }));
    expect(await stored()).toMatchObject({ name: "Avraham", settings: { fontScale: 1.2, lastMasechta: "peah" } });
    // The change log names what the parent changed, never the learner's lastMasechta.
    const log = await db.prepare("SELECT detail FROM audit_log WHERE child_id = ? AND action = 'child_edited' ORDER BY at DESC LIMIT 1").bind(cid).first<{ detail: string }>();
    expect(JSON.parse(log!.detail)).toMatchObject({ fields: ["name", "settings.fontScale"] });

    // Old learner client: a text-size change without it.
    const pulled = await ok(await sync(cookie, { cursor: 0 }));
    await ok(await sync(cookie, { cursor: pulled.cursor, children: [child(cid, Date.now(), { meta: meta({ settings: { fontScale: 1.4 } }) })] }));
    expect((await stored()).settings).toEqual({ fontScale: 1.4, lastMasechta: "peah" });

    // A new learner client changes it.
    const p2 = await ok(await sync(cookie, { cursor: 0 }));
    const res = await ok(await sync(cookie, { cursor: p2.cursor, children: [child(cid, Date.now() + 1, { meta: meta({ settings: { fontScale: 1.4, lastMasechta: "demai" } }) })] }));
    expect(res.children[0]?.meta.settings.lastMasechta).toBe("demai");
    expect((await stored()).settings).toEqual({ fontScale: 1.4, lastMasechta: "demai" });

    // A parent client holding an older copy (berakhot) edits the child: the child's newer choice stays. Parent mode
    // never chooses a masechta, so a parent write never changes a stored lastMasechta.
    await ok(await adminSync(email, { children: [child(cid, t, { meta: meta({ name: "Avi", settings: { fontScale: 1.4, lastMasechta: "berakhot" } }) })] }));
    expect(await stored()).toMatchObject({ name: "Avi", settings: { fontScale: 1.4, lastMasechta: "demai" } });
  });
});

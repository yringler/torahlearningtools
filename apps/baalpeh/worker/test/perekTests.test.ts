import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import type { ApiError, ChildRow, PerekTestInfo, PerekTestRequestResponse, SyncResponse } from "../../shared/api";
import { hebNum } from "../../shared/hebrew";
import { cleanup } from "../cron";
import { perekPieces } from "../lib/text";
import { setVerificationStmts } from "../lib/verification";
import { adminCookie, adminSync, child, db, login, meta, mockTurnstile, pRec, recite, req, sentEmails, sha256, sync, uniqueIp, type SentEmail } from "./helpers";

let fetchSpy: MockInstance<typeof fetch>;
beforeEach(() => {
  fetchSpy = mockTurnstile(true);
});
afterEach(() => {
  vi.restoreAllMocks();
});

const M = "berakhot";

interface Account {
  cookie: string;
  email: string;
  userId: string;
}

async function account(): Promise<Account> {
  const a = await login();
  return { cookie: a.cookie, email: a.email, userId: a.user.id };
}

async function addChild(a: Account, over: Partial<ChildRow> = {}): Promise<string> {
  const id = crypto.randomUUID();
  const res = await adminSync(a.email, { children: [child(id, Date.now() - 1000, over)] });
  expect(res.status).toBe(200);
  return id;
}

function requestTest(cookie: string | undefined, childId: string, perek: number, extra: { masechta?: unknown; origin?: string; ip?: string } = {}) {
  return req("/api/perek-tests", {
    ...(cookie ? { cookie } : {}),
    ...(extra.origin ? { origin: extra.origin } : {}),
    ...(extra.ip ? { ip: extra.ip } : {}),
    body: { childId, masechta: extra.masechta ?? M, perek },
  });
}

function testEmails(email: string): SentEmail[] {
  return sentEmails.filter((m) => m.to === email && m.idempotencyKey?.startsWith("perek-test-"));
}

function lastPerekTestToken(email: string): string {
  const mail = testEmails(email).at(-1);
  const token = mail ? /#t=([A-Za-z0-9_-]+)/.exec(mail.text)?.[1] : undefined;
  if (!token) throw new Error("no perek-test email for " + email);
  return token;
}

const lookup = (token: string, ip?: string) => req("/api/perek-tests/lookup", { body: { token }, ...(ip ? { ip } : {}) });
const confirm = (token: string, o: { cookie?: string; ip?: string; origin?: string } = {}) =>
  req("/api/perek-tests/confirm", { body: { token }, ...o });

async function ageTests(childId: string, ms = 601_000): Promise<void> {
  await db.prepare("UPDATE perek_tests SET created_at = created_at - ?1 WHERE child_id = ?2").bind(ms, childId).run();
}

async function rev(userId: string): Promise<number> {
  return (await db.prepare("SELECT rev FROM users WHERE id = ?").bind(userId).first<{ rev: number }>())!.rev;
}

async function okJson<T>(res: Response): Promise<T> {
  if (res.status !== 200) throw new Error(`expected 200, got ${res.status}: ${await res.text()}`);
  return res.json<T>();
}

async function errOf(res: Response, status: number): Promise<ApiError> {
  expect(res.status).toBe(status);
  return res.json<ApiError>();
}

/** Request + confirm a perek; returns the token. */
async function verify(a: Account, childId: string, perek: number): Promise<string> {
  await okJson(await requestTest(a.cookie, childId, perek));
  const token = lastPerekTestToken(a.email);
  const info = await okJson<PerekTestInfo>(await confirm(token));
  expect(info.status).toBe("verified");
  await ageTests(childId);
  return token;
}

describe("POST /api/perek-tests (request)", () => {
  it("1. rejects no session, a foreign Origin, non-JSON and bad fields", async () => {
    const a = await account();
    const cid = await addChild(a);
    expect((await errOf(await requestTest(undefined, cid, 1), 401)).error).toBe("unauthorized");
    expect(await errOf(await requestTest(a.cookie, cid, 1, { origin: "https://evil.example" }), 403)).toMatchObject({ error: "forbidden" });
    expect((await errOf(await req("/api/perek-tests", { cookie: a.cookie, rawBody: "x", contentType: "text/plain" }), 400)).error).toBe("bad_request");
    for (const body of [
      { childId: cid, masechta: M, perek: 0 },
      { childId: cid, masechta: M, perek: 10 },
      { childId: cid, masechta: M, perek: "1" },
      { childId: cid, masechta: "shabbat", perek: 1 },
      { childId: cid, masechta: "__proto__", perek: 1 },
      { childId: "bad id!", masechta: M, perek: 1 },
    ]) {
      expect((await errOf(await req("/api/perek-tests", { cookie: a.cookie, body }), 400)).error).toBe("bad_request");
    }
    expect(testEmails(a.email)).toHaveLength(0);
  });

  it("2. 404 for another account's child, a tombstoned child and an unsynced child", async () => {
    const a = await account();
    const b = await account();
    const theirs = await addChild(b);
    const gone = await addChild(a);
    await adminSync(a.email, { children: [child(gone, Date.now(), { deleted: true })] });
    for (const cid of [theirs, gone, crypto.randomUUID()]) {
      expect((await errOf(await requestTest(a.cookie, cid, 1), 404)).error).toBe("not_found");
    }
    expect(testEmails(a.email)).toHaveLength(0);
  });

  it("3. happy path: one email to the account, the whole perek, a fragment link, only a hash stored", async () => {
    const a = await account();
    const cid = await addChild(a, { meta: meta({ name: "Avi", emoji: "🦁" }) });
    const before = Date.now();
    const body = await okJson<PerekTestRequestResponse>(await requestTest(a.cookie, cid, 1));
    expect(body.ok).toBe(true);
    expect(body.alreadyVerified).toBe(false);
    expect(body.sentTo).toBe(a.email[0] + "•••@example.com");
    expect(body.serverTime).toBeGreaterThanOrEqual(before);
    expect(body.nextAllowedAt).toBe(body.serverTime + 600_000);

    const mails = testEmails(a.email);
    expect(mails).toHaveLength(1);
    const mail = mails[0]!;
    const row = await db.prepare("SELECT * FROM perek_tests WHERE child_id = ?").bind(cid).first<Record<string, unknown>>();
    expect(mail.idempotencyKey).toBe(`perek-test-${row!.id as string}`);
    expect(mail.subject).toContain("Avi");
    expect(mail.subject).toContain("Perek 1");
    expect(mail.html).toContain('dir="rtl"');
    expect(mail.html).toContain('lang="he"');
    let at = 0;
    for (const piece of perekPieces(M, 1).flat()) {
      const i = mail.html.indexOf(piece, at);
      expect(i, piece).toBeGreaterThan(at);
      at = i;
    }
    expect(mail.text).toMatch(/https:\/\/app\.test\/perek-test#t=[A-Za-z0-9_-]{43}/);
    const token = lastPerekTestToken(a.email);
    expect(row!.token_hash).toBe(await sha256(token));
    for (const v of Object.values(row!)) expect(String(v)).not.toContain(token);
    expect(row).toMatchObject({ masechta: M, perek: 1, consumed_at: null, outcome: null, user_id: a.userId });
    expect(row!.expires_at).toBe((row!.created_at as number) + 30 * 86_400_000);
  });

  it("4. order: perek 2 needs perek 1 verified on the server", async () => {
    const a = await account();
    const cid = await addChild(a);
    const e = await errOf(await requestTest(a.cookie, cid, 2), 400);
    expect(e).toMatchObject({ error: "bad_request", message: "not_frontier" });
    await verify(a, cid, 1);
    await okJson(await requestTest(a.cookie, cid, 2));
  });

  it("5. per-child cooldown with an exact countdown; siblings are not blocked", async () => {
    const a = await account();
    const c1 = await addChild(a);
    const c2 = await addChild(a);
    await okJson(await requestTest(a.cookie, c1, 1));
    const e = await errOf(await requestTest(a.cookie, c1, 1), 429);
    expect(e.error).toBe("rate_limited");
    expect(e.reason).toBe("cooldown");
    expect(e.retryAfterSec).toBeGreaterThanOrEqual(590);
    expect(e.retryAfterSec).toBeLessThanOrEqual(600);
    await okJson(await requestTest(a.cookie, c2, 1));
    await ageTests(c1);
    await okJson(await requestTest(a.cookie, c1, 1));
    expect(testEmails(a.email)).toHaveLength(3);
  });

  it("6. account cap: the 13th request in an hour is refused", async () => {
    const a = await account();
    const t = Date.now() - 1000;
    const ids = Array.from({ length: 13 }, () => crypto.randomUUID());
    await okJson(await adminSync(a.email, { children: ids.map((id, i) => child(id, t, { meta: meta({ sort: i }) })) }));
    for (const id of ids.slice(0, 12)) await okJson(await requestTest(a.cookie, id, 1));
    const e = await errOf(await requestTest(a.cookie, ids[12]!, 1), 429);
    expect(e.error).toBe("rate_limited");
    expect(e.reason).toBe("cap");
    expect(e.retryAfterSec).toBeGreaterThan(3500);
    expect(testEmails(a.email)).toHaveLength(12);
  });

  it("6b. cooldown refusals and failed sends don't use up the account caps", async () => {
    const a = await account();
    const t = Date.now() - 1000;
    const ids = Array.from({ length: 12 }, () => crypto.randomUUID());
    await okJson(await adminSync(a.email, { children: ids.map((id, i) => child(id, t, { meta: meta({ sort: i }) })) }));
    await okJson(await requestTest(a.cookie, ids[0]!, 1));
    for (let k = 0; k < 15; k++) expect((await errOf(await requestTest(a.cookie, ids[0]!, 1), 429)).reason).toBe("cooldown");
    vi.spyOn(console, "error").mockImplementation(() => {});
    for (let k = 0; k < 3; k++) {
      fetchSpy.mockImplementationOnce(async () => new Response("provider down", { status: 500 }));
      await errOf(await requestTest(a.cookie, ids[1]!, 1), 502);
    }
    for (const id of ids.slice(1)) await okJson(await requestTest(a.cookie, id, 1));
    expect(testEmails(a.email)).toHaveLength(12);
  });

  it("7. a refused send is a 502, doesn't use up the cooldown, and can be retried at once", async () => {
    const a = await account();
    const cid = await addChild(a);
    vi.spyOn(console, "error").mockImplementation(() => {});
    fetchSpy.mockImplementationOnce(async () => new Response("provider down", { status: 500 }));
    expect((await errOf(await requestTest(a.cookie, cid, 1), 502)).error).toBe("email_failed");
    const row = await db.prepare("SELECT outcome, consumed_at FROM perek_tests WHERE child_id = ?").bind(cid).first<{ outcome: string; consumed_at: number }>();
    expect(row?.outcome).toBe("failed");
    expect(row?.consumed_at).not.toBeNull();
    await okJson(await requestTest(a.cookie, cid, 1));
  });

  it("8. two concurrent requests for one child: exactly one is sent", async () => {
    const a = await account();
    const cid = await addChild(a);
    const rs = await Promise.all([requestTest(a.cookie, cid, 1), requestTest(a.cookie, cid, 1)]);
    expect(rs.map((r) => r.status).sort()).toEqual([200, 429]);
    expect(testEmails(a.email)).toHaveLength(1);
  });

  it("9. already verified: no email, the verification comes back", async () => {
    const a = await account();
    const cid = await addChild(a);
    await verify(a, cid, 1);
    const n = testEmails(a.email).length;
    const body = await okJson<PerekTestRequestResponse>(await requestTest(a.cookie, cid, 1));
    expect(body.alreadyVerified).toBe(true);
    expect(body.sentTo).toBe("");
    expect(body.verification).toMatchObject({ childId: cid, masechta: M, perek: 1, verified: true });
    expect(body.verification!.verifiedAt).toBeGreaterThan(0);
    expect(testEmails(a.email)).toHaveLength(n);
  });

  it("10. a hostile name is escaped and stripped of bidi and line breaks", async () => {
    const a = await account();
    const cid = await addChild(a, { meta: meta({ name: "<b>Avi</b>‮\nX" }) });
    await okJson(await requestTest(a.cookie, cid, 1));
    const mail = testEmails(a.email).at(-1)!;
    expect(mail.html).toContain("&#60;b&#62;Avi");
    expect(mail.html).not.toContain("<b>Avi");
    expect(mail.html).not.toContain("‮");
    expect(mail.text).not.toContain("‮");
    expect(mail.subject).not.toMatch(/[\r\n]/);
  });
});

describe("lookup and confirm", () => {
  it("11. lookup is read-only and shows the child, the perek and the text; there is no GET", async () => {
    const a = await account();
    const cid = await addChild(a, { meta: meta({ name: "Dina", emoji: "🌸", color: "#aa3366" }) });
    await okJson(await requestTest(a.cookie, cid, 1));
    const token = lastPerekTestToken(a.email);
    for (let i = 0; i < 3; i++) {
      const info = await okJson<PerekTestInfo>(await lookup(token));
      expect(info).toMatchObject({
        status: "pending",
        childName: "Dina",
        childEmoji: "🌸",
        childColor: "#aa3366",
        masechta: M,
        masechtaHe: "ברכות",
        masechtaEn: "Berakhot",
        perek: 1,
        nextPerek: 2,
        verifiedAt: null,
      });
      expect(info.mishnayos).toEqual(perekPieces(M, 1));
      expect(JSON.stringify(info)).not.toContain(a.email);
    }
    const row = await db.prepare("SELECT consumed_at FROM perek_tests WHERE child_id = ?").bind(cid).first<{ consumed_at: number | null }>();
    expect(row?.consumed_at).toBeNull();
    expect(await db.prepare("SELECT 1 FROM perek_verifications WHERE child_id = ?").bind(cid).first()).toBeNull();
    expect((await req("/api/perek-tests/lookup")).status).toBe(404);
    expect((await req("/api/perek-tests/confirm")).status).toBe(404);
    expect((await req(`/api/perek-tests/confirm?t=${token}`)).status).toBe(404);
    expect(await db.prepare("SELECT 1 FROM perek_verifications WHERE child_id = ?").bind(cid).first()).toBeNull();
  });

  it("12. confirm needs no session, verifies, bumps rev, and is idempotent", async () => {
    const a = await account();
    const cid = await addChild(a);
    await okJson(await requestTest(a.cookie, cid, 1));
    const token = lastPerekTestToken(a.email);
    const r0 = await rev(a.userId);
    const info = await okJson<PerekTestInfo>(await confirm(token));
    expect(info.status).toBe("verified");
    expect(info.verifiedAt).toBeGreaterThan(0);
    const v = await db.prepare("SELECT * FROM perek_verifications WHERE child_id = ?").bind(cid).first<Record<string, unknown>>();
    const test = await db.prepare("SELECT id, outcome FROM perek_tests WHERE child_id = ?").bind(cid).first<{ id: string; outcome: string }>();
    expect(v).toMatchObject({ verified: 1, source: "email", test_id: test!.id, user_id: a.userId, masechta: M, perek: 1 });
    expect(test!.outcome).toBe("verified");
    const r1 = await rev(a.userId);
    expect(r1).toBe(r0 + 1);
    expect(v!.rev).toBe(r1);
    const again = await okJson<PerekTestInfo>(await confirm(token));
    expect(again.status).toBe("verified");
    expect(again.verifiedAt).toBe(info.verifiedAt);
    expect(await rev(a.userId)).toBe(r1);
    // A browser signed in to another account works too.
    const other = await account();
    expect((await confirm(token, { cookie: other.cookie })).status).toBe(200);
  });

  it("13. two links for one perek: confirming one covers the other", async () => {
    const a = await account();
    const cid = await addChild(a);
    await okJson(await requestTest(a.cookie, cid, 1));
    const first = lastPerekTestToken(a.email);
    await ageTests(cid);
    await okJson(await requestTest(a.cookie, cid, 1));
    const second = lastPerekTestToken(a.email);
    expect(second).not.toBe(first);
    await okJson(await confirm(first));
    const outcomes = await db
      .prepare("SELECT token_hash, outcome FROM perek_tests WHERE child_id = ?")
      .bind(cid)
      .all<{ token_hash: string; outcome: string }>();
    const byHash = new Map(outcomes.results.map((r) => [r.token_hash, r.outcome]));
    expect(byHash.get(await sha256(first))).toBe("verified");
    expect(byHash.get(await sha256(second))).toBe("covered");
    expect((await okJson<PerekTestInfo>(await lookup(second))).status).toBe("verified");
    expect((await okJson<PerekTestInfo>(await confirm(second))).status).toBe("verified");
  });

  it("14. expired, unknown, tombstoned, foreign Origin, and the per-IP limit", async () => {
    const a = await account();
    const cid = await addChild(a);
    await okJson(await requestTest(a.cookie, cid, 1));
    const token = lastPerekTestToken(a.email);
    await db.prepare("UPDATE perek_tests SET expires_at = ?1 WHERE child_id = ?2").bind(Date.now() - 1, cid).run();
    expect((await okJson<PerekTestInfo>(await lookup(token))).status).toBe("expired");
    expect(await errOf(await confirm(token), 400)).toMatchObject({ error: "invalid_link", message: "This test link has expired." });
    expect(await db.prepare("SELECT 1 FROM perek_verifications WHERE child_id = ?").bind(cid).first()).toBeNull();

    const unknown = "A".repeat(43);
    expect((await errOf(await lookup(unknown), 400)).error).toBe("invalid_link");
    expect((await errOf(await confirm(unknown), 400)).error).toBe("invalid_link");
    expect((await errOf(await lookup("short"), 400)).error).toBe("bad_request");

    const c2 = await addChild(a);
    await okJson(await requestTest(a.cookie, c2, 1));
    const t2 = lastPerekTestToken(a.email);
    expect((await confirm(t2, { origin: "https://evil.example" })).status).toBe(403);
    await adminSync(a.email, { children: [child(c2, Date.now(), { deleted: true })] });
    expect((await errOf(await lookup(t2), 400)).error).toBe("invalid_link");
    expect((await errOf(await confirm(t2), 400)).error).toBe("invalid_link");

    const ip = uniqueIp();
    for (let i = 0; i < 15; i++) expect((await lookup(unknown, ip)).status).toBe(400);
    for (let i = 0; i < 15; i++) expect((await confirm(unknown, { ip })).status).toBe(400);
    expect((await errOf(await lookup(unknown, ip), 429)).error).toBe("rate_limited");
  });
});

describe("sync and forgery", () => {
  it("15. a confirm reaches other devices through the sync cursor", async () => {
    const a = await account();
    const cid = await addChild(a);
    const before = await okJson<SyncResponse>(await sync(a.cookie, {}));
    expect(before.verifications).toEqual([]);
    await verify(a, cid, 1);
    const pulled = await okJson<SyncResponse>(await sync(a.cookie, { cursor: before.cursor }));
    expect(pulled.cursor).toBeGreaterThan(before.cursor);
    expect(pulled.verifications).toEqual([
      { childId: cid, masechta: M, perek: 1, verified: true, verifiedAt: expect.any(Number), updatedAt: expect.any(Number) },
    ]);
    expect((await okJson<SyncResponse>(await sync(a.cookie, { cursor: pulled.cursor }))).verifications).toEqual([]);
    // A fresh device sees it too.
    expect((await okJson<SyncResponse>(await sync(a.cookie, { cursor: 0 }))).verifications).toHaveLength(1);
  });

  it("16. nothing in a sync push can set a verification", async () => {
    const a = await account();
    const cid = await addChild(a);
    const p = pRec(cid, "1", Date.now() - 500);
    const forged = { ...p, data: { ...p.data, complete: true, verified: true, official: true } };
    const res = await req("/api/sync", {
      cookie: a.cookie,
      body: {
        cursor: 0,
        children: [],
        records: [forged],
        events: [],
        verifications: [{ childId: cid, masechta: M, perek: 1, verified: true, verifiedAt: 1, updatedAt: 1 }],
      },
    });
    const body = await okJson<SyncResponse>(res);
    expect(body.verifications).toEqual([]);
    expect(await db.prepare("SELECT 1 FROM perek_verifications WHERE child_id = ?").bind(cid).first()).toBeNull();
    const stored = await db.prepare("SELECT data FROM progress WHERE child_id = ? AND kind = 'p'").bind(cid).first<{ data: string }>();
    const data = JSON.parse(stored!.data) as Record<string, unknown>;
    expect(data).not.toHaveProperty("verified");
    expect(data).not.toHaveProperty("official");
    // Legacy complete=true is kept as progress: "learned, not verified". The server still asks for perek 1 first.
    expect(data.complete).toBe(true);
    expect((await errOf(await requestTest(a.cookie, cid, 2), 400)).message).toBe("not_frontier");
  });

  it("17. un-verify through the seam: pulled as verified:false, live links revoked", async () => {
    const a = await account();
    const cid = await addChild(a);
    const used = await verify(a, cid, 1);
    const { cursor } = await okJson<SyncResponse>(await sync(a.cookie, {}));
    const unverify = () => db.batch(setVerificationStmts(db, { userId: a.userId, childId: cid, masechta: M, perek: 1, verified: false, source: "admin", testId: null, t: Date.now() }));
    await unverify();
    const pulled = await okJson<SyncResponse>(await sync(a.cookie, { cursor }));
    expect(pulled.verifications).toEqual([
      { childId: cid, masechta: M, perek: 1, verified: false, verifiedAt: expect.any(Number), updatedAt: expect.any(Number) },
    ]);
    // The old, already-used link no longer verifies.
    expect((await errOf(await lookup(used), 400)).error).toBe("invalid_link");
    expect((await errOf(await confirm(used), 400)).error).toBe("invalid_link");
    // A new link, then another un-verify: it is revoked and can't confirm.
    await okJson(await requestTest(a.cookie, cid, 1));
    const fresh = lastPerekTestToken(a.email);
    await unverify();
    const row = await db.prepare("SELECT outcome FROM perek_tests WHERE token_hash = ?").bind(await sha256(fresh)).first<{ outcome: string }>();
    expect(row?.outcome).toBe("revoked");
    expect((await errOf(await confirm(fresh), 400)).error).toBe("invalid_link");
    // Perek 2 is out of order again.
    expect((await errOf(await requestTest(a.cookie, cid, 2), 400)).message).toBe("not_frontier");
  });

  it("17b. the seam refuses another account's child", async () => {
    const a = await account();
    const b = await account();
    const theirs = await addChild(b);
    await db.batch(setVerificationStmts(db, { userId: a.userId, childId: theirs, masechta: M, perek: 1, verified: true, source: "admin", testId: null, t: Date.now() }));
    expect(await db.prepare("SELECT 1 FROM perek_verifications WHERE child_id = ?").bind(theirs).first()).toBeNull();
  });

  it("18. tombstones, account deletion and the cron purge what they should", async () => {
    const a = await account();
    const cid = await addChild(a);
    await verify(a, cid, 1);
    await okJson(await requestTest(a.cookie, cid, 2));
    await adminSync(a.email, { children: [child(cid, Date.now(), { deleted: true })] });
    expect(await db.prepare("SELECT 1 FROM perek_tests WHERE child_id = ?").bind(cid).first()).toBeNull();
    expect(await db.prepare("SELECT 1 FROM perek_verifications WHERE child_id = ?").bind(cid).first()).toBeNull();

    const b = await account();
    const c2 = await addChild(b);
    await verify(b, c2, 1);
    await okJson(await requestTest(b.cookie, c2, 2));
    const del = await req("/api/parent/account", { method: "DELETE", cookie: await adminCookie(b.email), body: { email: b.email } });
    expect(del.status).toBe(204);
    expect(await db.prepare("SELECT 1 FROM perek_tests WHERE user_id = ?").bind(b.userId).first()).toBeNull();
    expect(await db.prepare("SELECT 1 FROM perek_verifications WHERE user_id = ?").bind(b.userId).first()).toBeNull();

    const c = await account();
    const c3 = await addChild(c);
    await verify(c, c3, 1);
    await okJson(await requestTest(c.cookie, c3, 2));
    const now = Date.now();
    await db.prepare("UPDATE perek_tests SET expires_at = ?1 WHERE child_id = ?2 AND perek = 1").bind(now - 31 * 86_400_000, c3).run();
    await db.prepare("UPDATE perek_tests SET expires_at = ?1 WHERE child_id = ?2 AND perek = 2").bind(now - 29 * 86_400_000, c3).run();
    await cleanup({ DB: db }, now);
    const left = await db.prepare("SELECT perek FROM perek_tests WHERE child_id = ?").bind(c3).all<{ perek: number }>();
    expect(left.results.map((r) => r.perek)).toEqual([2]);
    expect(await db.prepare("SELECT 1 FROM perek_verifications WHERE child_id = ?").bind(c3).first()).not.toBeNull();
  });

  it('19. a "pre-test" recite is accepted; an unknown task is still rejected', async () => {
    const a = await account();
    const cid = await addChild(a);
    const t = Date.now() - 100;
    await okJson(await sync(a.cookie, { events: [recite(cid, t, { task: "pre-test", mishnah: null, step: null, from: 1, to: 5 })] }));
    const ev = await db.prepare("SELECT task FROM events WHERE child_id = ?").bind(cid).first<{ task: string }>();
    expect(ev?.task).toBe("pre-test");
    const bad = recite(cid, t, { task: "nope" as never });
    expect((await sync(a.cookie, { events: [bad] })).status).toBe(400);
  });

  it("the last perek has no next perek; the email says the masechta is complete", async () => {
    const a = await account();
    const cid = await addChild(a);
    const t = Date.now();
    await db.batch(
      [1, 2, 3, 4, 5, 6, 7, 8].flatMap((perek) =>
        setVerificationStmts(db, { userId: a.userId, childId: cid, masechta: M, perek, verified: true, source: "admin", testId: null, t }),
      ),
    );
    await okJson(await requestTest(a.cookie, cid, 9));
    const mail = testEmails(a.email).at(-1)!;
    expect(mail.text).toContain("Berakhot is officially complete!");
    expect(mail.html).toContain(`פרק ${hebNum(9)}`);
    const info = await okJson<PerekTestInfo>(await lookup(lastPerekTestToken(a.email)));
    expect(info.nextPerek).toBeNull();
  });
});

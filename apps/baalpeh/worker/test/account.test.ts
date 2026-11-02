import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { child, db, login, mockTurnstile, mRec, recite, req, requestLogin, sessionSetCookie, sync } from "./helpers";

beforeEach(() => {
  mockTurnstile(true);
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("DELETE /api/account", () => {
  it("requires the matching email, then deletes everything", async () => {
    const { cookie, user, email } = await login();
    const cid = crypto.randomUUID();
    const t = Date.now();
    expect((await sync(cookie, { children: [child(cid, t)], records: [mRec(cid, "1:1", t)], events: [recite(cid, t)] })).status).toBe(200);
    await requestLogin(email); // a pending login request

    const wrong = await req("/api/account", { method: "DELETE", cookie, body: { email: "other@example.com" } });
    expect(wrong.status).toBe(400);
    expect((await req("/api/account", { method: "DELETE", cookie, body: { email: "nope" } })).status).toBe(400);

    const ok = await req("/api/account", { method: "DELETE", cookie, body: { email: ` ${email.toUpperCase()}` } });
    expect(ok.status).toBe(204);
    expect(sessionSetCookie(ok)).toContain("Max-Age=0");

    const count = async (sql: string, v: string) => (await db.prepare(sql).bind(v).first<{ n: number }>())!.n;
    expect(await count("SELECT count(*) AS n FROM users WHERE id = ?", user.id)).toBe(0);
    expect(await count("SELECT count(*) AS n FROM sessions WHERE user_id = ?", user.id)).toBe(0);
    expect(await count("SELECT count(*) AS n FROM children WHERE user_id = ?", user.id)).toBe(0);
    expect(await count("SELECT count(*) AS n FROM progress WHERE user_id = ?", user.id)).toBe(0);
    expect(await count("SELECT count(*) AS n FROM events WHERE user_id = ?", user.id)).toBe(0);
    expect(await count("SELECT count(*) AS n FROM login_requests WHERE email = ?", email)).toBe(0);
    expect((await req("/api/me", { cookie })).status).toBe(401);
  });

  it("needs a session", async () => {
    expect((await req("/api/account", { method: "DELETE", body: { email: "a@b.cd" } })).status).toBe(401);
  });
});

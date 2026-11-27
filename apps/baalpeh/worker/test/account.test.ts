import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  adminCookie,
  child,
  db,
  login,
  mockTurnstile,
  mRec,
  parentSetCookie,
  parentSync,
  recite,
  req,
  requestLogin,
  sessionSetCookie,
  setPin,
  sync,
} from "./helpers";

beforeEach(() => {
  mockTurnstile(true);
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("DELETE /api/parent/account", () => {
  it("requires the matching email, then deletes everything, both session scopes included", async () => {
    const { cookie, user, email } = await login();
    const parent = await adminCookie(email);
    const cid = crypto.randomUUID();
    const t = Date.now();
    expect((await parentSync(parent, { children: [child(cid, t)], records: [mRec(cid, "1:1", t)], events: [recite(cid, t)] })).status).toBe(200);
    expect((await setPin(parent, "2580")).status).toBe(200); // a PIN, a notice and a log row
    await requestLogin(email); // a pending login request
    expect((await sync(cookie, {})).status).toBe(200);

    const wrong = await req("/api/parent/account", { method: "DELETE", cookie: parent, body: { email: "other@example.com" } });
    expect(wrong.status).toBe(400);
    expect((await req("/api/parent/account", { method: "DELETE", cookie: parent, body: { email: "nope" } })).status).toBe(400);

    const ok = await req("/api/parent/account", { method: "DELETE", cookie: parent, body: { email: ` ${email.toUpperCase()}` } });
    expect(ok.status).toBe(204);
    expect(sessionSetCookie(ok)).toContain("Max-Age=0");
    expect(parentSetCookie(ok)).toContain("Max-Age=0");

    const count = async (sql: string, v: string) => (await db.prepare(sql).bind(v).first<{ n: number }>())!.n;
    expect(await count("SELECT count(*) AS n FROM users WHERE id = ?", user.id)).toBe(0);
    expect(await count("SELECT count(*) AS n FROM sessions WHERE user_id = ?", user.id)).toBe(0);
    expect(await count("SELECT count(*) AS n FROM children WHERE user_id = ?", user.id)).toBe(0);
    expect(await count("SELECT count(*) AS n FROM progress WHERE user_id = ?", user.id)).toBe(0);
    expect(await count("SELECT count(*) AS n FROM events WHERE user_id = ?", user.id)).toBe(0);
    expect(await count("SELECT count(*) AS n FROM account_pins WHERE user_id = ?", user.id)).toBe(0);
    expect(await count("SELECT count(*) AS n FROM pin_resets WHERE user_id = ?", user.id)).toBe(0);
    expect(await count("SELECT count(*) AS n FROM audit_log WHERE user_id = ?", user.id)).toBe(0);
    expect(await count("SELECT count(*) AS n FROM login_requests WHERE email = ?", email)).toBe(0);
    expect((await req("/api/me", { cookie })).status).toBe(401);
    expect((await req("/api/parent/me", { cookie: parent })).status).toBe(401);
  });

  it("needs an unlocked parent session; the old learner route is gone", async () => {
    const { cookie, email } = await login();
    expect((await req("/api/parent/account", { method: "DELETE", body: { email: "a@b.cd" } })).status).toBe(401);
    expect((await req("/api/parent/account", { method: "DELETE", cookie, body: { email } })).status).toBe(401);
    const parent = await adminCookie(email);
    await db.prepare("UPDATE sessions SET unlocked_until = NULL WHERE scope = 'parent' AND login_email = ?").bind(email).run();
    expect((await req("/api/parent/account", { method: "DELETE", cookie: parent, body: { email } })).status).toBe(403);
    const old = await req("/api/account", { method: "DELETE", cookie, body: { email } });
    expect(old.status).toBe(404);
    expect((await req("/api/me", { cookie })).status).toBe(200);
  });
});

import { generateCookie } from "hono/cookie";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MeResponse } from "../../shared/api";
import { cookieName, cookieOptions } from "../lib/session";
import { db, login, mockTurnstile, req, sessionSetCookie, sha256 } from "./helpers";

beforeEach(() => {
  mockTurnstile(true);
});
afterEach(() => {
  vi.restoreAllMocks();
});

const MIN = 60_000;
const DAY = 86_400_000;

function tokenOf(cookie: string): string {
  return cookie.slice(cookie.indexOf("=") + 1);
}

describe("sessions", () => {
  it("/api/me needs a valid cookie", async () => {
    const { cookie, user } = await login();
    const me = await req("/api/me", { cookie });
    expect(me.status).toBe(200);
    expect((await me.json<MeResponse>()).user).toEqual(user);
    expect((await req("/api/me")).status).toBe(401);
    expect((await req("/api/me", { cookie: "__Host-bp_session=garbage" })).status).toBe(401);
  });

  it("stores only the SHA-256 of the token", async () => {
    const { cookie, user } = await login();
    const token = tokenOf(cookie);
    const rows = await db.prepare("SELECT * FROM sessions WHERE user_id = ?").bind(user.id).all<Record<string, unknown>>();
    expect(rows.results).toHaveLength(1);
    expect(rows.results[0]!.token_hash).toBe(await sha256(token));
    expect(Object.values(rows.results[0]!).map(String).join("|")).not.toContain(token);
  });

  it("slides the expiry at most once per 5 minutes", async () => {
    const { cookie } = await login();
    const hash = await sha256(tokenOf(cookie));
    const t = Date.now();
    await db.prepare("UPDATE sessions SET last_seen_at = ?, expires_at = ? WHERE token_hash = ?").bind(t - 10 * MIN, t + DAY, hash).run();

    const r1 = await req("/api/me", { cookie });
    expect(r1.status).toBe(200);
    expect(sessionSetCookie(r1)).toContain("Max-Age=2592000");
    const row1 = await db.prepare("SELECT last_seen_at, expires_at FROM sessions WHERE token_hash = ?").bind(hash).first<{ last_seen_at: number; expires_at: number }>();
    expect(Math.abs(row1!.expires_at - (Date.now() + 30 * DAY))).toBeLessThan(MIN);

    const r2 = await req("/api/me", { cookie });
    expect(r2.status).toBe(200);
    expect(sessionSetCookie(r2)).toBeUndefined();
    const row2 = await db.prepare("SELECT last_seen_at FROM sessions WHERE token_hash = ?").bind(hash).first<{ last_seen_at: number }>();
    expect(row2!.last_seen_at).toBe(row1!.last_seen_at);
  });

  it("deletes an expired session and clears the cookie", async () => {
    const { cookie } = await login();
    const hash = await sha256(tokenOf(cookie));
    await db.prepare("UPDATE sessions SET expires_at = ? WHERE token_hash = ?").bind(Date.now() - 1, hash).run();
    const r = await req("/api/me", { cookie });
    expect(r.status).toBe(401);
    expect(sessionSetCookie(r)).toContain("Max-Age=0");
    expect(await db.prepare("SELECT 1 FROM sessions WHERE token_hash = ?").bind(hash).first()).toBeNull();
  });

  it("logout deletes the session and is idempotent", async () => {
    const { cookie } = await login();
    const hash = await sha256(tokenOf(cookie));
    const r = await req("/api/auth/logout", { method: "POST", cookie });
    expect(r.status).toBe(204);
    expect(sessionSetCookie(r)).toContain("Max-Age=0");
    expect(await db.prepare("SELECT 1 FROM sessions WHERE token_hash = ?").bind(hash).first()).toBeNull();
    expect((await req("/api/me", { cookie })).status).toBe(401);
    expect((await req("/api/auth/logout", { method: "POST" })).status).toBe(204);
    expect((await req("/api/auth/logout", { body: {} })).status).toBe(204);
    expect((await req("/api/auth/logout", { method: "POST", origin: "https://evil.test" })).status).toBe(403);
  });

  it("cookie name and flags follow APP_ORIGIN", () => {
    const local = { APP_ORIGIN: "http://localhost:5173" };
    expect(cookieName(local)).toBe("bp_session");
    const c = generateCookie(cookieName(local), "v", cookieOptions(local));
    expect(c).toContain("bp_session=v");
    expect(c).not.toContain("Secure");
    expect(c).toContain("HttpOnly");
    const prod = { APP_ORIGIN: "https://x.example" };
    expect(cookieName(prod)).toBe("__Host-bp_session");
    expect(generateCookie(cookieName(prod), "v", cookieOptions(prod))).toContain("Secure");
  });
});

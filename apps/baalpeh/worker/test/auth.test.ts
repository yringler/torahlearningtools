import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { vi } from "vitest";
import type { ApiError, AuthSuccessResponse } from "../../shared/api";
import {
  cookieOf,
  db,
  lastLogin,
  mockTurnstile,
  req,
  requestLogin,
  sentEmails,
  sessionSetCookie,
  sha256,
  turnstileForms,
  uniqueEmail,
  uniqueIp,
} from "./helpers";

beforeEach(() => {
  mockTurnstile(true);
});
afterEach(() => {
  vi.restoreAllMocks();
});

async function err(res: Response): Promise<ApiError> {
  return res.json<ApiError>();
}

describe("POST /api/auth/request", () => {
  it("sends one email with a link and a code, and stores only hashes", async () => {
    const email = uniqueEmail();
    const before = sentEmails.length;
    const res = await requestLogin(email);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, expiresInSec: 900 });
    const mine = sentEmails.slice(before).filter((m) => m.to === email);
    expect(mine).toHaveLength(1);
    const { token, code, mail } = lastLogin(email);
    expect(mail.text).toContain("https://app.test/auth/verify#token=");
    expect(mail.text).toContain(`${code.slice(0, 3)} ${code.slice(3)}`);
    expect(code).toMatch(/^\d{6}$/);
    expect(token).toHaveLength(43);

    const row = await db.prepare("SELECT * FROM login_requests WHERE email = ?").bind(email).first<Record<string, unknown>>();
    expect(row).not.toBeNull();
    expect(row!.token_hash).toBe(await sha256(token));
    const values = Object.values(row!).map(String).join("|");
    expect(values).not.toContain(token);
    expect(values).not.toContain(code);
  });

  it("answers a new and an existing email identically", async () => {
    const existing = uniqueEmail();
    await requestLogin(existing);
    const { code } = lastLogin(existing);
    expect((await req("/api/auth/verify-code", { body: { email: existing, code } })).status).toBe(200);

    const a = await requestLogin(uniqueEmail());
    const b = await requestLogin(existing);
    expect(a.status).toBe(b.status);
    expect(await a.text()).toBe(await b.text());
  });

  it("rejects a failed Turnstile check and forwards secret, response and remoteip", async () => {
    vi.restoreAllMocks();
    mockTurnstile(false);
    const ip = uniqueIp();
    const before = turnstileForms.length;
    const res = await req("/api/auth/request", { body: { email: uniqueEmail(), turnstileToken: "bad-token" }, ip });
    expect(res.status).toBe(400);
    expect((await err(res)).error).toBe("turnstile_failed");
    const form = turnstileForms[before]!;
    expect(form.get("secret")).toBe("1x0000000000000000000000000000000AA");
    expect(form.get("response")).toBe("bad-token");
    expect(form.get("remoteip")).toBe(ip);
  });

  it("failed Turnstile checks do not use up the email's quota", async () => {
    vi.restoreAllMocks();
    mockTurnstile(false);
    const email = uniqueEmail();
    for (let i = 0; i < 6; i++) {
      const res = await req("/api/auth/request", { body: { email, turnstileToken: "bad" }, ip: uniqueIp() });
      expect((await err(res)).error).toBe("turnstile_failed");
    }
    vi.restoreAllMocks();
    mockTurnstile(true);
    expect((await requestLogin(email)).status).toBe(200);
  });

  it("rate limits per email (6th in an hour) and per IP (11th)", async () => {
    const email = uniqueEmail();
    for (let i = 0; i < 5; i++) expect((await requestLogin(email)).status).toBe(200);
    const sixth = await requestLogin(email);
    expect(sixth.status).toBe(429);
    const body = await err(sixth);
    expect(body.error).toBe("rate_limited");
    expect(body.retryAfterSec).toBeGreaterThan(0);

    const ip = uniqueIp();
    for (let i = 0; i < 10; i++) expect((await requestLogin(uniqueEmail(), ip)).status).toBe(200);
    expect((await requestLogin(uniqueEmail(), ip)).status).toBe(429);
  });

  it("enforces Origin and JSON content type", async () => {
    const body = { email: uniqueEmail(), turnstileToken: "t" };
    expect((await req("/api/auth/request", { body, origin: "https://evil.test" })).status).toBe(403);
    expect((await req("/api/auth/request", { body, origin: null })).status).toBe(403);
    expect((await req("/api/auth/request", { body, origin: null, headers: { "Sec-Fetch-Site": "same-origin" } })).status).toBe(200);
    const plain = await req("/api/auth/request", { body, contentType: "text/plain" });
    expect(plain.status).toBe(400);
    expect((await err(plain)).error).toBe("bad_request");
  });

  it("rejects malformed input and oversize bodies", async () => {
    for (const body of [
      { email: "not-an-email", turnstileToken: "t" },
      { email: uniqueEmail() },
      { email: uniqueEmail(), turnstileToken: "" },
      "just a string",
    ]) {
      const res = await req("/api/auth/request", { body });
      expect(res.status).toBe(400);
      expect((await err(res)).error).toBe("bad_request");
    }
    const big = await req("/api/auth/request", { rawBody: JSON.stringify({ email: "a@b.cd", turnstileToken: "x".repeat(1_000_001) }) });
    expect(big.status).toBe(413);
    expect((await req("/api/auth/request", { rawBody: "{not json" })).status).toBe(400);
  });

  it("normalizes the email", async () => {
    const email = uniqueEmail();
    expect((await requestLogin(`  ${email.toUpperCase()} `)).status).toBe(200);
    expect(lastLogin(email).mail.to).toBe(email);
  });
});

describe("verify-link and verify-code", () => {
  it("verify-link signs in once and sets a secure session cookie", async () => {
    const email = uniqueEmail();
    await requestLogin(email);
    const { token } = lastLogin(email);
    const res = await req("/api/auth/verify-link", { body: { token } });
    expect(res.status).toBe(200);
    const body = await res.json<AuthSuccessResponse>();
    expect(body.newUser).toBe(true);
    expect(body.user.email).toBe(email);
    const sc = sessionSetCookie(res)!;
    expect(sc).toContain("__Host-bp_session=");
    expect(sc).toContain("HttpOnly");
    expect(sc).toContain("Secure");
    expect(sc).toContain("SameSite=Lax");
    expect(sc).toContain("Path=/");
    expect(sc).toContain("Max-Age=2592000");
    expect(sc).not.toContain("Domain");

    const again = await req("/api/auth/verify-link", { body: { token } });
    expect(again.status).toBe(400);
    expect((await err(again)).error).toBe("invalid_link");
  });

  it("expired requests fail for link and code", async () => {
    const email = uniqueEmail();
    await requestLogin(email);
    const { token, code } = lastLogin(email);
    await db.prepare("UPDATE login_requests SET expires_at = ? WHERE email = ?").bind(Date.now() - 1, email).run();
    expect((await err(await req("/api/auth/verify-link", { body: { token } }))).error).toBe("invalid_link");
    expect((await err(await req("/api/auth/verify-code", { body: { email, code } }))).error).toBe("invalid_code");
  });

  it("counts wrong codes down and locks after 5", async () => {
    const email = uniqueEmail();
    await requestLogin(email);
    const { code } = lastLogin(email);
    const wrong = code === "000000" ? "111111" : "000000";
    for (const left of [4, 3, 2, 1]) {
      const r = await req("/api/auth/verify-code", { body: { email, code: wrong } });
      expect(r.status).toBe(400);
      const b = await err(r);
      expect(b.error).toBe("invalid_code");
      expect(b.attemptsLeft).toBe(left);
    }
    const fifth = await err(await req("/api/auth/verify-code", { body: { email, code: wrong } }));
    expect(fifth.error).toBe("too_many_attempts");
    const right = await err(await req("/api/auth/verify-code", { body: { email, code } }));
    expect(right.error).toBe("invalid_code");
  });

  it("accepts a code with spaces", async () => {
    const email = uniqueEmail();
    await requestLogin(email);
    const { code } = lastLogin(email);
    const res = await req("/api/auth/verify-code", { body: { email, code: `${code.slice(0, 3)} ${code.slice(3)}` } });
    expect(res.status).toBe(200);
  });

  it("a new request supersedes the old link and code", async () => {
    const email = uniqueEmail();
    await requestLogin(email);
    const first = lastLogin(email);
    await requestLogin(email);
    const second = lastLogin(email);
    expect(second.token).not.toBe(first.token);
    expect((await err(await req("/api/auth/verify-link", { body: { token: first.token } }))).error).toBe("invalid_link");
    // The first code is checked against the second (live) request, so it fails as a wrong code.
    if (first.code !== second.code) {
      expect((await err(await req("/api/auth/verify-code", { body: { email, code: first.code } }))).error).toBe("invalid_code");
    }
    expect((await req("/api/auth/verify-code", { body: { email, code: second.code } })).status).toBe(200);
  });

  it("link and code share one single-use request", async () => {
    const email = uniqueEmail();
    await requestLogin(email);
    const { token, code } = lastLogin(email);
    expect((await req("/api/auth/verify-code", { body: { email, code } })).status).toBe(200);
    expect((await err(await req("/api/auth/verify-link", { body: { token } }))).error).toBe("invalid_link");
  });

  it("a second login returns newUser false and the same user id", async () => {
    const email = uniqueEmail();
    await requestLogin(email);
    const r1 = await req("/api/auth/verify-code", { body: { email, code: lastLogin(email).code } });
    const b1 = await r1.json<AuthSuccessResponse>();
    await requestLogin(email);
    const r2 = await req("/api/auth/verify-link", { body: { token: lastLogin(email).token } });
    const b2 = await r2.json<AuthSuccessResponse>();
    expect(b1.newUser).toBe(true);
    expect(b2.newUser).toBe(false);
    expect(b2.user.id).toBe(b1.user.id);
    expect(cookieOf(r2)).not.toBe(cookieOf(r1));
  });

  it("validates verify bodies", async () => {
    expect((await err(await req("/api/auth/verify-code", { body: { email: uniqueEmail(), code: "12345" } }))).error).toBe("bad_request");
    expect((await err(await req("/api/auth/verify-link", { body: { token: "short" } }))).error).toBe("bad_request");
    expect((await err(await req("/api/auth/verify-code", { body: { email: uniqueEmail(), code: "123456" } }))).error).toBe("invalid_code");
  });
});

describe("misc", () => {
  it("GET /api/config is public and unknown /api paths 404 with security headers", async () => {
    const cfg = await req("/api/config");
    expect(cfg.status).toBe(200);
    expect(await cfg.json()).toEqual({ turnstileSiteKey: "1x00000000000000000000AA", devEmail: false });
    expect(cfg.headers.get("Cache-Control")).toBe("no-store");
    expect(cfg.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(cfg.headers.get("Referrer-Policy")).toBe("no-referrer");
    expect(cfg.headers.get("Access-Control-Allow-Origin")).toBeNull();
    const nf = await req("/api/nope");
    expect(nf.status).toBe(404);
    expect((await err(nf)).error).toBe("not_found");
    expect(nf.headers.get("Cache-Control")).toBe("no-store");
  });

  it("an email provider failure returns 502", async () => {
    vi.restoreAllMocks();
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url.includes("turnstile")) return Response.json({ success: true });
      return new Response("{\"message\":\"nope\"}", { status: 422 });
    });
    vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await requestLogin(uniqueEmail());
    expect(res.status).toBe(502);
    expect((await err(res)).error).toBe("email_failed");
  });
});

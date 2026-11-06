import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import type {
  ApiError,
  AuditLogResponse,
  AuthSuccessResponse,
  ChildRow,
  ForgotPinResponse,
  ParentMeResponse,
  PerekTestInfo,
  PinResetInfo,
  RecordRow,
  SetVerificationsResponse,
  SyncResponse,
} from "../../shared/api";
import { deviceLabel } from "../../shared/device";
import { cleanup } from "../cron";
import { pinLockedEmail } from "../email/pinLockedEmail";
import { pinNoticeEmail } from "../email/pinNoticeEmail";
import { pinResetEmail } from "../email/pinResetEmail";
import { loginEmail } from "../email/loginEmail";
import { RESEND_URL } from "../email/resend";
import { hmacHex } from "../lib/crypto";
import {
  adminCookie,
  child,
  cookieOf,
  db,
  lastLogin,
  login,
  meta,
  mockTurnstile,
  mRec,
  parentCookieOf,
  parentLogin,
  parentSetCookie,
  parentSync,
  recite,
  req,
  requestLogin,
  sentEmails,
  sessionSetCookie,
  setPin,
  sha256,
  sync,
  testEnv,
  tokenOf,
  uniqueEmail,
  uniqueIp,
  unlock,
  type SentEmail,
} from "./helpers";

let fetchSpy: MockInstance<typeof fetch>;
beforeEach(() => {
  fetchSpy = mockTurnstile(true);
});
afterEach(() => {
  vi.restoreAllMocks();
});

const MIN = 60_000;
const DAY = 86_400_000;
const PIN = "2580";
const M = "berakhot";
const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";

async function errOf(res: Response, status: number): Promise<ApiError> {
  if (res.status !== status) throw new Error(`expected ${status}, got ${res.status}: ${await res.text()}`);
  return res.json<ApiError>();
}
async function okJson<T>(res: Response): Promise<T> {
  if (res.status !== 200) throw new Error(`expected 200, got ${res.status}: ${await res.text()}`);
  return res.json<T>();
}
const hashOf = async (cookie: string) => sha256(tokenOf(cookie));
/** The rate_limits key of a bucket (lib/rateLimit.ts). */
const rlKey = async (name: string, subject: string) => `${name}:${(await hmacHex(testEnv.AUTH_SECRET, "rl:" + subject)).slice(0, 32)}`;

/** Fails every Resend send while active. */
function failResend(): void {
  fetchSpy.mockImplementation(async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url === RESEND_URL) return new Response("down", { status: 500 });
    return Response.json({ success: true });
  });
}

const mails = (to: string, prefix: string): SentEmail[] => sentEmails.filter((m) => m.to === to && m.idempotencyKey?.startsWith(prefix));

/** A parent with a PIN set (and so unlocked). */
async function parentWithPin(email = uniqueEmail()) {
  const p = await parentLogin(email);
  await okJson<ParentMeResponse>(await setPin(p.cookie, PIN, "America/New_York"));
  return p;
}

async function addChildAs(cookie: string, over: Partial<ChildRow> = {}): Promise<string> {
  const id = crypto.randomUUID();
  await okJson(await parentSync(cookie, { children: [child(id, Date.now(), over)] }));
  return id;
}

async function log(cookie: string, q = ""): Promise<AuditLogResponse> {
  return okJson<AuditLogResponse>(await req(`/api/parent/log${q}`, { cookie }));
}

async function lockSession(cookie: string): Promise<void> {
  await db.prepare("UPDATE sessions SET unlocked_until = NULL WHERE token_hash = ?").bind(await hashOf(cookie)).run();
}

// ───────────── 1–3: scopes ─────────────

const PARENT_ROUTES: { method: string; path: string; body?: unknown; unlocked: boolean }[] = [
  { method: "GET", path: "/api/parent/me", unlocked: false },
  { method: "POST", path: "/api/parent/unlock", body: { pin: PIN }, unlocked: false },
  { method: "POST", path: "/api/parent/pin", body: { pin: PIN }, unlocked: false },
  { method: "POST", path: "/api/parent/pin/forgot", unlocked: false },
  { method: "POST", path: "/api/parent/learner-session", unlocked: true },
  { method: "POST", path: "/api/parent/sync", body: { cursor: 0, children: [], records: [], events: [] }, unlocked: true },
  { method: "GET", path: "/api/parent/children/00000000-aaaa/events", unlocked: true },
  { method: "GET", path: "/api/parent/children/00000000-aaaa/stats", unlocked: true },
  { method: "POST", path: "/api/parent/children/00000000-aaaa/verifications", body: { masechta: M, perakim: [1], verified: true }, unlocked: true },
  { method: "GET", path: "/api/parent/log", unlocked: true },
  { method: "DELETE", path: "/api/parent/account", body: { email: "x@y.zz" }, unlocked: true },
];

describe("scopes", () => {
  it("1. every parent route refuses no cookie, a learner cookie and a learner token under the parent name; unlocked-only routes refuse a locked parent", async () => {
    const learner = await login();
    const learnerToken = tokenOf(learner.cookie);
    const p = await parentWithPin();
    await lockSession(p.cookie);
    for (const r of PARENT_ROUTES) {
      const o = { method: r.method, ...(r.body !== undefined ? { body: r.body } : {}) };
      for (const cookie of [undefined, learner.cookie, `__Host-bp_parent=${learnerToken}`]) {
        const res = await req(r.path, { ...o, ...(cookie ? { cookie } : {}) });
        expect([r.path, res.status]).toEqual([r.path, 401]);
        expect((await res.json<ApiError>()).error).toBe("unauthorized");
      }
      if (r.unlocked) {
        const res = await req(r.path, { ...o, cookie: p.cookie });
        expect([r.path, res.status]).toEqual([r.path, 403]);
        expect((await res.json<ApiError>()).error).toBe("parent_locked");
      }
    }
    // The learner session survived being tried as a parent one.
    expect((await req("/api/me", { cookie: learner.cookie })).status).toBe(200);
  });

  it("2. a parent token under the learner cookie name gets 401 on learner routes", async () => {
    const p = await parentWithPin();
    const asLearner = `__Host-bp_session=${tokenOf(p.cookie)}`;
    expect((await req("/api/me", { cookie: asLearner })).status).toBe(401);
    expect((await sync(asLearner, {})).status).toBe(401);
    expect((await req("/api/perek-tests", { cookie: asLearner, body: { childId: "00000000-aaaa", masechta: M, perek: 1 } })).status).toBe(401);
    expect((await req("/api/me", { cookie: p.cookie })).status).toBe(401);
    // ...and the parent session itself still works.
    expect((await req("/api/parent/me", { cookie: p.cookie })).status).toBe(200);
  });

  it("3. no worker source ever updates a session's scope", () => {
    const sources = import.meta.glob<string>(["../**/*.ts", "!../test/**"], { query: "?raw", import: "default", eager: true });
    const files = Object.entries(sources);
    expect(files.length).toBeGreaterThan(10);
    for (const [path, text] of files) {
      expect([path, /UPDATE\s+sessions\s+SET\s+scope/i.test(text)]).toEqual([path, false]);
      for (const m of text.matchAll(/UPDATE\s+sessions\s+SET([\s\S]*?)(WHERE|`)/gi)) {
        expect([path, /\bscope\s*=/.test(m[1]!)]).toEqual([path, false]);
      }
    }
  });
});

// ───────────── 4: sign-in ─────────────

describe("sign-in scopes", () => {
  it("4a. as:parent stores the scope; verify-link sets only the parent cookie and says so", async () => {
    const email = uniqueEmail();
    expect((await requestLogin(email, undefined, "parent")).status).toBe(200);
    const { token, mail } = lastLogin(email);
    expect(mail.subject).toContain("parent sign-in code");
    expect(mail.text).toContain("&as=parent");
    const row = await db.prepare("SELECT scope FROM login_requests WHERE email = ? ORDER BY created_at DESC").bind(email).first<{ scope: string }>();
    expect(row?.scope).toBe("parent");
    const res = await req("/api/auth/verify-link", { body: { token } });
    const body = await okJson<AuthSuccessResponse>(res);
    expect(body.scope).toBe("parent");
    expect(parentCookieOf(res)).not.toBeNull();
    expect(cookieOf(res)).toBeNull();
    expect(parentSetCookie(res)).toContain(`Max-Age=${14 * 86_400}`);
    const s = await db.prepare("SELECT scope, id, login_email, unlocked_until, expires_at, created_at FROM sessions WHERE user_id = ?").bind(body.user.id).first<Record<string, unknown>>();
    expect(s).toMatchObject({ scope: "parent", login_email: email, unlocked_until: null });
    expect(typeof s!.id).toBe("string");
    expect((s!.expires_at as number) - (s!.created_at as number)).toBe(14 * DAY);
  });

  it("4b. a missing as means learner; the wrong as on verify-code finds nothing", async () => {
    const email = uniqueEmail();
    await requestLogin(email);
    const { code, mail } = lastLogin(email);
    expect(mail.subject).not.toContain("parent");
    expect((await errOf(await req("/api/auth/verify-code", { body: { email, code, as: "parent" } }), 400)).error).toBe("invalid_code");
    const res = await req("/api/auth/verify-code", { body: { email, code } });
    expect((await okJson<AuthSuccessResponse>(res)).scope).toBe("learner");
    expect(cookieOf(res)).not.toBeNull();
    expect(parentCookieOf(res)).toBeNull();
    expect((await errOf(await req("/api/auth/request", { body: { email, turnstileToken: "t", as: "teacher" } }), 400)).error).toBe("bad_request");
  });

  it("4c. requests of one scope don't supersede the other; email buckets are separate, the IP bucket is shared", async () => {
    const email = uniqueEmail();
    const ip = uniqueIp();
    await requestLogin(email, ip, "parent");
    const parentCode = lastLogin(email).code;
    await requestLogin(email, ip);
    const learnerCode = lastLogin(email).code;
    expect((await req("/api/auth/verify-code", { body: { email, code: parentCode, as: "parent" } })).status).toBe(200);
    expect((await req("/api/auth/verify-code", { body: { email, code: learnerCode } })).status).toBe(200);

    const e2 = uniqueEmail();
    for (let i = 0; i < 5; i++) expect((await requestLogin(e2, uniqueIp())).status).toBe(200);
    expect((await requestLogin(e2, uniqueIp())).status).toBe(429);
    expect((await requestLogin(e2, uniqueIp(), "parent")).status).toBe(200);

    const ip2 = uniqueIp();
    for (let i = 0; i < 5; i++) await requestLogin(uniqueEmail(), ip2);
    for (let i = 0; i < 5; i++) await requestLogin(uniqueEmail(), ip2, "parent");
    expect((await requestLogin(uniqueEmail(), ip2, "parent")).status).toBe(429);
  });
});

// ───────────── 5: unlock lifetime ─────────────

describe("unlock lifetime", () => {
  it("5. unlock, idle re-lock, slide up to 60 minutes, /me slides, /lock locks, 14-day absolute session", async () => {
    const p = await parentWithPin();
    const h = await hashOf(p.cookie);
    const set = (unlockedAt: number, until: number | null) =>
      db.prepare("UPDATE sessions SET unlocked_at = ?, unlocked_until = ? WHERE token_hash = ?").bind(unlockedAt, until, h).run();
    const row = () => db.prepare("SELECT unlocked_until, expires_at FROM sessions WHERE token_hash = ?").bind(h).first<{ unlocked_until: number | null; expires_at: number }>();

    // Fresh after setting the PIN.
    expect((await okJson<ParentMeResponse>(await req("/api/parent/me", { cookie: p.cookie }))).unlockedUntil).toBeGreaterThan(Date.now());
    // 5 minutes idle: locked.
    const t = Date.now();
    await set(t - 6 * MIN, t - MIN);
    expect((await errOf(await req("/api/parent/log", { cookie: p.cookie }), 403)).error).toBe("parent_locked");
    expect((await okJson<ParentMeResponse>(await req("/api/parent/me", { cookie: p.cookie }))).unlockedUntil).toBeNull();
    // Unlock again.
    const me = await okJson<ParentMeResponse>(await unlock(p.cookie, PIN));
    expect(me.unlockedUntil).toBeGreaterThan(Date.now() + 4 * MIN);
    // A request 4 minutes after the last one slides it.
    await set(t - 20 * MIN, t + MIN);
    expect((await req("/api/parent/log", { cookie: p.cookie })).status).toBe(200);
    expect((await row())!.unlocked_until!).toBeGreaterThan(Date.now() + 4 * MIN);
    // ...but never past unlocked_at + 60 minutes.
    await set(t - 58 * MIN, t + MIN);
    expect((await req("/api/parent/log", { cookie: p.cookie })).status).toBe(200);
    expect((await row())!.unlocked_until!).toBeLessThanOrEqual(t - 58 * MIN + 60 * MIN);
    await set(t - 61 * MIN, t + 4 * MIN);
    expect((await errOf(await req("/api/parent/log", { cookie: p.cookie }), 403)).error).toBe("parent_locked");
    // /me is the ping.
    await set(t - 10 * MIN, t + MIN);
    await req("/api/parent/me", { cookie: p.cookie });
    expect((await row())!.unlocked_until!).toBeGreaterThan(Date.now() + 4 * MIN);
    // /lock locks, with no body, and is a harmless beacon without a session.
    expect((await req("/api/parent/lock", { method: "POST", cookie: p.cookie })).status).toBe(204);
    expect((await row())!.unlocked_until).toBeNull();
    expect((await req("/api/parent/lock", { method: "POST" })).status).toBe(204);
    // Daily use doesn't extend the 14 days.
    const before = (await row())!.expires_at;
    await unlock(p.cookie, PIN);
    await req("/api/parent/me", { cookie: p.cookie });
    expect((await row())!.expires_at).toBe(before);
    await db.prepare("UPDATE sessions SET expires_at = ? WHERE token_hash = ?").bind(Date.now() - 1, h).run();
    const gone = await req("/api/parent/me", { cookie: p.cookie });
    expect(gone.status).toBe(401);
    expect(parentSetCookie(gone)).toContain("Max-Age=0");
  });

  it("logout ends the parent session only", async () => {
    const email = uniqueEmail();
    const learner = await login(email);
    const p = await parentWithPin(email);
    const out = await req("/api/parent/logout", { method: "POST", cookie: `${learner.cookie}; ${p.cookie}` });
    expect(out.status).toBe(204);
    expect(parentSetCookie(out)).toContain("Max-Age=0");
    expect(sessionSetCookie(out)).toBeUndefined();
    expect((await req("/api/parent/me", { cookie: p.cookie })).status).toBe(401);
    expect((await req("/api/me", { cookie: learner.cookie })).status).toBe(200);
  });
});

// ───────────── 6–8: setting the PIN, lockout, storage ─────────────

describe("PIN", () => {
  it("6a. first set works locked and unlocks; a second set while locked is refused; a set while unlocked is a change", async () => {
    const p = await parentLogin();
    expect((await okJson<ParentMeResponse>(await req("/api/parent/me", { cookie: p.cookie }))).pin).toEqual({ set: false, locked: false });
    expect((await errOf(await unlock(p.cookie, PIN), 409)).error).toBe("pin_not_set");
    expect((await errOf(await setPin(p.cookie, "12a4"), 400)).error).toBe("bad_request");
    expect((await errOf(await setPin(p.cookie, "12345"), 400)).error).toBe("bad_request");
    const me = await okJson<ParentMeResponse>(await setPin(p.cookie, PIN, "America/New_York", { headers: { "User-Agent": IPHONE } }));
    expect(me.pin).toEqual({ set: true, locked: false });
    expect(me.unlockedUntil).toBeGreaterThan(Date.now());
    expect(me.loginEmail).toBe(p.email);

    const notice = mails(p.email, "pin-notice-").at(-1)!;
    expect(notice.subject).toBe("Your parent PIN was changed");
    expect(notice.text).toContain("set for the first time");
    expect(notice.text).toContain("(America/New_York)");
    expect(notice.text).toMatch(/\d{4} at \d{1,2}:\d{2}/);
    expect(notice.text).toContain(`Signed in as: ${p.email}`);
    expect(notice.text).toContain("Device: Safari on iPhone");

    await lockSession(p.cookie);
    expect((await errOf(await setPin(p.cookie, "1357"), 403)).error).toBe("parent_locked");
    await unlock(p.cookie, PIN);
    await okJson(await setPin(p.cookie, "1357", "Not/AZone"));
    expect(mails(p.email, "pin-notice-").at(-1)!.text).toContain("changed in parent mode");
    expect(mails(p.email, "pin-notice-").at(-1)!.text).toContain("(UTC)");
    const entries = (await log(p.cookie)).entries;
    expect(entries.map((e) => e.action)).toEqual(["pin_changed", "pin_set"]);
    expect(entries[1]).toMatchObject({ via: "parent", actorEmail: p.email, actorDevice: IPHONE });
    const sid = await db.prepare("SELECT id FROM sessions WHERE token_hash = ?").bind(await hashOf(p.cookie)).first<{ id: string }>();
    const raw = await db.prepare("SELECT actor_session FROM audit_log WHERE user_id = ? AND action = 'pin_set'").bind(p.user.id).first<{ actor_session: string }>();
    expect(raw!.actor_session).toBe(sid!.id);
  });

  it("6b. a failed notice email leaves the PIN unchanged; other parent sessions' unlocks are cleared", async () => {
    const email = uniqueEmail();
    const a = await parentWithPin(email);
    const b = await parentLogin(email);
    await okJson(await unlock(b.cookie, PIN));
    const before = await db.prepare("SELECT hash, salt FROM account_pins WHERE user_id = ?").bind(a.user.id).first();
    failResend();
    expect((await errOf(await setPin(a.cookie, "1357"), 502)).error).toBe("email_failed");
    expect(await db.prepare("SELECT hash, salt FROM account_pins WHERE user_id = ?").bind(a.user.id).first()).toEqual(before);
    mockTurnstile(true);
    expect((await req("/api/parent/me", { cookie: b.cookie }).then((r) => r.json<ParentMeResponse>())).unlockedUntil).not.toBeNull();
    await okJson(await setPin(a.cookie, "1357"));
    expect((await req("/api/parent/me", { cookie: b.cookie }).then((r) => r.json<ParentMeResponse>())).unlockedUntil).toBeNull();
    expect((await req("/api/parent/me", { cookie: a.cookie }).then((r) => r.json<ParentMeResponse>())).unlockedUntil).not.toBeNull();
    expect((await errOf(await unlock(b.cookie, PIN), 400)).error).toBe("invalid_pin");
    expect((await unlock(b.cookie, "1357")).status).toBe(200);
  });

  it("7a. five wrong tries count down, then lock: one email, one log row, every unlock cleared; the right PIN no longer works", async () => {
    const email = uniqueEmail();
    const p = await parentWithPin(email);
    const other = await parentLogin(email);
    await okJson(await unlock(other.cookie, PIN));
    for (const left of [4, 3, 2, 1]) {
      expect(await errOf(await unlock(p.cookie, "0000"), 400)).toMatchObject({ error: "invalid_pin", attemptsLeft: left });
    }
    expect((await errOf(await unlock(p.cookie, "0000", { headers: { "User-Agent": IPHONE } }), 403)).error).toBe("pin_locked");
    expect((await errOf(await unlock(p.cookie, PIN), 403)).error).toBe("pin_locked");
    const locked = mails(email, "pin-locked-");
    expect(locked).toHaveLength(1);
    expect(locked[0]!.subject).toBe("Your parent PIN was locked");
    expect(locked[0]!.text).toContain("in parent mode");
    expect(locked[0]!.text).toContain("Safari on iPhone");
    expect(locked[0]!.text).toContain("(UTC)");
    const me = await okJson<ParentMeResponse>(await req("/api/parent/me", { cookie: other.cookie }));
    expect(me).toMatchObject({ pin: { set: true, locked: true }, unlockedUntil: null });
    const rows = await db.prepare("SELECT action, via FROM audit_log WHERE user_id = ? AND action = 'pin_locked'").bind(p.user.id).all();
    expect(rows.results).toEqual([{ action: "pin_locked", via: "parent" }]);
    // A locked PIN can't be changed from parent mode either.
    expect((await errOf(await setPin(p.cookie, "1357"), 403)).error).toBe("pin_locked");
  });

  it("7b. a right PIN resets the count; ten parallel wrong unlocks stop at 5", async () => {
    const p = await parentWithPin();
    await errOf(await unlock(p.cookie, "0000"), 400);
    await errOf(await unlock(p.cookie, "0000"), 400);
    await okJson(await unlock(p.cookie, PIN));
    expect((await errOf(await unlock(p.cookie, "0000"), 400)).attemptsLeft).toBe(4);
    await okJson(await unlock(p.cookie, PIN));
    const results = await Promise.all(Array.from({ length: 10 }, () => unlock(p.cookie, "0000")));
    const codes = await Promise.all(results.map(async (r) => (await r.json<ApiError>()).error));
    expect(codes.filter((c) => c === "pin_locked").length).toBeGreaterThanOrEqual(5);
    const row = await db.prepare("SELECT failed, locked_at FROM account_pins WHERE user_id = ?").bind(p.user.id).first<{ failed: number; locked_at: number | null }>();
    expect(row!.failed).toBe(5);
    expect(row!.locked_at).not.toBeNull();
  });

  it("8. no plaintext PIN at rest; the same PIN gives different hashes and salts on two accounts", async () => {
    const a = await parentWithPin();
    const b = await parentWithPin();
    const ra = await db.prepare("SELECT * FROM account_pins WHERE user_id = ?").bind(a.user.id).first<Record<string, unknown>>();
    const rb = await db.prepare("SELECT * FROM account_pins WHERE user_id = ?").bind(b.user.id).first<Record<string, unknown>>();
    expect(Object.values(ra!).map(String).join("|")).not.toContain(PIN);
    expect(ra!.hash).not.toBe(rb!.hash);
    expect(ra!.salt).not.toBe(rb!.salt);
    expect(ra!.iterations).toBe(5000);
    expect(String(ra!.hash)).toMatch(/^[0-9a-f]{64}$/);
    expect(String(ra!.salt)).toMatch(/^[0-9a-f]{32}$/);
  });
});

// ───────────── 9: forgot and reset ─────────────

function resetToken(email: string): string {
  const mail = mails(email, "pin-reset-").at(-1);
  const t = mail ? /#t=([A-Za-z0-9_-]+)/.exec(mail.text)?.[1] : undefined;
  if (!t) throw new Error("no reset email");
  return t;
}

describe("forgot PIN and reset", () => {
  it("9a. from a locked session: lookup only reads; reset sets the PIN, clears the lock and unlocks; the token works once", async () => {
    const p = await parentWithPin();
    for (let i = 0; i < 5; i++) await unlock(p.cookie, "0000");
    const f = await okJson<ForgotPinResponse>(await req("/api/parent/pin/forgot", { method: "POST", cookie: p.cookie }));
    expect(f.sentTo).toMatch(/^.•••@example\.com$/);
    const mail = mails(p.email, "pin-reset-").at(-1)!;
    expect(mail.subject).toBe("Choose a new parent PIN for Mishnah Ba'al Peh");
    const token = resetToken(p.email);
    for (let i = 0; i < 3; i++) {
      const info = await okJson<PinResetInfo>(await req("/api/pin-reset/lookup", { body: { token } }));
      expect(info.email).toMatch(/•••@example\.com$/);
    }
    expect((await db.prepare("SELECT consumed_at FROM pin_resets WHERE token_hash = ?").bind(await sha256(token)).first<{ consumed_at: null }>())!.consumed_at).toBeNull();
    expect((await req("/api/pin-reset", { body: { token, pin: "12" } })).status).toBe(400);
    expect((await req("/api/pin-reset", { body: { token, pin: "4826", tz: "Asia/Jerusalem" } })).status).toBe(204);
    expect(mails(p.email, "pin-notice-").at(-1)!.text).toContain("reset with an email link");
    expect(mails(p.email, "pin-notice-").at(-1)!.text).toContain("(Asia/Jerusalem)");
    expect(mails(p.email, "pin-notice-").at(-1)!.text).not.toContain("Signed in as:");
    const row = await db.prepare("SELECT failed, locked_at FROM account_pins WHERE user_id = ?").bind(p.user.id).first();
    expect(row).toEqual({ failed: 0, locked_at: null });
    expect((await errOf(await req("/api/pin-reset", { body: { token, pin: "1111" } }), 400)).error).toBe("invalid_link");
    expect((await errOf(await req("/api/pin-reset/lookup", { body: { token } }), 400)).error).toBe("invalid_link");
    expect((await okJson<ParentMeResponse>(await unlock(p.cookie, "4826"))).pin.locked).toBe(false);
    const entry = (await log(p.cookie)).entries[0]!;
    expect(entry).toMatchObject({ action: "pin_reset", via: "pin_reset_link", actorEmail: p.email, detail: { requestedVia: "parent" } });
  });

  it("9b. a newer link supersedes an older one; expired links fail; a failed notice leaves the token live; the old PIN works until the reset", async () => {
    const p = await parentWithPin();
    await okJson(await req("/api/parent/pin/forgot", { method: "POST", cookie: p.cookie }));
    const first = resetToken(p.email);
    await okJson(await req("/api/parent/pin/forgot", { method: "POST", cookie: p.cookie }));
    const second = resetToken(p.email);
    expect((await errOf(await req("/api/pin-reset/lookup", { body: { token: first } }), 400)).error).toBe("invalid_link");
    expect((await okJson(await unlock(p.cookie, PIN)))).toBeTruthy();
    failResend();
    expect((await errOf(await req("/api/pin-reset", { body: { token: second, pin: "4826" } }), 502)).error).toBe("email_failed");
    mockTurnstile(true);
    expect((await req("/api/pin-reset/lookup", { body: { token: second } })).status).toBe(200);
    expect((await unlock(p.cookie, PIN)).status).toBe(200);
    await db.prepare("UPDATE pin_resets SET expires_at = ? WHERE token_hash = ?").bind(Date.now() - 1, await sha256(second)).run();
    expect((await errOf(await req("/api/pin-reset", { body: { token: second, pin: "4826" } }), 400)).error).toBe("invalid_link");
    // A 4th forgot in an hour is refused.
    await okJson(await req("/api/parent/pin/forgot", { method: "POST", cookie: p.cookie }));
    expect((await errOf(await req("/api/parent/pin/forgot", { method: "POST", cookie: p.cookie }), 429)).error).toBe("rate_limited");
  });

  it("9c. the daily cap is 6", async () => {
    const p = await parentWithPin();
    // Clear the hourly bucket after every 3, so only the daily one counts.
    for (let i = 0; i < 6; i++) {
      expect((await req("/api/parent/pin/forgot", { method: "POST", cookie: p.cookie })).status).toBe(200);
      if (i % 3 === 2) await db.prepare("DELETE FROM rate_limits WHERE key = ?").bind(await rlKey("pin-forgot", p.user.id)).run();
    }
    expect((await errOf(await req("/api/parent/pin/forgot", { method: "POST", cookie: p.cookie }), 429)).error).toBe("rate_limited");
  });

  it("9d. forgot with no PIN yet is 409", async () => {
    const p = await parentLogin();
    expect((await errOf(await req("/api/parent/pin/forgot", { method: "POST", cookie: p.cookie }), 409)).error).toBe("pin_not_set");
  });
});

// ───────────── 10: perek-test confirm with a PIN ─────────────

async function requestPerekTest(learnerCookie: string, email: string, childId: string, perek = 1): Promise<string> {
  await okJson(await req("/api/perek-tests", { cookie: learnerCookie, body: { childId, masechta: M, perek } }));
  const mail = sentEmails.filter((m) => m.to === email && m.idempotencyKey?.startsWith("perek-test-")).at(-1)!;
  return /#t=([A-Za-z0-9_-]+)/.exec(mail.text)![1]!;
}
const confirm = (token: string, pin?: string) => req("/api/perek-tests/confirm", { body: { token, ...(pin ? { pin } : {}) } });

describe("perek-test confirm with a PIN", () => {
  it("10a. no PIN: confirm works as before and logs pinUsed false", async () => {
    const email = uniqueEmail();
    const l = await login(email);
    const admin = await adminCookie(email);
    const cid = await addChildAs(admin);
    const token = await requestPerekTest(l.cookie, email, cid);
    const info = await okJson<PerekTestInfo>(await req("/api/perek-tests/lookup", { body: { token } }));
    expect(info).toMatchObject({ pinRequired: false, pinLocked: false });
    expect((await okJson<PerekTestInfo>(await confirm(token))).status).toBe("verified");
    const entry = (await log(admin)).entries.find((e) => e.action === "perek_verified")!;
    expect(entry).toMatchObject({ via: "test_link", actorEmail: email, childName: "Avi", detail: { masechta: M, perakim: [1], pinUsed: false } });
  });

  it("10b. with a PIN: pin_required, invalid_pin, then verified and logged; shared counter with unlock; bad links use no tries", async () => {
    const email = uniqueEmail();
    const l = await login(email);
    const p = await parentWithPin(email);
    const cid = await addChildAs(p.cookie);
    const token = await requestPerekTest(l.cookie, email, cid);
    expect(await okJson<PerekTestInfo>(await req("/api/perek-tests/lookup", { body: { token } }))).toMatchObject({ pinRequired: true, pinLocked: false, status: "pending" });
    expect((await errOf(await confirm(token), 400)).error).toBe("pin_required");
    expect(await errOf(await confirm(token, "0000"), 400)).toMatchObject({ error: "invalid_pin", attemptsLeft: 4 });
    expect(await errOf(await unlock(p.cookie, "0000"), 400)).toMatchObject({ attemptsLeft: 3 });
    // An unknown token uses no tries.
    expect((await errOf(await confirm("x".repeat(43), "0000"), 400)).error).toBe("invalid_link");
    const ok = await okJson<PerekTestInfo>(await confirm(token, PIN));
    expect(ok.status).toBe("verified");
    expect((await db.prepare("SELECT failed FROM account_pins WHERE user_id = ?").bind(p.user.id).first<{ failed: number }>())!.failed).toBe(0);
    // Re-confirming a verified link needs no PIN.
    expect((await okJson<PerekTestInfo>(await confirm(token))).status).toBe("verified");
    await unlock(p.cookie, PIN);
    const entries = (await log(p.cookie)).entries.filter((e) => e.action === "perek_verified");
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ via: "test_link", detail: { masechta: M, perakim: [1], pinUsed: true } });
    expect(typeof entries[0]!.detail.testId).toBe("string");
  });

  it("10c. lock from the test page; forgot-pin from a pending test link; then the link still works", async () => {
    const email = uniqueEmail();
    const l = await login(email);
    const p = await parentWithPin(email);
    const cid = await addChildAs(p.cookie);
    const token = await requestPerekTest(l.cookie, email, cid);
    for (let i = 0; i < 4; i++) await errOf(await confirm(token, "0000"), 400);
    expect((await errOf(await confirm(token, "0000"), 403)).error).toBe("pin_locked");
    expect(mails(email, "pin-locked-").at(-1)!.text).toContain("on a perek test page");
    expect(await okJson<PerekTestInfo>(await req("/api/perek-tests/lookup", { body: { token } }))).toMatchObject({ pinLocked: true });
    expect((await errOf(await confirm(token, PIN), 403)).error).toBe("pin_locked");
    const f = await okJson<ForgotPinResponse>(await req("/api/perek-tests/forgot-pin", { body: { token } }));
    expect(f.sentTo).toContain("•••@example.com");
    expect((await req("/api/pin-reset", { body: { token: resetToken(email), pin: "4826" } })).status).toBe(204);
    expect((await okJson<PerekTestInfo>(await confirm(token, "4826"))).status).toBe("verified");
    expect((await errOf(await req("/api/perek-tests/forgot-pin", { body: { token } }), 400)).error).toBe("invalid_link");
    await unlock(p.cookie, "4826");
    const actions = (await log(p.cookie)).entries.map((e) => [e.action, e.via]);
    expect(actions).toEqual([
      ["perek_verified", "test_link"],
      ["pin_reset", "pin_reset_link"],
      ["pin_locked", "test_link"],
      ["child_added", "parent"],
      ["pin_set", "parent"],
    ]);
  });
});

// ───────────── 11: verifications endpoint ─────────────

describe("POST /api/parent/children/:id/verifications", () => {
  const setV = (cookie: string, childId: string, body: unknown) => req(`/api/parent/children/${childId}/verifications`, { cookie, body });

  it("11a. verify and un-verify bump rev, reach learners, settle links, and log the actor", async () => {
    const email = uniqueEmail();
    const l = await login(email);
    const p = await parentWithPin(email);
    const cid = await addChildAs(p.cookie, { meta: meta({ name: "Dina" }) });
    const { cursor } = await okJson<SyncResponse>(await sync(l.cookie, {}));
    const token = await requestPerekTest(l.cookie, email, cid, 1);
    const v = await okJson<SetVerificationsResponse>(await setV(p.cookie, cid, { masechta: M, perakim: [2, 1], verified: true }));
    expect(v.verifications.map((r) => [r.perek, r.verified])).toEqual([[1, true], [2, true]]);
    expect((await db.prepare("SELECT outcome FROM perek_tests WHERE token_hash = ?").bind(await sha256(token)).first<{ outcome: string }>())!.outcome).toBe("covered");
    const pulled = await okJson<SyncResponse>(await sync(l.cookie, { cursor }));
    expect(pulled.verifications!.map((r) => r.perek).sort()).toEqual([1, 2]);

    // A live link for perek 3, then an un-verify of 2 revokes nothing of 3; an un-verify of 3 revokes its link.
    await db.prepare("UPDATE perek_tests SET created_at = created_at - 700000 WHERE child_id = ?").bind(cid).run();
    const t3 = await requestPerekTest(l.cookie, email, cid, 3);
    const un = await okJson<SetVerificationsResponse>(await setV(p.cookie, cid, { masechta: M, perakim: [3], verified: false }));
    expect(un.verifications).toEqual([expect.objectContaining({ perek: 3, verified: false })]);
    expect((await db.prepare("SELECT outcome FROM perek_tests WHERE token_hash = ?").bind(await sha256(t3)).first<{ outcome: string }>())!.outcome).toBe("revoked");
    await okJson(await setV(p.cookie, cid, { masechta: M, perakim: [2], verified: false }));
    const again = await okJson<SyncResponse>(await sync(l.cookie, { cursor: pulled.cursor }));
    expect(again.verifications!.find((r) => r.perek === 2)).toMatchObject({ verified: false });

    const entries = (await log(p.cookie)).entries.filter((e) => e.action.startsWith("perek_"));
    expect(entries.map((e) => [e.action, e.detail.perakim])).toEqual([
      ["perek_unverified", [2]],
      ["perek_unverified", [3]],
      ["perek_verified", [1, 2]],
    ]);
    expect(entries[2]).toMatchObject({ via: "parent", childName: "Dina", actorEmail: email });
    const raw = await db.prepare("SELECT actor_session FROM audit_log WHERE user_id = ? AND action = 'perek_verified'").bind(p.user.id).first<{ actor_session: string | null }>();
    expect(raw!.actor_session).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("11b. 404 for another account's child and a deleted child; 400 for bad bodies; 429 after 120 an hour", async () => {
    const a = await parentWithPin();
    const b = await parentWithPin();
    const theirs = await addChildAs(b.cookie);
    expect((await errOf(await setV(a.cookie, theirs, { masechta: M, perakim: [1], verified: true }), 404)).error).toBe("not_found");
    const mine = await addChildAs(a.cookie);
    for (const body of [
      { masechta: M, perakim: [10], verified: true },
      { masechta: M, perakim: [], verified: true },
      { masechta: M, perakim: [1, 1], verified: true },
      { masechta: "nope", perakim: [1], verified: true },
      { masechta: M, perakim: [1], verified: "yes" },
    ]) {
      expect((await errOf(await setV(a.cookie, mine, body), 400)).error).toBe("bad_request");
    }
    await okJson(await parentSync(a.cookie, { children: [child(mine, Date.now(), { deleted: true })] }));
    expect((await errOf(await setV(a.cookie, mine, { masechta: M, perakim: [1], verified: true }), 404)).error).toBe("not_found");
    const live = await addChildAs(a.cookie);
    await okJson(await setV(a.cookie, live, { masechta: M, perakim: [1], verified: true }));
    await db.prepare("UPDATE rate_limits SET count = 120 WHERE key = ?").bind(await rlKey("verif", a.user.id)).run();
    expect((await errOf(await setV(a.cookie, live, { masechta: M, perakim: [1], verified: true }), 429)).error).toBe("rate_limited");
  });
});

// ───────────── 12–14: sync roles and the fence ─────────────

const rec = (r: RecordRow[], k: string) => r.find((x) => `${x.kind}:${x.key}` === k);

describe("learner sync is narrowed", () => {
  it("12. new ids, deletes and renames are ignored; fontScale and meaningView merge; breakMinutes doesn't", async () => {
    const email = uniqueEmail();
    const l = await login(email);
    const p = await parentWithPin(email);
    const cid = await addChildAs(p.cookie, { meta: meta({ name: "Avi", settings: { fontScale: 1, breakMinutes: 20 } }) });
    const { cursor } = await okJson<SyncResponse>(await sync(l.cookie, {}));
    const t = Date.now();
    await okJson(await sync(l.cookie, { records: [mRec(cid, "1:1", t, 3)], events: [recite(cid, t)] }));
    await db.batch([
      db.prepare(
        `INSERT INTO perek_verifications (child_id, user_id, masechta, perek, verified, verified_at, source, test_id, updated_at, rev)
         VALUES (?1, ?2, 'berakhot', 1, 1, ?3, 'admin', NULL, ?3, 0)`,
      ).bind(cid, p.user.id, t),
    ]);

    const newId = crypto.randomUUID();
    const res = await okJson<SyncResponse>(
      await sync(l.cookie, {
        cursor,
        children: [
          child(newId, t),
          child(cid, t + 5, { meta: meta({ name: "Hacked", settings: { fontScale: 1.4, breakMinutes: 90, meaningView: "steinsaltz" } }) }),
        ],
      }),
    );
    expect(await db.prepare("SELECT 1 FROM children WHERE id = ?").bind(newId).first()).toBeNull();
    const back = res.children.find((c) => c.id === cid)!;
    expect(back.meta.name).toBe("Avi");
    expect(back.meta.settings).toEqual({ fontScale: 1.4, breakMinutes: 20, meaningView: "steinsaltz" });

    const del = await okJson<SyncResponse>(await sync(l.cookie, { cursor: res.cursor, children: [child(cid, t + 9, { deleted: true })] }));
    expect(del.children).toEqual([expect.objectContaining({ id: cid, deleted: false })]);
    expect(rec(del.records, "m:1:1")).toMatchObject({ data: { stepIndex: 3 } });
    expect(del.verifications).toEqual([expect.objectContaining({ childId: cid, perek: 1, verified: true })]);
    expect((await db.prepare("SELECT deleted FROM children WHERE id = ?").bind(cid).first<{ deleted: number }>())!.deleted).toBe(0);
    expect((await db.prepare("SELECT count(*) AS n FROM events WHERE child_id = ?").bind(cid).first<{ n: number }>())!.n).toBe(1);
  });
});

describe("parent sync", () => {
  it("13a. stamps server time and parent_rev, replaces chains, returns byParent, and logs every change", async () => {
    const p = await parentWithPin();
    const cid = crypto.randomUUID();
    const t = Date.now() - 5 * DAY;
    const imported = await okJson<SyncResponse>(
      await parentSync(p.cookie, {
        children: [child(cid, t, { meta: meta({ name: "Avi" }) })],
        records: [mRec(cid, "1:1", t, 5), { kind: "p", childId: cid, key: "1", updatedAt: t, data: { chainedThrough: 3, complete: false, chains: ["1-3"] } }],
      }),
    );
    expect(imported.children[0]).toMatchObject({ id: cid, byParent: true });
    expect(imported.children[0]!.updatedAt).toBe(imported.serverTime);
    expect(rec(imported.records, "m:1:1")).toMatchObject({ byParent: true, updatedAt: imported.serverTime });
    const row = await db.prepare("SELECT updated_at, rev, parent_rev FROM progress WHERE child_id = ? AND kind = 'm'").bind(cid).first<{ updated_at: number; rev: number; parent_rev: number }>();
    expect(row!.parent_rev).toBe(row!.rev);
    expect(row!.rev).toBe(imported.cursor);

    const reset = await okJson<SyncResponse>(
      await parentSync(p.cookie, {
        cursor: imported.cursor,
        children: [child(cid, t, { meta: meta({ name: "Avraham", settings: { fontScale: 1.2 } }) })],
        records: [
          { kind: "m", childId: cid, key: "1:1", updatedAt: t, data: { stepIndex: 0, state: "new", fails: {} } },
          { kind: "p", childId: cid, key: "1", updatedAt: t, data: { chainedThrough: 0, complete: false, chains: [] } },
        ],
      }),
    );
    expect(rec(reset.records, "p:1")!.data).toEqual({ chainedThrough: 0, complete: false, chains: [] });
    // A sort-only change is not logged.
    await okJson(await parentSync(p.cookie, { children: [child(cid, t, { meta: meta({ name: "Avraham", settings: { fontScale: 1.2 }, sort: 3 }) })] }));
    await okJson(await parentSync(p.cookie, { children: [child(cid, t, { deleted: true })] }));

    const entries = (await log(p.cookie)).entries;
    // Rows of one batch share `at`, so their order among themselves is not defined.
    expect(entries.map((e) => e.action).sort()).toEqual(["child_added", "child_edited", "child_removed", "pin_set", "progress_edited"]);
    expect(entries[0]!.action === "child_removed" && entries.at(-1)!.action === "pin_set").toBe(true);
    const by = (a: string) => entries.find((e) => e.action === a)!;
    expect(by("child_removed")).toMatchObject({ childName: "Avraham", childId: cid });
    expect(by("progress_edited").detail).toEqual({ keys: ["m:1:1", "p:1"], count: 2 });
    expect(by("child_edited").detail).toEqual({ fields: ["name", "settings.fontScale"], from: { name: "Avi" }, to: { name: "Avraham" } });
    expect(by("child_added").detail).toEqual({ imported: true, rows: 2 });
    expect(by("child_added")).toMatchObject({ actorEmail: p.email, via: "parent" });
  });

  it("13b. a plain add is not 'imported'; an import over 500 rows works across two calls; the cap holds", async () => {
    const p = await parentWithPin();
    const cid = crypto.randomUUID();
    const t = Date.now();
    await okJson(await parentSync(p.cookie, { children: [child(cid, t)] }));
    expect((await log(p.cookie)).entries[0]!.detail).toEqual({ imported: false, rows: 0 });
    const keys = Array.from({ length: 700 }, (_, i) => mRec(cid, `${1 + Math.floor(i / 99)}:${(i % 99) + 1}`, t));
    await okJson(await parentSync(p.cookie, { records: keys.slice(0, 450) }));
    await okJson(await parentSync(p.cookie, { records: keys.slice(450) }));
    expect((await db.prepare("SELECT count(*) AS n FROM progress WHERE child_id = ?").bind(cid).first<{ n: number }>())!.n).toBe(700);
    const edited = (await log(p.cookie)).entries.filter((e) => e.action === "progress_edited");
    expect(edited[1]!.detail).toMatchObject({ count: 450 });
    expect((edited[1]!.detail.keys as string[]).length).toBe(60);
  });
});

describe("the fence", () => {
  it("14a. a stale learner push loses to the parent's edit whatever its clock; after pulling, the learner wins even with a slow clock", async () => {
    const email = uniqueEmail();
    const l = await login(email);
    const p = await parentWithPin(email);
    const cid = await addChildAs(p.cookie);
    const t = Date.now();
    const start = await okJson<SyncResponse>(await sync(l.cookie, { records: [mRec(cid, "2:3", t - 1000, 4)] }));
    // The parent marks 2:3 not known (R).
    const edit = await okJson<SyncResponse>(await parentSync(p.cookie, { records: [{ kind: "m", childId: cid, key: "2:3", updatedAt: t, data: { stepIndex: 0, state: "new", fails: {} } }] }));
    // The offline tablet (cursor < R) pushes practice from a clock far in the future: refused, the parent's row comes back.
    const stale = await okJson<SyncResponse>(await sync(l.cookie, { cursor: start.cursor, records: [mRec(cid, "2:3", t + 365 * DAY, 9)] }));
    expect(rec(stale.records, "m:2:3")).toMatchObject({ byParent: true, data: { stepIndex: 0, state: "new" } });
    // Having pulled (cursor >= R), its next learning wins even with a clock behind the parent's server time.
    const fresh = await okJson<SyncResponse>(await sync(l.cookie, { cursor: stale.cursor, records: [mRec(cid, "2:3", t - DAY, 1)] }));
    const won = rec(fresh.records, "m:2:3")!;
    expect(won).toMatchObject({ data: { stepIndex: 1 } });
    expect(won.byParent).toBeUndefined();
    expect(edit.cursor).toBeLessThanOrEqual(stale.cursor);
    // Then plain LWW: an older write loses.
    const older = await okJson<SyncResponse>(await sync(l.cookie, { cursor: fresh.cursor, records: [mRec(cid, "2:3", t - 2 * DAY, 7)] }));
    expect(rec(older.records, "m:2:3")).toMatchObject({ data: { stepIndex: 1 } });
    // Other keys are not fenced.
    const other = await okJson<SyncResponse>(await sync(l.cookie, { cursor: start.cursor, records: [mRec(cid, "2:4", t, 2)] }));
    expect(rec(other.records, "m:2:4")).toMatchObject({ data: { stepIndex: 2 } });
  });

  it("14b. the child-settings merge is fenced the same way", async () => {
    const email = uniqueEmail();
    const l = await login(email);
    const p = await parentWithPin(email);
    const cid = crypto.randomUUID();
    const start = await okJson<SyncResponse>(await sync(l.cookie, {}));
    await okJson(await parentSync(p.cookie, { children: [child(cid, Date.now(), { meta: meta({ settings: { fontScale: 1.3 } }) })] }));
    const stale = await okJson<SyncResponse>(await sync(l.cookie, { cursor: start.cursor, children: [child(cid, Date.now() + DAY, { meta: meta({ settings: { fontScale: 0.8 } }) })] }));
    expect(stale.children.find((c) => c.id === cid)).toMatchObject({ byParent: true, meta: { settings: { fontScale: 1.3 } } });
    const ok = await okJson<SyncResponse>(await sync(l.cookie, { cursor: stale.cursor, children: [child(cid, Date.now() - DAY, { meta: meta({ settings: { fontScale: 0.9 } }) })] }));
    const row = ok.children.find((c) => c.id === cid)!;
    expect(row.meta.settings.fontScale).toBe(0.9);
    expect(row.byParent).toBeUndefined();
  });
});

// ───────────── 15, 17, 18, 19 ─────────────

describe("change log", () => {
  it("15. newest first, paginated, limited to the account, bad limits refused", async () => {
    const p = await parentWithPin();
    const other = await parentWithPin();
    for (let i = 0; i < 4; i++) await addChildAs(p.cookie, { meta: meta({ name: `K${i}` }) });
    const seen: string[] = [];
    let before: number | null = null;
    let pages = 0;
    do {
      const page: AuditLogResponse = await log(p.cookie, before === null ? "?limit=2" : `?limit=2&before=${before}`);
      seen.push(...page.entries.map((e) => e.childName ?? e.action));
      before = page.nextBefore;
      pages++;
    } while (before !== null && pages < 10);
    expect(seen.slice(-1)).toEqual(["pin_set"]);
    expect(new Set(seen.slice(0, 4))).toEqual(new Set(["K0", "K1", "K2", "K3"]));
    expect((await log(other.cookie)).entries.map((e) => e.action)).toEqual(["pin_set"]);
    // A page never ends inside one batch's millisecond (an import of 3 children, 2 per page).
    const t = Date.now();
    await okJson(await parentSync(other.cookie, { children: [0, 1, 2].map((i) => child(crypto.randomUUID(), t, { meta: meta({ name: `I${i}`, sort: i }) })) }));
    const first = await log(other.cookie, "?limit=2");
    expect(first.entries.map((e) => e.action)).toEqual(["child_added", "child_added", "child_added"]);
    expect((await log(other.cookie, `?limit=2&before=${first.nextBefore}`)).entries.map((e) => e.action)).toEqual(["pin_set"]);
    for (const q of ["?limit=0", "?limit=101", "?limit=x", "?before=-1"]) {
      expect((await errOf(await req(`/api/parent/log${q}`, { cookie: p.cookie }), 400)).error).toBe("bad_request");
    }
  });
});

describe("cleanup", () => {
  it("17. prunes old log rows and reset links a day past expiry", async () => {
    const p = await parentWithPin();
    const now = Date.now();
    await db.batch([
      db.prepare("INSERT INTO audit_log (id, user_id, at, action, via) VALUES (?, ?, ?, 'pin_set', 'parent')").bind(`old-${p.user.id}`, p.user.id, now - 366 * DAY),
      db.prepare("INSERT INTO audit_log (id, user_id, at, action, via) VALUES (?, ?, ?, 'pin_set', 'parent')").bind(`new-${p.user.id}`, p.user.id, now - 300 * DAY),
      db.prepare("INSERT INTO pin_resets (id, user_id, email, token_hash, created_at, expires_at, requested_via) VALUES (?, ?, 'a@b.cd', ?, ?, ?, 'parent')").bind(`ro-${p.user.id}`, p.user.id, `h1-${p.user.id}`, now, now - 2 * DAY),
      db.prepare("INSERT INTO pin_resets (id, user_id, email, token_hash, created_at, expires_at, requested_via) VALUES (?, ?, 'a@b.cd', ?, ?, ?, 'parent')").bind(`rn-${p.user.id}`, p.user.id, `h2-${p.user.id}`, now, now - 60_000),
    ]);
    await cleanup({ DB: db }, now);
    const has = async (sql: string, v: string) => (await db.prepare(sql).bind(v).first()) !== null;
    expect(await has("SELECT 1 FROM audit_log WHERE id = ?", `old-${p.user.id}`)).toBe(false);
    expect(await has("SELECT 1 FROM audit_log WHERE id = ?", `new-${p.user.id}`)).toBe(true);
    expect(await has("SELECT 1 FROM pin_resets WHERE id = ?", `ro-${p.user.id}`)).toBe(false);
    expect(await has("SELECT 1 FROM pin_resets WHERE id = ?", `rn-${p.user.id}`)).toBe(true);
  });
});

describe("emails", () => {
  it("18. parent-mode copy never uses fun, game or play wording", () => {
    const at = Date.UTC(2026, 10, 6, 21, 41);
    const all = [
      loginEmail("https://x.test/auth/verify#token=abc&as=parent", "123456", "parent"),
      pinResetEmail({ email: "a@b.cd", link: "https://x.test/parent-pin#t=abc" }),
      ...(["set", "changed", "reset"] as const).map((kind) =>
        pinNoticeEmail({ accountEmail: "a@b.cd", kind, at, tz: "America/New_York", loginEmail: "a@b.cd", userAgent: IPHONE, appOrigin: "https://x.test" }),
      ),
      pinLockedEmail({ at, tz: undefined, where: "test_page", userAgent: "", appOrigin: "https://x.test" }),
    ];
    for (const e of all) for (const s of [e.subject, e.text, e.html]) expect(s).not.toMatch(/\b(fun|game|games|play|playing)\b/i);
    expect(all[2]!.text).toContain("Friday, November 6, 2026 at 4:41 PM (America/New_York)");
    expect(all[5]!.text).toContain("Friday, November 6, 2026 at 9:41 PM (UTC)");
    expect(all[0]!.html).toContain("Sign in as parent");
    expect(all[0]!.html).not.toContain("<script");
  });

  it("deviceLabel", () => {
    expect(deviceLabel(IPHONE)).toBe("Safari on iPhone");
    expect(deviceLabel("Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36")).toBe("Chrome on Android");
    expect(deviceLabel("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36")).toBe("Chrome on Windows");
    expect(deviceLabel("")).toBe("a browser");
    expect(deviceLabel(null)).toBe("a browser");
  });
});

describe("learner session from parent mode", () => {
  it("19. while unlocked it sets a learner cookie that works on /api/me; locked it is refused", async () => {
    const p = await parentWithPin();
    const res = await req("/api/parent/learner-session", { method: "POST", cookie: p.cookie });
    expect(res.status).toBe(200);
    const learner = cookieOf(res)!;
    expect(learner).toMatch(/^__Host-bp_session=/);
    expect(parentCookieOf(res)).toBeNull();
    expect((await okJson<{ user: { id: string } }>(await req("/api/me", { cookie: learner }))).user.id).toBe(p.user.id);
    const s = await db.prepare("SELECT scope, login_email FROM sessions WHERE token_hash = ?").bind(await hashOf(learner)).first();
    expect(s).toEqual({ scope: "learner", login_email: p.email });
    // A second call replaces this device's learner session.
    const again = await req("/api/parent/learner-session", { method: "POST", cookie: `${learner}; ${p.cookie}` });
    expect(again.status).toBe(200);
    expect((await req("/api/me", { cookie: learner })).status).toBe(401);
    await lockSession(p.cookie);
    expect((await errOf(await req("/api/parent/learner-session", { method: "POST", cookie: p.cookie }), 403)).error).toBe("parent_locked");
  });
});

import { Hono, type Context } from "hono";
import { AUTH, type AuthRequestResponse, type AuthSuccessResponse, type SignInAs } from "../../shared/api";
import type { AppEnv } from "../env";
import { loginEmail } from "../email/loginEmail";
import { pickSender } from "../email/sender";
import { hmacHex, randomCode, randomToken, safeEqualHex, sha256Hex } from "../lib/crypto";
import { apiError, clientIp, readJson } from "../lib/http";
import { limit } from "../lib/rateLimit";
import { clearSession, createSession, sessionHashOf } from "../lib/session";
import { now } from "../lib/time";
import { verifyTurnstile } from "../lib/turnstile";
import { validateAuthRequest, validateVerifyCode, validateVerifyLink } from "../lib/validate";

const LOGIN_TTL_MS = AUTH.LOGIN_TTL_SEC * 1000;

export const authRoutes = new Hono<AppEnv>();

function codeHash(secret: string, requestId: string, code: string): Promise<string> {
  return hmacHex(secret, "code:" + requestId + ":" + code);
}

/**
 * §3.4: upsert the user, create a session of the login request's scope, respond. The scope comes from the stored
 * request (docs/PARENT_MODE.md §6.2), never from the verifying client; the other scope's cookie is not touched.
 */
async function finishLogin(c: Context<AppEnv>, email: string, t: number, scope: SignInAs): Promise<Response> {
  const user = await c.env.DB.prepare(
    `INSERT INTO users (id, email, created_at, last_login_at, rev) VALUES (?1, ?2, ?3, ?3, 0)
     ON CONFLICT(email) DO UPDATE SET last_login_at = excluded.last_login_at
     RETURNING id, email, created_at`,
  )
    .bind(crypto.randomUUID(), email, t)
    .first<{ id: string; email: string; created_at: number }>();
  if (!user) throw new Error("user upsert returned no row");
  await createSession(c, user.id, scope, email);
  const body: AuthSuccessResponse = {
    user: { id: user.id, email: user.email, createdAt: user.created_at },
    newUser: user.created_at === t,
    scope,
  };
  return c.json(body, 200);
}

authRoutes.post("/request", async (c) => {
  const v = validateAuthRequest(await readJson(c));
  if (!v.ok) return apiError(c, 400, "bad_request", v.message);
  const { email, turnstileToken, as: scope } = v.value;
  const ip = clientIp(c);
  const t = now();

  await limit(c, "req-ip", ip, 10, 3600, t);
  // Turnstile before the per-email limit, so a bot that can't pass it can't use up a parent's email quota.
  if (!(await verifyTurnstile(c.env, turnstileToken, ip))) {
    return apiError(c, 400, "turnstile_failed", "Bot check failed. Please try again.");
  }
  await limit(c, scope === "parent" ? "req-email-parent" : "req-email", email, 5, 3600, t);

  const id = crypto.randomUUID();
  const token = randomToken();
  const code = randomCode();
  const db = c.env.DB;
  await db.batch([
    // Supersede only the same scope: a child asking for a learner link doesn't kill the parent's link.
    db
      .prepare("UPDATE login_requests SET consumed_at = ?1 WHERE email = ?2 AND scope = ?3 AND consumed_at IS NULL")
      .bind(t, email, scope),
    db
      .prepare(
        `INSERT INTO login_requests (id, email, token_hash, code_hash, created_at, expires_at, attempts, ip_hash, scope)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, 0, ?7, ?8)`,
      )
      .bind(
        id,
        email,
        await sha256Hex(token),
        await codeHash(c.env.AUTH_SECRET, id, code),
        t,
        t + LOGIN_TTL_MS,
        await hmacHex(c.env.AUTH_SECRET, "ip:" + ip),
        scope,
      ),
  ]);

  // `&as=parent` is a display hint for the landing page only; the stored scope decides the session.
  const link = `${c.env.APP_ORIGIN}/auth/verify#token=${token}${scope === "parent" ? "&as=parent" : ""}`;
  const content = loginEmail(link, code, scope);
  try {
    await pickSender(c.env).send({ to: email, ...content, idempotencyKey: "login-" + id });
  } catch {
    return apiError(c, 502, "email_failed", "The sign-in email could not be sent. Please try again later.");
  }

  const body: AuthRequestResponse = { ok: true, expiresInSec: AUTH.LOGIN_TTL_SEC };
  return c.json(body, 200);
});

authRoutes.post("/verify-link", async (c) => {
  const v = validateVerifyLink(await readJson(c));
  if (!v.ok) return apiError(c, 400, "bad_request", v.message);
  const t = now();
  await limit(c, "link-ip", clientIp(c), 20, 900, t);

  const row = await c.env.DB.prepare(
    `UPDATE login_requests SET consumed_at = ?1
     WHERE token_hash = ?2 AND consumed_at IS NULL AND expires_at > ?1
     RETURNING email, scope`,
  )
    .bind(t, await sha256Hex(v.value.token))
    .first<{ email: string; scope: SignInAs }>();
  if (!row) return apiError(c, 400, "invalid_link", "This sign-in link is invalid or has expired.");
  return finishLogin(c, row.email, t, row.scope);
});

authRoutes.post("/verify-code", async (c) => {
  const v = validateVerifyCode(await readJson(c));
  if (!v.ok) return apiError(c, 400, "bad_request", v.message);
  const { email, code, as: scope } = v.value;
  const t = now();
  await limit(c, "code-ip", clientIp(c), 20, 900, t);
  await limit(c, "code-email", email, 10, 3600, t);

  const db = c.env.DB;
  const req = await db
    .prepare(
      `SELECT id, code_hash, attempts FROM login_requests
       WHERE email = ?1 AND scope = ?3 AND consumed_at IS NULL AND expires_at > ?2
       ORDER BY created_at DESC LIMIT 1`,
    )
    .bind(email, t, scope)
    .first<{ id: string; code_hash: string; attempts: number }>();
  if (!req) return apiError(c, 400, "invalid_code", "That code is wrong or has expired.");

  const lockout = async (): Promise<Response> => {
    await db.prepare("UPDATE login_requests SET consumed_at = ?1 WHERE id = ?2 AND consumed_at IS NULL").bind(t, req.id).run();
    return apiError(c, 400, "too_many_attempts", "Too many wrong codes. Request a new email.");
  };
  if (req.attempts >= AUTH.MAX_CODE_ATTEMPTS) return lockout();

  if (!(await safeEqualHex(await codeHash(c.env.AUTH_SECRET, req.id, code), req.code_hash))) {
    const upd = await db
      .prepare("UPDATE login_requests SET attempts = attempts + 1 WHERE id = ?1 AND consumed_at IS NULL RETURNING attempts")
      .bind(req.id)
      .first<{ attempts: number }>();
    if (!upd) return apiError(c, 400, "invalid_code", "That code is wrong or has expired.");
    if (upd.attempts >= AUTH.MAX_CODE_ATTEMPTS) return lockout();
    return apiError(c, 400, "invalid_code", "That code is wrong.", {
      attemptsLeft: AUTH.MAX_CODE_ATTEMPTS - upd.attempts,
    });
  }

  const consumed = await db
    .prepare("UPDATE login_requests SET consumed_at = ?1 WHERE id = ?2 AND consumed_at IS NULL RETURNING email, scope")
    .bind(t, req.id)
    .first<{ email: string; scope: SignInAs }>();
  if (!consumed) return apiError(c, 400, "invalid_code", "That code is wrong or has expired.");
  return finishLogin(c, consumed.email, t, consumed.scope);
});

/** Ends the learner session only (the parent session has POST /api/parent/logout). */
authRoutes.post("/logout", async (c) => {
  const hash = await sessionHashOf(c);
  if (hash) await c.env.DB.prepare("DELETE FROM sessions WHERE token_hash = ?1 AND scope = 'learner'").bind(hash).run();
  clearSession(c);
  return c.body(null, 204);
});

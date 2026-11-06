/**
 * Sessions (docs/SERVER_PLAN.md §3.8, docs/PARENT_MODE.md §6.1). Two independent scopes, each with its own cookie:
 * - learner: `__Host-bp_session`, 30 days sliding; read only by requireUser.
 * - parent:  `__Host-bp_parent`, 14 days absolute; read only by requireParentSession / requireParent, and usable for
 *   parent powers only while unlocked by the PIN (5 min idle, 60 min at most).
 * `sessions.scope` is written by the INSERT in createSession and never updated: no statement anywhere changes it, so
 * a learner session can never become a parent session.
 */
import type { Context, MiddlewareHandler } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import type { CookieOptions } from "hono/utils/cookie";
import { AUTH, PARENT, type SignInAs } from "../../shared/api";
import type { AppEnv, Env, ParentVars } from "../env";
import { randomToken, sha256Hex } from "./crypto";
import { apiError } from "./http";
import { now } from "./time";

const SESSION_MS = AUTH.SESSION_TTL_SEC * 1000;
const PARENT_SESSION_MS = PARENT.SESSION_TTL_SEC * 1000;
const REFRESH_EVERY_MS = 5 * 60 * 1000;
export const UNLOCK_IDLE_MS = PARENT.UNLOCK_IDLE_SEC * 1000;
export const UNLOCK_MAX_MS = PARENT.UNLOCK_MAX_SEC * 1000;
/** The unlock window is rewritten at most this often (it slides on every parent request). */
const SLIDE_EVERY_MS = 30 * 1000;

export function isHttps(env: Pick<Env, "APP_ORIGIN">): boolean {
  return env.APP_ORIGIN.startsWith("https://");
}

export function cookieName(env: Pick<Env, "APP_ORIGIN">): string {
  return isHttps(env) ? "__Host-bp_session" : "bp_session";
}

export function parentCookieName(env: Pick<Env, "APP_ORIGIN">): string {
  return isHttps(env) ? "__Host-bp_parent" : "bp_parent";
}

export function cookieOptions(env: Pick<Env, "APP_ORIGIN">, maxAge: number = AUTH.SESSION_TTL_SEC): CookieOptions {
  return { httpOnly: true, path: "/", sameSite: "Lax", secure: isHttps(env), maxAge };
}

/** Sets (or refreshes) the learner session cookie. */
function setSessionCookie(c: Context<AppEnv>, token: string): void {
  setCookie(c, cookieName(c.env), token, cookieOptions(c.env));
}

/** Clears the learner cookie. */
export function clearSession(c: Context<AppEnv>): void {
  deleteCookie(c, cookieName(c.env), { httpOnly: true, path: "/", sameSite: "Lax", secure: isHttps(c.env) });
}

/** Clears the parent cookie. */
export function clearParentSession(c: Context<AppEnv>): void {
  deleteCookie(c, parentCookieName(c.env), { httpOnly: true, path: "/", sameSite: "Lax", secure: isHttps(c.env) });
}

export function userAgentOf(c: Context<AppEnv>): string {
  return (c.req.header("User-Agent") ?? "").slice(0, 200);
}

/**
 * Inserts a session of `scope` and sets that scope's cookie. The other scope's cookie is not touched.
 * Parent sessions start locked (unlocked_* NULL) and expire 14 days after sign-in, with no sliding.
 */
export async function createSession(
  c: Context<AppEnv>,
  userId: string,
  scope: SignInAs,
  loginEmail: string,
): Promise<{ sessionId: string; hash: string }> {
  const token = randomToken();
  const t = now();
  const sessionId = crypto.randomUUID();
  const hash = await sha256Hex(token);
  const ttl = scope === "parent" ? PARENT_SESSION_MS : SESSION_MS;
  await c.env.DB.prepare(
    `INSERT INTO sessions (token_hash, user_id, created_at, last_seen_at, expires_at, user_agent, scope, id, login_email)
     VALUES (?1, ?2, ?3, ?3, ?4, ?5, ?6, ?7, ?8)`,
  )
    .bind(hash, userId, t, t + ttl, userAgentOf(c), scope, sessionId, loginEmail)
    .run();
  if (scope === "parent") setCookie(c, parentCookieName(c.env), token, cookieOptions(c.env, PARENT.SESSION_TTL_SEC));
  else setSessionCookie(c, token);
  return { sessionId, hash };
}

/** sha256 of the learner cookie, or null when there is no cookie. */
export async function sessionHashOf(c: Context<AppEnv>): Promise<string | null> {
  const token = getCookie(c, cookieName(c.env));
  return token ? sha256Hex(token) : null;
}

/** sha256 of the parent cookie, or null when there is no cookie. */
export async function parentHashOf(c: Context<AppEnv>): Promise<string | null> {
  const token = getCookie(c, parentCookieName(c.env));
  return token ? sha256Hex(token) : null;
}

interface SessionRow {
  user_id: string;
  expires_at: number;
  last_seen_at: number;
  email: string;
  created_at: number;
}

/** Learner routes. A parent session (in either cookie) is refused. */
export const requireUser: MiddlewareHandler<AppEnv> = async (c, next) => {
  const token = getCookie(c, cookieName(c.env));
  if (!token) return apiError(c, 401, "unauthorized", "Not signed in");
  const hash = await sha256Hex(token);
  const t = now();
  const row = await c.env.DB.prepare(
    `SELECT s.user_id, s.expires_at, s.last_seen_at, u.email, u.created_at
     FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?1 AND s.scope = 'learner'`,
  )
    .bind(hash)
    .first<SessionRow>();
  if (!row || row.expires_at <= t) {
    if (row) await c.env.DB.prepare("DELETE FROM sessions WHERE token_hash = ?1").bind(hash).run();
    clearSession(c);
    return apiError(c, 401, "unauthorized", "Session expired");
  }
  if (t - row.last_seen_at >= REFRESH_EVERY_MS) {
    await c.env.DB.prepare("UPDATE sessions SET last_seen_at = ?1, expires_at = ?2 WHERE token_hash = ?3")
      .bind(t, t + SESSION_MS, hash)
      .run();
    setSessionCookie(c, token);
  }
  c.set("user", { id: row.user_id, email: row.email, createdAt: row.created_at });
  c.set("sessionHash", hash);
  return next();
};

interface ParentRow extends SessionRow {
  id: string | null;
  login_email: string | null;
  unlocked_at: number | null;
  unlocked_until: number | null;
}

/** Reads the parent cookie's session. Sets c.var.user, sessionHash and parent, or returns the 401 response. */
async function loadParent(c: Context<AppEnv>, t: number): Promise<Response | null> {
  const token = getCookie(c, parentCookieName(c.env));
  if (!token) return apiError(c, 401, "unauthorized", "Not signed in as parent");
  const hash = await sha256Hex(token);
  const row = await c.env.DB.prepare(
    `SELECT s.user_id, s.expires_at, s.last_seen_at, s.id, s.login_email, s.unlocked_at, s.unlocked_until,
            u.email, u.created_at
     FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?1 AND s.scope = 'parent'`,
  )
    .bind(hash)
    .first<ParentRow>();
  if (!row || row.expires_at <= t || row.id === null) {
    if (row) await c.env.DB.prepare("DELETE FROM sessions WHERE token_hash = ?1").bind(hash).run();
    clearParentSession(c);
    return apiError(c, 401, "unauthorized", "Parent sign-in expired");
  }
  c.set("user", { id: row.user_id, email: row.email, createdAt: row.created_at });
  c.set("sessionHash", hash);
  c.set("parent", {
    sessionId: row.id,
    loginEmail: row.login_email ?? row.email,
    expiresAt: row.expires_at,
    unlockedAt: row.unlocked_at,
    unlockedUntil: row.unlocked_until,
    userAgent: userAgentOf(c),
  });
  return null;
}

/** True when the PIN was entered recently enough (idle and absolute limits). */
export function isUnlocked(p: Pick<ParentVars, "unlockedAt" | "unlockedUntil">, t: number): boolean {
  return p.unlockedUntil !== null && p.unlockedUntil > t && p.unlockedAt !== null && p.unlockedAt > t - UNLOCK_MAX_MS;
}

/** Slides an unlocked session's idle window (capped at unlocked_at + 60 min), at most once every 30 s. */
export async function slideUnlock(c: Context<AppEnv>, t: number): Promise<void> {
  const p = c.var.parent;
  if (!p || !isUnlocked(p, t) || p.unlockedAt === null || p.unlockedUntil === null) return;
  const target = Math.min(t + UNLOCK_IDLE_MS, p.unlockedAt + UNLOCK_MAX_MS);
  if (target - p.unlockedUntil < SLIDE_EVERY_MS) return;
  await c.env.DB.prepare("UPDATE sessions SET unlocked_until = ?2 WHERE token_hash = ?1 AND unlocked_until IS NOT NULL")
    .bind(c.var.sessionHash, target)
    .run();
  c.set("parent", { ...p, unlockedUntil: target });
}

/** A parent session, locked or not. Does not slide the session (14 days absolute). */
export const requireParentSession: MiddlewareHandler<AppEnv> = async (c, next) => {
  const res = await loadParent(c, now());
  if (res) return res;
  return next();
};

/** A parent session unlocked by the PIN within the idle and absolute windows; slides the idle window. */
export const requireParent: MiddlewareHandler<AppEnv> = async (c, next) => {
  const t = now();
  const res = await loadParent(c, t);
  if (res) return res;
  if (!isUnlocked(c.var.parent!, t)) return apiError(c, 403, "parent_locked", "Enter your parent PIN.");
  await slideUnlock(c, t);
  return next();
};

/** Unlocks this parent session: the PIN was just entered. */
export function unlockStmt(db: D1Database, sessionHash: string, t: number): D1PreparedStatement {
  return db
    .prepare("UPDATE sessions SET unlocked_at = ?2, unlocked_until = ?3 WHERE token_hash = ?1 AND scope = 'parent'")
    .bind(sessionHash, t, t + UNLOCK_IDLE_MS);
}

/** Locks every parent session of the account, optionally except one. */
export function lockAllParentStmt(db: D1Database, userId: string, exceptHash: string | null = null): D1PreparedStatement {
  return db
    .prepare(
      `UPDATE sessions SET unlocked_until = NULL
       WHERE user_id = ?1 AND scope = 'parent' AND (?2 IS NULL OR token_hash != ?2)`,
    )
    .bind(userId, exceptHash);
}

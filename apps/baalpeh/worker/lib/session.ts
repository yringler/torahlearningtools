import type { Context, MiddlewareHandler } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import type { CookieOptions } from "hono/utils/cookie";
import { AUTH } from "../../shared/api";
import type { AppEnv, Env } from "../env";
import { randomToken, sha256Hex } from "./crypto";
import { apiError } from "./http";
import { now } from "./time";

const SESSION_MS = AUTH.SESSION_TTL_SEC * 1000;
const REFRESH_EVERY_MS = 5 * 60 * 1000;

export function isHttps(env: Pick<Env, "APP_ORIGIN">): boolean {
  return env.APP_ORIGIN.startsWith("https://");
}

export function cookieName(env: Pick<Env, "APP_ORIGIN">): string {
  return isHttps(env) ? "__Host-bp_session" : "bp_session";
}

export function cookieOptions(env: Pick<Env, "APP_ORIGIN">, maxAge: number = AUTH.SESSION_TTL_SEC): CookieOptions {
  return { httpOnly: true, path: "/", sameSite: "Lax", secure: isHttps(env), maxAge };
}

/** Sets (or refreshes) the session cookie. */
function setSessionCookie(c: Context<AppEnv>, token: string): void {
  setCookie(c, cookieName(c.env), token, cookieOptions(c.env));
}

export function clearSession(c: Context<AppEnv>): void {
  deleteCookie(c, cookieName(c.env), { httpOnly: true, path: "/", sameSite: "Lax", secure: isHttps(c.env) });
}

export async function createSession(c: Context<AppEnv>, userId: string): Promise<void> {
  const token = randomToken();
  const t = now();
  await c.env.DB.prepare(
    `INSERT INTO sessions (token_hash, user_id, created_at, last_seen_at, expires_at, user_agent)
     VALUES (?1, ?2, ?3, ?3, ?4, ?5)`,
  )
    .bind(await sha256Hex(token), userId, t, t + SESSION_MS, (c.req.header("User-Agent") ?? "").slice(0, 200))
    .run();
  setSessionCookie(c, token);
}

/** sha256 of the session cookie, or null when there is no cookie. */
export async function sessionHashOf(c: Context<AppEnv>): Promise<string | null> {
  const token = getCookie(c, cookieName(c.env));
  return token ? sha256Hex(token) : null;
}

interface SessionRow {
  user_id: string;
  expires_at: number;
  last_seen_at: number;
  email: string;
  created_at: number;
}

export const requireUser: MiddlewareHandler<AppEnv> = async (c, next) => {
  const token = getCookie(c, cookieName(c.env));
  if (!token) return apiError(c, 401, "unauthorized", "Not signed in");
  const hash = await sha256Hex(token);
  const t = now();
  const row = await c.env.DB.prepare(
    `SELECT s.user_id, s.expires_at, s.last_seen_at, u.email, u.created_at
     FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?1`,
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

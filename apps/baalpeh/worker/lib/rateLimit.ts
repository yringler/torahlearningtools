import type { Env } from "../env";
import { hmacHex } from "./crypto";

export type HitResult = { ok: true } | { ok: false; retryAfterSec: number };

/** Fixed-window counter in D1, keyed by HMAC of the subject (never the raw IP or email). */
export async function hit(
  env: Env,
  name: string,
  subject: string,
  limit: number,
  windowSec: number,
  now: number,
): Promise<HitResult> {
  const windowMs = windowSec * 1000;
  const windowStart = Math.floor(now / windowMs) * windowMs;
  const key = `${name}:${(await hmacHex(env.AUTH_SECRET, "rl:" + subject)).slice(0, 32)}`;
  const row = await env.DB.prepare(
    `INSERT INTO rate_limits (key, window_start, count) VALUES (?1, ?2, 1)
     ON CONFLICT(key) DO UPDATE SET
       count = CASE WHEN rate_limits.window_start = excluded.window_start THEN rate_limits.count + 1 ELSE 1 END,
       window_start = excluded.window_start
     RETURNING count`,
  )
    .bind(key, windowStart)
    .first<{ count: number }>();
  if ((row?.count ?? 0) <= limit) return { ok: true };
  return { ok: false, retryAfterSec: Math.max(1, Math.ceil((windowStart + windowMs - now) / 1000)) };
}

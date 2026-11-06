import type { Env } from "./env";

const DAY_MS = 86_400_000;

/** Daily cleanup of expired auth rows, old perek-test links and stale rate-limit windows. */
export async function cleanup(env: Pick<Env, "DB">, now: number): Promise<void> {
  const db = env.DB;
  await db.batch([
    db.prepare("DELETE FROM login_requests WHERE expires_at < ?1").bind(now - DAY_MS),
    db.prepare("DELETE FROM sessions WHERE expires_at < ?1").bind(now),
    db.prepare("DELETE FROM rate_limits WHERE window_start < ?1").bind(now - DAY_MS),
    // Test links 30 days past expiry. perek_verifications is kept for good.
    db.prepare("DELETE FROM perek_tests WHERE expires_at < ?1").bind(now - 30 * DAY_MS),
  ]);
}

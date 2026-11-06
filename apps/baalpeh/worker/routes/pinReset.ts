/**
 * "Forgot PIN?" links, mounted at /api/pin-reset (docs/PARENT_MODE.md §6.10). No session: the emailed token is the
 * credential. Lookup only reads, and setting needs a typed PIN, so a link scanner can't change anything.
 */
import { Hono } from "hono";
import type { PinResetInfo } from "../../shared/api";
import type { AppEnv } from "../env";
import { sha256Hex } from "../lib/crypto";
import { apiError, clientIp, readJson } from "../lib/http";
import { maskEmail } from "../lib/mask";
import { setPinFlow } from "../lib/pin";
import { limit } from "../lib/rateLimit";
import { userAgentOf } from "../lib/session";
import { now } from "../lib/time";
import { validatePinReset, validateToken } from "../lib/validate";

export const pinResetRoutes = new Hono<AppEnv>();

const INVALID = "This link has expired or was already used.";

interface ResetRow {
  id: string;
  user_id: string;
  email: string;
  expires_at: number;
  requested_via: "parent" | "test_page";
  account_email: string;
}

const LIVE_SQL = `SELECT r.id, r.user_id, r.email, r.expires_at, r.requested_via, u.email AS account_email
FROM pin_resets r JOIN users u ON u.id = r.user_id
WHERE r.token_hash = ?1 AND r.consumed_at IS NULL AND r.expires_at > ?2`;

pinResetRoutes.post("/lookup", async (c) => {
  const v = validateToken(await readJson(c));
  if (!v.ok) return apiError(c, 400, "invalid_link", INVALID);
  const t = now();
  await limit(c, "pin-reset-ip", clientIp(c), 20, 900, t);
  const row = await c.env.DB.prepare(LIVE_SQL).bind(await sha256Hex(v.value.token), t).first<ResetRow>();
  if (!row) return apiError(c, 400, "invalid_link", INVALID);
  const body: PinResetInfo = { email: maskEmail(row.email), expiresAt: row.expires_at };
  return c.json(body);
});

pinResetRoutes.post("/", async (c) => {
  const v = validatePinReset(await readJson(c));
  if (!v.ok) return apiError(c, 400, "bad_request", v.message);
  const t = now();
  await limit(c, "pin-reset-ip", clientIp(c), 20, 900, t);
  const h = await sha256Hex(v.value.token);
  const db = c.env.DB;
  const row = await db.prepare(LIVE_SQL).bind(h, t).first<ResetRow>();
  if (!row) return apiError(c, 400, "invalid_link", INVALID);
  const ok = await setPinFlow(c, {
    userId: row.user_id,
    accountEmail: row.account_email,
    pin: v.value.pin,
    tz: v.value.tz,
    kind: "reset",
    via: "pin_reset_link",
    actor: { email: row.email, sessionId: null, device: userAgentOf(c) },
    sessionHash: null,
    auditDetail: { requestedVia: row.requested_via },
    t,
    write: (pin) => [
      db
        .prepare("UPDATE pin_resets SET consumed_at = ?2 WHERE token_hash = ?1 AND consumed_at IS NULL AND expires_at > ?2")
        .bind(h, t),
      db
        .prepare(
          `INSERT INTO account_pins (user_id, hash, salt, iterations, failed, locked_at, set_at, set_by_session)
           SELECT user_id, ?3, ?4, ?5, 0, NULL, ?2, NULL FROM pin_resets WHERE token_hash = ?1 AND consumed_at = ?2
           ON CONFLICT(user_id) DO UPDATE SET
             hash = excluded.hash, salt = excluded.salt, iterations = excluded.iterations, failed = 0, locked_at = NULL,
             set_at = excluded.set_at, set_by_session = NULL`,
        )
        .bind(h, t, pin.hash, pin.salt, pin.iterations),
    ],
  });
  if (!ok) return apiError(c, 400, "invalid_link", INVALID);
  return c.body(null, 204);
});

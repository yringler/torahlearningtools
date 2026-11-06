/**
 * Parent mode, mounted at /api/parent (docs/PARENT_MODE.md §6.4). Every route reads only the parent cookie
 * (__Host-bp_parent); a learner session is refused everywhere here. Guards:
 * - requireParentSession: a parent session from an email sign-in with `as: "parent"`, locked or not;
 * - requireParent: that session, unlocked with the PIN in the last 5 minutes of use (60 minutes at most).
 */
import { Hono, type Context } from "hono";
import type { AuditLogResponse, ForgotPinResponse, MeResponse, ParentMeResponse } from "../../shared/api";
import type { AppEnv } from "../env";
import { toAuditEntry, type Actor, type AuditDbRow } from "../lib/audit";
import { apiError, clientIp, readJson } from "../lib/http";
import { checkPin, createPinReset, setPinFlow } from "../lib/pin";
import { limit } from "../lib/rateLimit";
import {
  clearParentSession,
  clearSession,
  createSession,
  isUnlocked,
  parentHashOf,
  requireParent,
  requireParentSession,
  sessionHashOf,
  slideUnlock,
  unlockStmt,
  UNLOCK_IDLE_MS,
} from "../lib/session";
import { now } from "../lib/time";
import { queryInt, validateDeleteAccount, validatePin, validateSetPin } from "../lib/validate";
import { parentChildrenRoutes } from "./children";
import { runSync } from "./sync";

export const parentRoutes = new Hono<AppEnv>();

function actorOf(c: Context<AppEnv>): Actor {
  const p = c.var.parent!;
  return { email: p.loginEmail, sessionId: p.sessionId, device: p.userAgent };
}

async function meBody(c: Context<AppEnv>, t: number): Promise<ParentMeResponse> {
  const p = c.var.parent!;
  const pin = await c.env.DB.prepare("SELECT locked_at FROM account_pins WHERE user_id = ?1")
    .bind(c.var.user.id)
    .first<{ locked_at: number | null }>();
  return {
    user: c.var.user,
    loginEmail: p.loginEmail,
    sessionExpiresAt: p.expiresAt,
    pin: { set: pin !== null, locked: pin !== null && pin.locked_at !== null },
    unlockedUntil: isUnlocked(p, t) ? p.unlockedUntil : null,
  };
}

/** The ping: slides the unlock window when unlocked. */
parentRoutes.get("/me", requireParentSession, async (c) => {
  const t = now();
  await slideUnlock(c, t);
  return c.json(await meBody(c, t));
});

parentRoutes.post("/unlock", requireParentSession, async (c) => {
  const v = validatePin(await readJson(c));
  if (!v.ok) return apiError(c, 400, "bad_request", v.message);
  const t = now();
  await limit(c, "pin-ip", clientIp(c), 20, 900, t);
  await checkPin(c, { userId: c.var.user.id, pin: v.value.pin, t, via: "parent", actor: actorOf(c) });
  await unlockStmt(c.env.DB, c.var.sessionHash, t).run();
  const p = c.var.parent!;
  c.set("parent", { ...p, unlockedAt: t, unlockedUntil: t + UNLOCK_IDLE_MS });
  return c.json(await meBody(c, t));
});

/** A beacon: no body, never an error. */
parentRoutes.post("/lock", async (c) => {
  const hash = await parentHashOf(c);
  if (hash) {
    await c.env.DB.prepare("UPDATE sessions SET unlocked_until = NULL WHERE token_hash = ?1 AND scope = 'parent'").bind(hash).run();
  }
  return c.body(null, 204);
});

parentRoutes.post("/pin", requireParentSession, async (c) => {
  const v = validateSetPin(await readJson(c));
  if (!v.ok) return apiError(c, 400, "bad_request", v.message);
  const t = now();
  const user = c.var.user;
  const p = c.var.parent!;
  const db = c.env.DB;
  await limit(c, "pin-set", user.id, 10, 3600, t);
  const existing = await db.prepare("SELECT locked_at FROM account_pins WHERE user_id = ?1").bind(user.id).first<{ locked_at: number | null }>();
  if (existing && existing.locked_at !== null) {
    return apiError(c, 403, "pin_locked", "Your parent PIN is locked. Reset it by email.");
  }
  if (existing && !isUnlocked(p, t)) return apiError(c, 403, "parent_locked", "Enter your parent PIN.");
  const kind = existing ? "changed" : "set";
  const ok = await setPinFlow(c, {
    userId: user.id,
    accountEmail: user.email,
    pin: v.value.pin,
    tz: v.value.tz,
    kind,
    via: "parent",
    actor: actorOf(c),
    sessionHash: c.var.sessionHash,
    t,
    write: (row) => [
      kind === "set"
        ? db
            .prepare(
              `INSERT INTO account_pins (user_id, hash, salt, iterations, failed, locked_at, set_at, set_by_session)
               VALUES (?1, ?2, ?3, ?4, 0, NULL, ?5, ?6) ON CONFLICT(user_id) DO NOTHING`,
            )
            .bind(user.id, row.hash, row.salt, row.iterations, t, p.sessionId)
        : db
            .prepare(
              `UPDATE account_pins SET hash = ?2, salt = ?3, iterations = ?4, failed = 0, set_at = ?5, set_by_session = ?6
               WHERE user_id = ?1 AND locked_at IS NULL`,
            )
            .bind(user.id, row.hash, row.salt, row.iterations, t, p.sessionId),
    ],
  });
  if (!ok) return apiError(c, 403, "parent_locked", "The PIN changed in the meantime. Enter your parent PIN.");
  c.set("parent", { ...p, unlockedAt: t, unlockedUntil: t + UNLOCK_IDLE_MS });
  return c.json(await meBody(c, t));
});

parentRoutes.post("/pin/forgot", requireParentSession, async (c) => {
  const t = now();
  const sentTo = await createPinReset(c, c.var.user.id, "parent", c.var.parent!.sessionId, t);
  const body: ForgotPinResponse = { ok: true, sentTo };
  return c.json(body);
});

parentRoutes.post("/logout", async (c) => {
  const hash = await parentHashOf(c);
  if (hash) await c.env.DB.prepare("DELETE FROM sessions WHERE token_hash = ?1 AND scope = 'parent'").bind(hash).run();
  clearParentSession(c);
  return c.body(null, 204);
});

/** "Use this device for learning": a NEW learner session (going down from parent to learner is not an upgrade). */
parentRoutes.post("/learner-session", requireParent, async (c) => {
  const t = now();
  const user = c.var.user;
  await limit(c, "learner-sess", user.id, 10, 3600, t);
  const old = await sessionHashOf(c);
  if (old) await c.env.DB.prepare("DELETE FROM sessions WHERE token_hash = ?1 AND scope = 'learner'").bind(old).run();
  await createSession(c, user.id, "learner", c.var.parent!.loginEmail);
  const body: MeResponse = { user };
  return c.json(body);
});

parentRoutes.post("/sync", requireParent, (c) => runSync(c, "parent"));

parentRoutes.route("/children", parentChildrenRoutes);

parentRoutes.get("/log", requireParent, async (c) => {
  const t = now();
  const before = queryInt(c.req.query("before"), t + 1, 1, 1e13);
  const lim = queryInt(c.req.query("limit"), 30, 1, 100);
  if (before === null || lim === null) return apiError(c, 400, "bad_request", "Invalid before or limit");
  const rows = await c.env.DB.prepare(
    `SELECT id, at, action, child_id, child_name, detail, via, actor_email, actor_device FROM audit_log
     WHERE user_id = ?1 AND at < ?2 ORDER BY at DESC, id DESC LIMIT ?3`,
  )
    .bind(c.var.user.id, before, lim + 1)
    .all<AuditDbRow>();
  const page = rows.results.slice(0, lim);
  const last = page[page.length - 1];
  const more = rows.results.length > lim && last !== undefined;
  if (more) {
    // `before` is exclusive, so a page must never end inside a millisecond: one parent sync writes several rows with
    // the same `at`. Take the rest of that millisecond into this page.
    const rest = await c.env.DB.prepare(
      `SELECT id, at, action, child_id, child_name, detail, via, actor_email, actor_device FROM audit_log
       WHERE user_id = ?1 AND at = ?2 AND id < ?3 ORDER BY id DESC`,
    )
      .bind(c.var.user.id, last.at, last.id)
      .all<AuditDbRow>();
    page.push(...rest.results);
  }
  const body: AuditLogResponse = { entries: page.map(toAuditEntry), nextBefore: more ? last.at : null };
  return c.json(body);
});

parentRoutes.delete("/account", requireParent, async (c) => {
  const v = validateDeleteAccount(await readJson(c));
  const user = c.var.user;
  if (!v.ok || v.value.email !== user.email) {
    return apiError(c, 400, "bad_request", "Type your account email to confirm");
  }
  const db = c.env.DB;
  await db.batch([
    db.prepare("DELETE FROM events WHERE user_id = ?1").bind(user.id),
    db.prepare("DELETE FROM progress WHERE user_id = ?1").bind(user.id),
    db.prepare("DELETE FROM perek_tests WHERE user_id = ?1").bind(user.id),
    db.prepare("DELETE FROM perek_verifications WHERE user_id = ?1").bind(user.id),
    db.prepare("DELETE FROM children WHERE user_id = ?1").bind(user.id),
    db.prepare("DELETE FROM account_pins WHERE user_id = ?1").bind(user.id),
    db.prepare("DELETE FROM pin_resets WHERE user_id = ?1").bind(user.id),
    db.prepare("DELETE FROM audit_log WHERE user_id = ?1").bind(user.id),
    db.prepare("DELETE FROM sessions WHERE user_id = ?1").bind(user.id),
    db.prepare("DELETE FROM login_requests WHERE email = ?1").bind(user.email),
    db.prepare("DELETE FROM users WHERE id = ?1").bind(user.id),
  ]);
  clearSession(c);
  clearParentSession(c);
  return c.body(null, 204);
});

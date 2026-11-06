/**
 * The parent PIN (docs/PARENT_MODE.md §6.3). One per account, 4 digits, checked only here.
 * Stored as PBKDF2-SHA256 over HMAC(AUTH_SECRET, "pin:"+userId+":"+pin) with a 16-byte salt: the pepper means a
 * stolen table alone can't be brute-forced; the 5-try lockout is what protects the 4-digit space online.
 * The PIN itself is never stored, logged or used as a rate-limit subject.
 */
import type { Context } from "hono";
import { PARENT } from "../../shared/api";
import type { AppEnv } from "../env";
import { pinLockedEmail } from "../email/pinLockedEmail";
import { pinNoticeEmail, type PinChangeKind } from "../email/pinNoticeEmail";
import { pinResetEmail } from "../email/pinResetEmail";
import { pickSender } from "../email/sender";
import { auditStmt, type Actor, type AuditVia } from "./audit";
import { randomToken, safeEqualHex, sha256Hex } from "./crypto";
import { HttpError, clientIp } from "./http";
import { maskEmail } from "./mask";
import { limit } from "./rateLimit";
import { UNLOCK_IDLE_MS } from "./session";

const enc = new TextEncoder();
const MAX = PARENT.MAX_PIN_ATTEMPTS;

function toHex(buf: ArrayBuffer | Uint8Array): string {
  return Array.from(buf instanceof Uint8Array ? buf : new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
}

function fromHex(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export async function hashPin(secret: string, userId: string, pin: string, saltHex: string, iterations: number): Promise<string> {
  const hmacKey = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const peppered = await crypto.subtle.sign("HMAC", hmacKey, enc.encode(`pin:${userId}:${pin}`));
  const key = await crypto.subtle.importKey("raw", peppered, "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: fromHex(saltHex), iterations }, key, 256);
  return toHex(bits);
}

export interface PinRow {
  hash: string;
  salt: string;
  iterations: number;
}

export async function newPinRow(secret: string, userId: string, pin: string): Promise<PinRow> {
  const salt = toHex(crypto.getRandomValues(new Uint8Array(16)));
  const iterations = PARENT.PIN_ITERATIONS;
  return { hash: await hashPin(secret, userId, pin, salt, iterations), salt, iterations };
}

/** Best effort: schedule work after the response (tests wait for it); run inline when there is no context. */
function later(c: Context<AppEnv>, p: Promise<unknown>): void {
  const safe = p.catch((err: unknown) => console.error("background task failed", err));
  try {
    c.executionCtx.waitUntil(safe);
  } catch {
    void safe;
  }
}

/**
 * Checks the account's PIN; throws HttpError unless it is right. Shared by unlock and perek-test confirm, so both use
 * one counter. A try is reserved before the hash is compared, so concurrent guesses can never exceed 5 in total.
 */
export async function checkPin(
  c: Context<AppEnv>,
  a: { userId: string; pin: string; t: number; via: "parent" | "test_link"; actor: Actor },
): Promise<void> {
  const db = c.env.DB;
  const row = await db
    .prepare(
      `UPDATE account_pins SET failed = failed + 1
       WHERE user_id = ?1 AND locked_at IS NULL AND failed < ?2
       RETURNING failed, hash, salt, iterations`,
    )
    .bind(a.userId, MAX)
    .first<{ failed: number; hash: string; salt: string; iterations: number }>();
  if (!row) {
    const exists = await db.prepare("SELECT 1 AS x FROM account_pins WHERE user_id = ?1").bind(a.userId).first();
    if (exists) throw new HttpError(403, "pin_locked", "Your parent PIN is locked. Reset it by email.");
    throw new HttpError(409, "pin_not_set", "No parent PIN is set yet.");
  }
  const hash = await hashPin(c.env.AUTH_SECRET, a.userId, a.pin, row.salt, row.iterations);
  if (await safeEqualHex(hash, row.hash)) {
    if (row.iterations < PARENT.PIN_ITERATIONS) {
      const fresh = await newPinRow(c.env.AUTH_SECRET, a.userId, a.pin);
      await db
        .prepare("UPDATE account_pins SET failed = 0, hash = ?2, salt = ?3, iterations = ?4 WHERE user_id = ?1 AND locked_at IS NULL")
        .bind(a.userId, fresh.hash, fresh.salt, fresh.iterations)
        .run();
    } else {
      await db.prepare("UPDATE account_pins SET failed = 0 WHERE user_id = ?1 AND locked_at IS NULL").bind(a.userId).run();
    }
    return;
  }
  if (row.failed < MAX) {
    throw new HttpError(400, "invalid_pin", "That PIN isn't right.", { attemptsLeft: MAX - row.failed });
  }
  // The 5th wrong try in a row: lock it, end every unlock, log it, tell the parent.
  await db.batch([
    db.prepare("UPDATE account_pins SET locked_at = ?2 WHERE user_id = ?1 AND locked_at IS NULL").bind(a.userId, a.t),
    db.prepare("UPDATE sessions SET unlocked_until = NULL WHERE user_id = ?1 AND scope = 'parent'").bind(a.userId),
    auditStmt(db, { userId: a.userId, at: a.t, action: "pin_locked", via: a.via, actor: a.actor }),
  ]);
  const user = await db.prepare("SELECT email FROM users WHERE id = ?1").bind(a.userId).first<{ email: string }>();
  if (user) {
    const content = pinLockedEmail({
      at: a.t,
      tz: undefined,
      where: a.via === "parent" ? "parent" : "test_page",
      userAgent: a.actor.device ?? "",
      appOrigin: c.env.APP_ORIGIN,
    });
    later(c, pickSender(c.env).send({ to: user.email, ...content, idempotencyKey: `pin-locked-${a.userId}-${a.t}` }));
  }
  throw new HttpError(403, "pin_locked", "Your parent PIN is locked. Reset it by email.");
}

export interface SetPinFlow {
  userId: string;
  /** users.email: where the notice goes. */
  accountEmail: string;
  pin: string;
  tz: string | undefined;
  kind: PinChangeKind;
  via: Extract<AuditVia, "parent" | "pin_reset_link">;
  actor: Actor;
  /** The parent session to unlock (and keep unlocked); null for a reset link. */
  sessionHash: string | null;
  auditDetail?: Record<string, unknown>;
  t: number;
  /** The guarded write of the new row. Everything after it runs only if the row now holds this hash. */
  write: (row: PinRow) => D1PreparedStatement[];
}

/**
 * Sets, changes or resets the PIN (§6.3). The notice email goes out FIRST; if it can't be sent nothing changes
 * (502 email_failed), so no change is ever unannounced. Returns false when the guard found the state changed in
 * between (the write didn't happen; the email has gone out, which only tells the parent about an attempt).
 */
export async function setPinFlow(c: Context<AppEnv>, f: SetPinFlow): Promise<boolean> {
  const db = c.env.DB;
  const row = await newPinRow(c.env.AUTH_SECRET, f.userId, f.pin);
  const content = pinNoticeEmail({
    accountEmail: f.accountEmail,
    kind: f.kind,
    at: f.t,
    tz: f.tz,
    loginEmail: f.via === "parent" ? f.actor.email : null,
    userAgent: f.actor.device ?? "",
    appOrigin: c.env.APP_ORIGIN,
  });
  try {
    await pickSender(c.env).send({ to: f.accountEmail, ...content, idempotencyKey: `pin-notice-${f.userId}-${f.t}` });
  } catch {
    throw new HttpError(502, "email_failed", "We couldn't send the notice email, so the PIN wasn't changed. Try again in a minute.");
  }
  const written = "EXISTS (SELECT 1 FROM account_pins WHERE user_id = ?1 AND hash = ?2)";
  const results = await db.batch([
    ...f.write(row),
    db
      .prepare(
        `UPDATE sessions SET unlocked_until = NULL
         WHERE user_id = ?1 AND scope = 'parent' AND (?3 IS NULL OR token_hash != ?3) AND ${written}`,
      )
      .bind(f.userId, row.hash, f.sessionHash),
    db
      .prepare(`UPDATE sessions SET unlocked_at = ?4, unlocked_until = ?5 WHERE token_hash = ?3 AND scope = 'parent' AND ${written}`)
      .bind(f.userId, row.hash, f.sessionHash, f.t, f.t + UNLOCK_IDLE_MS),
    auditStmt(
      db,
      {
        userId: f.userId,
        at: f.t,
        action: f.kind === "set" ? "pin_set" : f.kind === "changed" ? "pin_changed" : "pin_reset",
        detail: f.auditDetail ?? {},
        via: f.via,
        actor: f.actor,
      },
      { sql: "EXISTS (SELECT 1 FROM account_pins WHERE user_id = ?12 AND hash = ?13)", params: [f.userId, row.hash] },
    ),
    db.prepare(`SELECT 1 AS ok WHERE ${written}`).bind(f.userId, row.hash),
  ]);
  return (results.at(-1)?.results.length ?? 0) > 0;
}

const RESET_TTL_MS = PARENT.PIN_RESET_TTL_SEC * 1000;

/** "Forgot PIN?": supersedes older live links, stores a new one and emails it. Returns the masked address. */
export async function createPinReset(
  c: Context<AppEnv>,
  userId: string,
  via: "parent" | "test_page",
  sessionId: string | null,
  t: number,
): Promise<string> {
  const db = c.env.DB;
  await limit(c, "pin-forgot-ip", clientIp(c), 10, 3600, t);
  await limit(c, "pin-forgot", userId, 3, 3600, t);
  await limit(c, "pin-forgot-day", userId, 6, 86_400, t);
  const user = await db.prepare("SELECT email FROM users WHERE id = ?1").bind(userId).first<{ email: string }>();
  if (!user) throw new HttpError(404, "not_found", "No such account");
  const pin = await db.prepare("SELECT 1 AS x FROM account_pins WHERE user_id = ?1").bind(userId).first();
  if (!pin) throw new HttpError(409, "pin_not_set", "No parent PIN is set yet.");

  const id = crypto.randomUUID();
  const token = randomToken();
  await db.batch([
    db.prepare("UPDATE pin_resets SET consumed_at = ?2 WHERE user_id = ?1 AND consumed_at IS NULL").bind(userId, t),
    db
      .prepare(
        `INSERT INTO pin_resets (id, user_id, email, token_hash, created_at, expires_at, requested_via, requested_session)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`,
      )
      .bind(id, userId, user.email, await sha256Hex(token), t, t + RESET_TTL_MS, via, sessionId),
  ]);
  const link = `${c.env.APP_ORIGIN}/parent-pin#t=${token}`;
  try {
    await pickSender(c.env).send({ to: user.email, ...pinResetEmail({ email: user.email, link }), idempotencyKey: "pin-reset-" + id });
  } catch {
    await db.prepare("UPDATE pin_resets SET consumed_at = ?2 WHERE id = ?1").bind(id, t).run();
    throw new HttpError(502, "email_failed", "The email could not be sent. Please try again in a minute.");
  }
  return maskEmail(user.email);
}

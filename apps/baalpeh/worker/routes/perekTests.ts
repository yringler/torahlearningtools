/**
 * Parent verification of a perek by email (docs/PARENT_VERIFICATION.md §5).
 * POST /            (session) the child asks for the test email
 * POST /lookup      (no session, read-only) the landing page shows who and what
 * POST /confirm     (no session) the parent taps "knows it"
 * There is deliberately no GET route: link scanners GET every URL, so a GET must never change anything.
 */
import { Hono, type Context } from "hono";
import {
  PEREK_TEST,
  type ChildMeta,
  type PerekTestInfo,
  type PerekTestRequestResponse,
  type PerekVerificationRow,
} from "../../shared/api";
import type { AppEnv } from "../env";
import { perekTestEmail } from "../email/perekTestEmail";
import { pickSender } from "../email/sender";
import { randomToken, sha256Hex } from "../lib/crypto";
import { apiError, clientIp, readJson } from "../lib/http";
import { limit } from "../lib/rateLimit";
import { requireUser } from "../lib/session";
import { masechtaText, perakimCount, perekPieces } from "../lib/text";
import { now } from "../lib/time";
import { validatePerekTestRequest, validateToken } from "../lib/validate";
import { confirmTokenStmts } from "../lib/verification";

const COOLDOWN_MS = PEREK_TEST.COOLDOWN_SEC * 1000;
const TTL_MS = PEREK_TEST.TOKEN_TTL_SEC * 1000;

export const perekTestRoutes = new Hono<AppEnv>();

/** "yosef@gmail.com" → "y•••@gmail.com". */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf("@");
  if (at < 1) return "•••";
  return `${Array.from(email.slice(0, at))[0] ?? ""}•••${email.slice(at)}`;
}

function parseMeta(data: string): Pick<ChildMeta, "name" | "emoji" | "color"> {
  try {
    const m = JSON.parse(data) as Partial<ChildMeta>;
    return {
      name: typeof m.name === "string" ? m.name : "",
      emoji: typeof m.emoji === "string" ? m.emoji : "",
      color: typeof m.color === "string" ? m.color : "#888888",
    };
  } catch {
    return { name: "", emoji: "", color: "#888888" };
  }
}

// ───────────── POST /api/perek-tests ─────────────

perekTestRoutes.post("/", requireUser, async (c) => {
  const v = validatePerekTestRequest(await readJson(c));
  if (!v.ok) return apiError(c, 400, "bad_request", v.message);
  const { childId, masechta, perek } = v.value;
  const t = now();
  const user = c.var.user;
  const U = user.id;
  const db = c.env.DB;

  // 1. The child (a child that hasn't synced yet is not found: the client syncs first).
  const ch = await db
    .prepare("SELECT data FROM children WHERE id = ?1 AND user_id = ?2 AND deleted = 0")
    .bind(childId, U)
    .first<{ data: string }>();
  if (!ch) return apiError(c, 404, "not_found", "No such child");

  // 2 + 3. Already verified? Frontier, from server data only.
  const rows = await db
    .prepare("SELECT perek, verified, verified_at, updated_at FROM perek_verifications WHERE child_id = ?1 AND masechta = ?2")
    .bind(childId, masechta)
    .all<{ perek: number; verified: number; verified_at: number | null; updated_at: number }>();
  const verified = new Set(rows.results.filter((r) => r.verified === 1).map((r) => r.perek));
  const mine = rows.results.find((r) => r.perek === perek);
  if (mine && mine.verified === 1) {
    const verification: PerekVerificationRow = {
      childId,
      masechta,
      perek,
      verified: true,
      verifiedAt: mine.verified_at,
      updatedAt: mine.updated_at,
    };
    const body: PerekTestRequestResponse = { ok: true, alreadyVerified: true, verification, sentTo: "", nextAllowedAt: t, serverTime: t };
    return c.json(body);
  }
  for (let k = 1; k < perek; k++) {
    if (!verified.has(k)) return apiError(c, 400, "bad_request", "not_frontier");
  }

  // 4. Account caps.
  await limit(c, "ptest-user-h", U, PEREK_TEST.MAX_PER_HOUR, 3600, t);
  await limit(c, "ptest-user-d", U, PEREK_TEST.MAX_PER_DAY, 86400, t);

  // 5. Per-child cooldown, exact and race-safe: the insert happens only if no counting send is within the window.
  const id = crypto.randomUUID();
  const token = randomToken();
  const inserted = await db
    .prepare(
      `INSERT INTO perek_tests (id, user_id, child_id, masechta, perek, token_hash, created_at, expires_at)
       SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8
       WHERE NOT EXISTS (
         SELECT 1 FROM perek_tests
         WHERE child_id = ?3 AND created_at > ?7 - ?9 AND (outcome IS NULL OR outcome != 'failed'))
       RETURNING id`,
    )
    .bind(id, U, childId, masechta, perek, await sha256Hex(token), t, t + TTL_MS, COOLDOWN_MS)
    .first<{ id: string }>();
  if (!inserted) {
    const last = await db
      .prepare("SELECT max(created_at) AS last FROM perek_tests WHERE child_id = ?1 AND (outcome IS NULL OR outcome != 'failed')")
      .bind(childId)
      .first<{ last: number | null }>();
    const retryAfterSec = Math.max(1, Math.ceil(((last?.last ?? t) + COOLDOWN_MS - t) / 1000));
    return apiError(c, 429, "rate_limited", "A test email was sent a few minutes ago.", { retryAfterSec });
  }

  // 6 + 7. Build and send. A failed send doesn't use up the cooldown.
  const meta = parseMeta(ch.data);
  const text = masechtaText(masechta)!; // validated
  const content = perekTestEmail({
    childName: meta.name,
    childEmoji: meta.emoji,
    masechtaHe: text.he,
    masechtaEn: text.en,
    perek,
    lastPerek: perek === perakimCount(masechta),
    pieces: perekPieces(masechta, perek),
    link: `${c.env.APP_ORIGIN}/perek-test#t=${token}`,
  });
  try {
    await pickSender(c.env).send({ to: user.email, ...content, idempotencyKey: "perek-test-" + id });
  } catch {
    await db.prepare("UPDATE perek_tests SET outcome = 'failed', consumed_at = ?1 WHERE id = ?2").bind(t, id).run();
    return apiError(c, 502, "email_failed", "The test email could not be sent. Please try again in a minute.");
  }

  const body: PerekTestRequestResponse = {
    ok: true,
    alreadyVerified: false,
    sentTo: maskEmail(user.email),
    nextAllowedAt: t + COOLDOWN_MS,
    serverTime: t,
  };
  return c.json(body);
});

// ───────────── lookup / confirm ─────────────

interface LookupRow {
  masechta: string;
  perek: number;
  created_at: number;
  expires_at: number;
  outcome: string | null;
  data: string;
  deleted: number;
  verified: number | null;
  verified_at: number | null;
}

const LOOKUP_SQL = `SELECT pt.masechta, pt.perek, pt.created_at, pt.expires_at, pt.outcome, c.data, c.deleted,
       v.verified, v.verified_at
FROM perek_tests pt JOIN children c ON c.id = pt.child_id
LEFT JOIN perek_verifications v
  ON v.child_id = pt.child_id AND v.masechta = pt.masechta AND v.perek = pt.perek
WHERE pt.token_hash = ?1`;

/** §5.2 decision order. null = invalid link (one shared answer: no enumeration). */
function toInfo(r: LookupRow | null, t: number): PerekTestInfo | null {
  if (!r || r.deleted === 1 || r.outcome === "failed" || r.outcome === "revoked") return null;
  const text = masechtaText(r.masechta);
  if (!text) return null;
  let status: PerekTestInfo["status"];
  if (r.verified === 1) status = "verified";
  else if (r.outcome === "verified" || r.outcome === "covered") return null; // un-verified later
  else if (r.expires_at <= t) status = "expired";
  else status = "pending";
  const meta = parseMeta(r.data);
  const count = perakimCount(r.masechta);
  return {
    status,
    childName: meta.name,
    childEmoji: meta.emoji,
    childColor: meta.color,
    masechta: r.masechta,
    masechtaHe: text.he,
    masechtaEn: text.en,
    perek: r.perek,
    nextPerek: r.perek < count ? r.perek + 1 : null,
    mishnayos: perekPieces(r.masechta, r.perek),
    requestedAt: r.created_at,
    verifiedAt: status === "verified" ? r.verified_at : null,
  };
}

const INVALID = "This test link isn't valid anymore.";

async function tokenHashOf(c: Context<AppEnv>, t: number): Promise<string | Response> {
  const v = validateToken(await readJson(c));
  if (!v.ok) return apiError(c, 400, "bad_request", v.message);
  await limit(c, "ptest-ip", clientIp(c), 30, 900, t);
  return sha256Hex(v.value.token);
}

perekTestRoutes.post("/lookup", async (c) => {
  const t = now();
  const h = await tokenHashOf(c, t);
  if (h instanceof Response) return h;
  const info = toInfo(await c.env.DB.prepare(LOOKUP_SQL).bind(h).first<LookupRow>(), t);
  if (!info) return apiError(c, 400, "invalid_link", INVALID);
  return c.json(info);
});

perekTestRoutes.post("/confirm", async (c) => {
  const t = now();
  const h = await tokenHashOf(c, t);
  if (h instanceof Response) return h;
  const db = c.env.DB;
  const results = await db.batch([...confirmTokenStmts(db, h, t), db.prepare(LOOKUP_SQL).bind(h)]);
  const info = toInfo((results.at(-1)?.results[0] as LookupRow | undefined) ?? null, t);
  if (info?.status === "verified") return c.json(info);
  if (info?.status === "expired") return apiError(c, 400, "invalid_link", "This test link has expired.");
  return apiError(c, 400, "invalid_link", INVALID);
});

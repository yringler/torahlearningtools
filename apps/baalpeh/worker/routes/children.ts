/**
 * Parent-only child views and powers, mounted at /api/parent/children (docs/PARENT_MODE.md §6.4–6.5).
 * Every route needs an unlocked parent session.
 */
import { Hono, type Context } from "hono";
import type {
  ChildMeta,
  ChildStatsResponse,
  DayActivity,
  EventsResponse,
  LearningEvent,
  SetVerificationsResponse,
  StruggleRow,
} from "../../shared/api";
import { LEGACY_MASECHTA_ID } from "../../shared/progressKey";
import type { AppEnv } from "../env";
import { auditStmt } from "../lib/audit";
import { apiError, readJson } from "../lib/http";
import { limit } from "../lib/rateLimit";
import { requireParent } from "../lib/session";
import { now } from "../lib/time";
import { queryInt, validateSetVerifications } from "../lib/validate";
import { setVerificationStmts } from "../lib/verification";
import { toVerificationRow } from "./sync";

export const parentChildrenRoutes = new Hono<AppEnv>();
parentChildrenRoutes.use("/*", requireParent);

const DAY_MS = 86_400_000;

/** True when the child exists, is live and belongs to the signed-in user. */
async function ownsLiveChild(c: Context<AppEnv>, childId: string): Promise<boolean> {
  const row = await c.env.DB.prepare("SELECT deleted FROM children WHERE id = ?1 AND user_id = ?2")
    .bind(childId, c.var.user.id)
    .first<{ deleted: number }>();
  return row !== null && row.deleted === 0;
}

parentChildrenRoutes.get("/:id/events", async (c) => {
  const childId = c.req.param("id");
  const t = now();
  const before = queryInt(c.req.query("before"), t + 1, 1, 1e13);
  const limit = queryInt(c.req.query("limit"), 50, 1, 100);
  if (before === null || limit === null) return apiError(c, 400, "bad_request", "Invalid before or limit");
  if (!(await ownsLiveChild(c, childId))) return apiError(c, 404, "not_found", "No such child");

  const rows = await c.env.DB.prepare(
    `SELECT data, at FROM events WHERE child_id = ?1 AND user_id = ?2 AND at < ?3
     ORDER BY at DESC, id DESC LIMIT ?4`,
  )
    .bind(childId, c.var.user.id, before, limit + 1)
    .all<{ data: string; at: number }>();
  const page = rows.results.slice(0, limit);
  const body: EventsResponse = {
    events: page.map((r) => JSON.parse(r.data) as LearningEvent),
    nextBefore: rows.results.length > limit ? (page[page.length - 1]?.at ?? null) : null,
  };
  return c.json(body);
});

interface StruggleDbRow {
  masechta: string;
  perek: number;
  mishnah: number | null;
  attempts: number;
  pass: number;
  help: number;
  notyet: number;
  peeks: number;
  slips: number;
  last_at: number;
}

parentChildrenRoutes.get("/:id/stats", async (c) => {
  const childId = c.req.param("id");
  const days = queryInt(c.req.query("days"), 30, 1, 365);
  if (days === null) return apiError(c, 400, "bad_request", "Invalid days");
  if (!(await ownsLiveChild(c, childId))) return apiError(c, 404, "not_found", "No such child");
  const since = now() - days * DAY_MS;
  const db = c.env.DB;
  const U = c.var.user.id;

  const [agg, perDay] = await db.batch([
    db
      .prepare(
        // Events without a masechta (older clients, and every event before migration 0008) are Berakhot.
        `SELECT coalesce(masechta, '${LEGACY_MASECHTA_ID}') AS masechta, perek, mishnah, count(*) AS attempts,
           sum(grade = 'pass') AS pass, sum(grade = 'help') AS help, sum(grade = 'notyet') AS notyet,
           sum(coalesce(peeks, 0)) AS peeks, sum(coalesce(slips, 0)) AS slips, max(at) AS last_at
         FROM events
         WHERE child_id = ?1 AND user_id = ?2 AND at >= ?3 AND type IN ('recite', 'check') AND perek IS NOT NULL
         GROUP BY coalesce(masechta, '${LEGACY_MASECHTA_ID}'), perek, mishnah`,
      )
      .bind(childId, U, since),
    db
      .prepare(
        `SELECT day, sum(CASE WHEN type = 'session' THEN coalesce(ms, 0) ELSE 0 END) AS ms, sum(type = 'recite') AS recites
         FROM events WHERE child_id = ?1 AND user_id = ?2 AND at >= ?3
         GROUP BY day ORDER BY day`,
      )
      .bind(childId, U, since),
  ]);

  const items: StruggleRow[] = ((agg?.results ?? []) as StruggleDbRow[]).map((r) => ({
    masechta: r.masechta,
    perek: r.perek,
    mishnah: r.mishnah,
    attempts: r.attempts,
    pass: r.pass ?? 0,
    help: r.help ?? 0,
    notyet: r.notyet ?? 0,
    peeks: r.peeks,
    slips: r.slips,
    lastAt: r.last_at,
    struggle: (r.notyet ?? 0) * 3 + (r.help ?? 0) + r.peeks * 0.5 + r.slips,
  }));
  items.sort((a, b) => b.struggle - a.struggle || b.lastAt - a.lastAt);

  const dayRows: DayActivity[] = ((perDay?.results ?? []) as { day: string; ms: number; recites: number }[]).map(
    (r) => ({ day: r.day, minutes: Math.round(r.ms / 60_000), recites: r.recites }),
  );

  const body: ChildStatsResponse = { childId, since, items, days: dayRows };
  return c.json(body);
});

// ───────────── POST /:id/verifications ─────────────

/**
 * Marks perakim verified or un-verified without the test email (§6.5). The proof the owner accepts for `verified:
 * true` here is the unlocked parent session: an email sign-in as parent plus the PIN within the last 5 minutes.
 */
parentChildrenRoutes.post("/:id/verifications", async (c) => {
  const childId = c.req.param("id");
  const v = validateSetVerifications(await readJson(c));
  if (!v.ok) return apiError(c, 400, "bad_request", v.message);
  const { masechta, perakim, verified } = v.value;
  const t = now();
  const U = c.var.user.id;
  const p = c.var.parent!;
  const db = c.env.DB;
  await limit(c, "verif", U, 120, 3600, t);

  const ch = await db
    .prepare("SELECT data FROM children WHERE id = ?1 AND user_id = ?2 AND deleted = 0")
    .bind(childId, U)
    .first<{ data: string }>();
  if (!ch) return apiError(c, 404, "not_found", "No such child");
  let name: string | null = null;
  try {
    const m = JSON.parse(ch.data) as Partial<ChildMeta>;
    if (typeof m.name === "string") name = m.name;
  } catch {
    // keep null
  }

  const stmts: D1PreparedStatement[] = [];
  for (const perek of perakim) {
    stmts.push(...setVerificationStmts(db, { userId: U, childId, masechta, perek, verified, source: "admin", testId: null, t }));
  }
  stmts.push(
    auditStmt(db, {
      userId: U,
      at: t,
      action: verified ? "perek_verified" : "perek_unverified",
      childId,
      childName: name,
      detail: { masechta, perakim },
      via: "parent",
      actor: { email: p.loginEmail, sessionId: p.sessionId, device: p.userAgent },
    }),
    db
      .prepare(
        `SELECT child_id, masechta, perek, verified, verified_at, updated_at FROM perek_verifications
         WHERE child_id = ?1 AND user_id = ?2 AND masechta = ?3 AND perek IN (SELECT value FROM json_each(?4))
         ORDER BY perek`,
      )
      .bind(childId, U, masechta, JSON.stringify(perakim)),
  );
  const results = await db.batch(stmts);
  const rows = (results.at(-1)?.results ?? []) as Parameters<typeof toVerificationRow>[0][];
  const body: SetVerificationsResponse = { verifications: rows.map(toVerificationRow) };
  return c.json(body);
});

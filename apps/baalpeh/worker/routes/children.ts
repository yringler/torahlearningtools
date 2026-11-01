import { Hono, type Context } from "hono";
import type { ChildStatsResponse, DayActivity, EventsResponse, LearningEvent, StruggleRow } from "../../shared/api";
import type { AppEnv } from "../env";
import { apiError } from "../lib/http";
import { requireUser } from "../lib/session";
import { now } from "../lib/time";
import { queryInt } from "../lib/validate";

export const childrenRoutes = new Hono<AppEnv>();
childrenRoutes.use("/*", requireUser);

const DAY_MS = 86_400_000;

/** True when the child exists, is live and belongs to the signed-in user. */
async function ownsLiveChild(c: Context<AppEnv>, childId: string): Promise<boolean> {
  const row = await c.env.DB.prepare("SELECT deleted FROM children WHERE id = ?1 AND user_id = ?2")
    .bind(childId, c.var.user.id)
    .first<{ deleted: number }>();
  return row !== null && row.deleted === 0;
}

childrenRoutes.get("/:id/events", async (c) => {
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

childrenRoutes.get("/:id/stats", async (c) => {
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
        `SELECT perek, mishnah, count(*) AS attempts,
           sum(grade = 'pass') AS pass, sum(grade = 'help') AS help, sum(grade = 'notyet') AS notyet,
           sum(coalesce(peeks, 0)) AS peeks, sum(coalesce(slips, 0)) AS slips, max(at) AS last_at
         FROM events
         WHERE child_id = ?1 AND user_id = ?2 AND at >= ?3 AND type IN ('recite', 'check') AND perek IS NOT NULL
         GROUP BY perek, mishnah`,
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

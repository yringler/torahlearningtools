import { Hono } from "hono";
import {
  SYNC_LIMITS,
  type ChildMeta,
  type ChildRow,
  type LearningEvent,
  type RecordRow,
  type SyncResponse,
} from "../../shared/api";
import type { AppEnv } from "../env";
import { apiError, readJson } from "../lib/http";
import { requireUser } from "../lib/session";
import { now } from "../lib/time";
import { validateSync } from "../lib/validate";

export const syncRoutes = new Hono<AppEnv>();

interface ChildDbRow {
  id: string;
  data: string;
  deleted: number;
  updated_at: number;
}
interface ProgressDbRow {
  child_id: string;
  kind: "m" | "p" | "d";
  key: string;
  data: string;
  updated_at: number;
}

function toChildRow(r: ChildDbRow): ChildRow {
  return { id: r.id, updatedAt: r.updated_at, deleted: r.deleted === 1, meta: JSON.parse(r.data) as ChildMeta };
}

function toRecordRow(r: ProgressDbRow): RecordRow {
  return { childId: r.child_id, kind: r.kind, key: r.key, data: JSON.parse(r.data), updatedAt: r.updated_at } as RecordRow;
}

const recordKey = (r: { childId: string; kind: string; key: string }): string => `${r.childId}|${r.kind}|${r.key}`;

/** Denormalized event columns: task, perek, mishnah, grade, peeks, slips, ms. */
function eventColumns(e: LearningEvent): [string | null, number | null, number | null, string | null, number | null, number | null, number | null] {
  switch (e.type) {
    case "recite":
      return [e.task, e.perek, e.mishnah, e.grade, e.peeks, null, e.ms];
    case "check":
      return [null, e.perek, e.mishnah, e.grade, null, e.slipped.length, null];
    case "session":
      return [null, null, null, null, null, null, e.ms];
    case "reset":
      return [null, e.perek, e.mishnah, null, null, null, null];
  }
}

syncRoutes.post("/sync", requireUser, async (c) => {
  const v = validateSync(await readJson(c));
  if (!v.ok) return apiError(c, v.tooLarge ? 413 : 400, v.tooLarge ? "payload_too_large" : "bad_request", v.message);
  const t = now();
  const U = c.var.user.id;
  const db = c.env.DB;
  const { cursor } = v.value;
  // Clamp client clocks to the server's.
  const children = v.value.children.map((r) => ({ ...r, updatedAt: Math.min(r.updatedAt, t) }));
  const records = v.value.records.map((r) => ({ ...r, updatedAt: Math.min(r.updatedAt, t) }));
  const events = v.value.events;

  // Ownership pre-check: no referenced child id may belong to another account.
  const referenced = [
    ...new Set([...children.map((r) => r.id), ...records.map((r) => r.childId), ...events.map((e) => e.childId)]),
  ];
  if (referenced.length > 0) {
    const foreign = await db
      .prepare("SELECT id FROM children WHERE id IN (SELECT value FROM json_each(?1)) AND user_id != ?2 LIMIT 1")
      .bind(JSON.stringify(referenced), U)
      .first();
    if (foreign) return apiError(c, 403, "forbidden", "A child in this sync belongs to another account");
  }

  // Child cap (tombstones excluded).
  if (children.length > 0) {
    const existing = await db
      .prepare("SELECT id, deleted FROM children WHERE user_id = ?1")
      .bind(U)
      .all<{ id: string; deleted: number }>();
    const state = new Map(existing.results.map((r) => [r.id, r.deleted === 1]));
    for (const ch of children) {
      const wasDeleted = state.get(ch.id);
      if (wasDeleted === true) continue; // tombstones are final
      state.set(ch.id, ch.deleted);
    }
    let live = 0;
    for (const deleted of state.values()) if (!deleted) live++;
    if (live > SYNC_LIMITS.MAX_CHILDREN) {
      return apiError(c, 400, "bad_request", `At most ${SYNC_LIMITS.MAX_CHILDREN} children per account`);
    }
  }

  const stmts: D1PreparedStatement[] = [];
  const pushed = children.length + records.length + events.length > 0;
  if (pushed) {
    stmts.push(db.prepare("UPDATE users SET rev = rev + 1 WHERE id = ?1").bind(U));
    for (const ch of children) {
      stmts.push(
        db
          .prepare(
            `INSERT INTO children (id, user_id, data, deleted, updated_at, rev, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, (SELECT rev FROM users WHERE id = ?2), ?6)
             ON CONFLICT(id) DO UPDATE SET
               data = excluded.data, deleted = excluded.deleted, updated_at = excluded.updated_at, rev = excluded.rev
             WHERE children.user_id = excluded.user_id
               AND children.deleted = 0
               AND excluded.updated_at > children.updated_at`,
          )
          .bind(ch.id, U, JSON.stringify(ch.meta), ch.deleted ? 1 : 0, ch.updatedAt, t),
      );
    }
    for (const r of records) {
      stmts.push(
        db
          .prepare(
            `INSERT INTO progress (child_id, user_id, kind, key, data, updated_at, rev)
             SELECT ?1, ?2, ?3, ?4, ?5, ?6, u.rev FROM users u
             WHERE u.id = ?2
               AND EXISTS (SELECT 1 FROM children c WHERE c.id = ?1 AND c.user_id = ?2 AND c.deleted = 0)
             ON CONFLICT(child_id, kind, key) DO UPDATE SET
               data = excluded.data, updated_at = excluded.updated_at, rev = excluded.rev
             WHERE excluded.updated_at > progress.updated_at`,
          )
          .bind(r.childId, U, r.kind, r.key, JSON.stringify(r.data), r.updatedAt),
      );
    }
    for (const e of events) {
      stmts.push(
        db
          .prepare(
            `INSERT OR IGNORE INTO events
               (id, user_id, child_id, at, day, type, task, perek, mishnah, grade, peeks, slips, ms, data, received_at)
             SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15
             WHERE EXISTS (SELECT 1 FROM children c WHERE c.id = ?3 AND c.user_id = ?2 AND c.deleted = 0)`,
          )
          .bind(e.id, U, e.childId, e.at, e.day, e.type, ...eventColumns(e), JSON.stringify(e), t),
      );
    }
    stmts.push(
      db
        .prepare(
          "DELETE FROM progress WHERE user_id = ?1 AND child_id IN (SELECT id FROM children WHERE user_id = ?1 AND deleted = 1)",
        )
        .bind(U),
      db
        .prepare(
          "DELETE FROM events WHERE user_id = ?1 AND child_id IN (SELECT id FROM children WHERE user_id = ?1 AND deleted = 1)",
        )
        .bind(U),
    );
  }

  const reads = stmts.length;
  stmts.push(
    db.prepare("SELECT rev FROM users WHERE id = ?1").bind(U),
    db.prepare("SELECT id, data, deleted, updated_at FROM children WHERE user_id = ?1 AND rev > ?2").bind(U, cursor),
    db
      .prepare("SELECT child_id, kind, key, data, updated_at FROM progress WHERE user_id = ?1 AND rev > ?2")
      .bind(U, cursor),
    db
      .prepare(
        "SELECT id, data, deleted, updated_at FROM children WHERE user_id = ?1 AND id IN (SELECT value FROM json_each(?2))",
      )
      .bind(U, JSON.stringify(children.map((r) => r.id))),
    db
      .prepare(
        `SELECT child_id, kind, key, data, updated_at FROM progress
         WHERE user_id = ?1 AND (child_id || '|' || kind || '|' || key) IN (SELECT value FROM json_each(?2))`,
      )
      .bind(U, JSON.stringify(records.map(recordKey))),
  );

  const results = await db.batch(stmts);
  const rev = (results[reads]?.results[0] as { rev: number } | undefined)?.rev ?? 0;
  const childMap = new Map<string, ChildRow>();
  for (const i of [reads + 1, reads + 3]) {
    for (const r of (results[i]?.results ?? []) as ChildDbRow[]) childMap.set(r.id, toChildRow(r));
  }
  const recordMap = new Map<string, RecordRow>();
  for (const i of [reads + 2, reads + 4]) {
    for (const r of (results[i]?.results ?? []) as ProgressDbRow[]) {
      const row = toRecordRow(r);
      recordMap.set(recordKey(row), row);
    }
  }

  const body: SyncResponse = {
    cursor: rev,
    children: [...childMap.values()],
    records: [...recordMap.values()],
    serverTime: t,
  };
  return c.json(body);
});

/**
 * POST /api/sync (learner) and POST /api/parent/sync (unlocked parent): one handler, two roles
 * (docs/PARENT_MODE.md §6.7, §8).
 *
 * Learner: may push progress records and events (LWW, behind the parent fence) and, on existing live children, only
 * `settings.fontScale`, `settings.meaningView` and `settings.lastMasechta`. It can't add, delete or rename children.
 * Parent: full child and record writes, stamped with the server time and `parent_rev` (no LWW), logged to audit_log.
 *
 * The fence: every parent write sets rev = parent_rev = R. A learner push whose cursor < parent_rev (the device has
 * not pulled the parent's edit) never overwrites it, whatever its clock says. Once the device has pulled it
 * (cursor >= R), its next write wins even if its clock is behind the server's (rev = parent_rev means "the last
 * write was the parent's and you have seen it"); after that plain LWW resumes. Rows whose last write was a parent's
 * come back with `byParent: true` so new clients drop a pending local value for that key.
 */
import { Hono, type Context } from "hono";
import {
  SYNC_LIMITS,
  type ChildMeta,
  type ChildRow,
  type LearningEvent,
  type PerekVerificationRow,
  type RecordRow,
  type SyncResponse,
} from "../../shared/api";
import type { AppEnv } from "../env";
import { auditStmt, syncAuditInputs, type PriorChild } from "../lib/audit";
import { apiError, readJson } from "../lib/http";
import { requireUser } from "../lib/session";
import { now } from "../lib/time";
import { validateSync } from "../lib/validate";

export const syncRoutes = new Hono<AppEnv>();

export type SyncRole = "learner" | "parent";

interface ChildDbRow {
  id: string;
  data: string;
  deleted: number;
  updated_at: number;
  by_parent: number;
}
interface ProgressDbRow {
  child_id: string;
  kind: "m" | "p" | "d";
  key: string;
  data: string;
  updated_at: number;
  by_parent: number;
}

function toChildRow(r: ChildDbRow): ChildRow {
  const row: ChildRow = { id: r.id, updatedAt: r.updated_at, deleted: r.deleted === 1, meta: JSON.parse(r.data) as ChildMeta };
  if (r.by_parent === 1) row.byParent = true;
  return row;
}

function toRecordRow(r: ProgressDbRow): RecordRow {
  const row = { childId: r.child_id, kind: r.kind, key: r.key, data: JSON.parse(r.data), updatedAt: r.updated_at } as RecordRow;
  if (r.by_parent === 1) row.byParent = true;
  return row;
}

interface VerificationDbRow {
  child_id: string;
  masechta: string;
  perek: number;
  verified: number;
  verified_at: number | null;
  updated_at: number;
}

export function toVerificationRow(r: VerificationDbRow): PerekVerificationRow {
  return {
    childId: r.child_id,
    masechta: r.masechta,
    perek: r.perek,
    verified: r.verified === 1,
    verifiedAt: r.verified_at,
    updatedAt: r.updated_at,
  };
}

const recordKey = (r: { childId: string; kind: string; key: string }): string => `${r.childId}|${r.kind}|${r.key}`;

const BY_PARENT = "(parent_rev IS NOT NULL AND rev = parent_rev) AS by_parent";
const CHILD_COLS = `id, data, deleted, updated_at, ${BY_PARENT}`;
const PROGRESS_COLS = `child_id, kind, key, data, updated_at, ${BY_PARENT}`;
const VERIF_COLS = "child_id, masechta, perek, verified, verified_at, updated_at";

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

function parseMeta(data: string): ChildMeta | null {
  try {
    return JSON.parse(data) as ChildMeta;
  } catch {
    return null;
  }
}

export async function runSync(c: Context<AppEnv>, role: SyncRole): Promise<Response> {
  const v = validateSync(await readJson(c));
  if (!v.ok) return apiError(c, v.tooLarge ? 413 : 400, v.tooLarge ? "payload_too_large" : "bad_request", v.message);
  const t = now();
  const U = c.var.user.id;
  const db = c.env.DB;
  const { cursor } = v.value;
  // Clamp client clocks to the server's. Parent writes ignore them (server time).
  const children = v.value.children.map((r) => ({ ...r, updatedAt: role === "parent" ? t : Math.min(r.updatedAt, t) }));
  const records = v.value.records.map((r) => ({ ...r, updatedAt: role === "parent" ? t : Math.min(r.updatedAt, t) }));
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

  // Parent: pre-read for the child cap, the log's old names, and new vs. existing.
  const prior = new Map<string, PriorChild>();
  if (role === "parent" && children.length + records.length > 0) {
    const existing = await db
      .prepare("SELECT id, deleted, data FROM children WHERE user_id = ?1")
      .bind(U)
      .all<{ id: string; deleted: number; data: string }>();
    for (const r of existing.results) prior.set(r.id, { deleted: r.deleted === 1, meta: parseMeta(r.data) });
    if (children.length > 0) {
      const state = new Map([...prior].map(([id, p]) => [id, p.deleted]));
      for (const ch of children) {
        if (state.get(ch.id) === true) continue; // tombstones are final
        state.set(ch.id, ch.deleted);
      }
      let live = 0;
      for (const deleted of state.values()) if (!deleted) live++;
      if (live > SYNC_LIMITS.MAX_CHILDREN) {
        return apiError(c, 400, "bad_request", `At most ${SYNC_LIMITS.MAX_CHILDREN} children per account`);
      }
    }
  }

  const stmts: D1PreparedStatement[] = [];
  const pushed = children.length + records.length + events.length > 0;
  if (pushed) {
    stmts.push(db.prepare("UPDATE users SET rev = rev + 1 WHERE id = ?1").bind(U));
    for (const ch of children) {
      if (role === "parent") {
        stmts.push(
          db
            .prepare(
              `INSERT INTO children (id, user_id, data, deleted, updated_at, rev, created_at, parent_rev)
               VALUES (?1, ?2, ?3, ?4, ?5, (SELECT rev FROM users WHERE id = ?2), ?5, (SELECT rev FROM users WHERE id = ?2))
               ON CONFLICT(id) DO UPDATE SET
                 data = CASE WHEN json_type(children.data, '$.settings.lastMasechta') = 'text'
                             THEN json_set(excluded.data, '$.settings.lastMasechta', json_extract(children.data, '$.settings.lastMasechta'))
                             ELSE excluded.data END,
                 deleted = excluded.deleted, updated_at = excluded.updated_at,
                 rev = excluded.rev, parent_rev = excluded.parent_rev
               WHERE children.user_id = excluded.user_id AND children.deleted = 0`,
            )
            .bind(ch.id, U, JSON.stringify(ch.meta), ch.deleted ? 1 : 0, t),
        );
      } else if (!ch.deleted) {
        // Learner: only the reading aids and the last opened masechta, merged into an existing live child, behind the
        // fence. New ids, deletes, renames and every other setting are ignored (the echo below sends the server's row
        // back). An absent field keeps the stored one (json_patch), so an old client can't clear lastMasechta.
        const patch: Record<string, unknown> = { fontScale: ch.meta.settings.fontScale };
        if (ch.meta.settings.meaningView !== undefined) patch.meaningView = ch.meta.settings.meaningView;
        if (ch.meta.settings.lastMasechta !== undefined) patch.lastMasechta = ch.meta.settings.lastMasechta;
        stmts.push(
          db
            .prepare(
              `UPDATE children
               SET data = json_set(data, '$.settings', json(json_patch(coalesce(json_extract(data, '$.settings'), '{}'), ?3))),
                   updated_at = ?4, rev = (SELECT rev FROM users WHERE id = ?2)
               WHERE id = ?1 AND user_id = ?2 AND deleted = 0
                 AND (parent_rev IS NULL OR ?5 >= parent_rev)
                 AND (?4 > updated_at OR rev = parent_rev)`,
            )
            .bind(ch.id, U, JSON.stringify(patch), ch.updatedAt, cursor),
        );
      }
    }
    for (const r of records) {
      if (role === "parent") {
        stmts.push(
          db
            .prepare(
              `INSERT INTO progress (child_id, user_id, kind, key, data, updated_at, rev, parent_rev)
               SELECT ?1, ?2, ?3, ?4, ?5, ?6, u.rev, u.rev FROM users u
               WHERE u.id = ?2
                 AND EXISTS (SELECT 1 FROM children c WHERE c.id = ?1 AND c.user_id = ?2 AND c.deleted = 0)
               ON CONFLICT(child_id, kind, key) DO UPDATE SET
                 data = excluded.data, updated_at = excluded.updated_at, rev = excluded.rev, parent_rev = excluded.parent_rev`,
            )
            .bind(r.childId, U, r.kind, r.key, JSON.stringify(r.data), t),
        );
      } else {
        stmts.push(
          db
            .prepare(
              `INSERT INTO progress (child_id, user_id, kind, key, data, updated_at, rev)
               SELECT ?1, ?2, ?3, ?4, ?5, ?6, u.rev FROM users u
               WHERE u.id = ?2
                 AND EXISTS (SELECT 1 FROM children c WHERE c.id = ?1 AND c.user_id = ?2 AND c.deleted = 0)
               ON CONFLICT(child_id, kind, key) DO UPDATE SET
                 data = CASE WHEN excluded.kind = 'p'
                               AND json_type(excluded.data, '$.chains') IS NULL
                               AND json_type(progress.data, '$.chains') IS NOT NULL
                             THEN json_set(excluded.data, '$.chains', json(json_extract(progress.data, '$.chains')))
                             ELSE excluded.data END,
                 updated_at = excluded.updated_at, rev = excluded.rev
               WHERE (progress.parent_rev IS NULL OR ?7 >= progress.parent_rev)
                 AND (excluded.updated_at > progress.updated_at OR progress.rev = progress.parent_rev)`,
            )
            .bind(r.childId, U, r.kind, r.key, JSON.stringify(r.data), r.updatedAt, cursor),
        );
      }
    }
    for (const e of events) {
      stmts.push(
        db
          .prepare(
            `INSERT OR IGNORE INTO events
               (id, user_id, child_id, at, day, type, task, perek, mishnah, grade, peeks, slips, ms, data, received_at, masechta)
             SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16
             WHERE EXISTS (SELECT 1 FROM children c WHERE c.id = ?3 AND c.user_id = ?2 AND c.deleted = 0)`,
          )
          // masechta NULL = Berakhot (older clients send none).
          .bind(e.id, U, e.childId, e.at, e.day, e.type, ...eventColumns(e), JSON.stringify(e), t, e.masechta ?? null),
      );
    }
    if (role === "parent") {
      const p = c.var.parent!;
      const actor = { email: p.loginEmail, sessionId: p.sessionId, device: p.userAgent };
      for (const a of syncAuditInputs({ userId: U, at: t, actor }, prior, children, records)) stmts.push(auditStmt(db, a));
    }
    for (const table of ["progress", "events", "perek_tests", "perek_verifications"]) {
      stmts.push(
        db
          .prepare(
            `DELETE FROM ${table} WHERE user_id = ?1 AND child_id IN (SELECT id FROM children WHERE user_id = ?1 AND deleted = 1)`,
          )
          .bind(U),
      );
    }
  }

  // Learner pushes of `deleted: true` for a child that is live on the server are ignored. Send that child's progress
  // and verifications back with the child, so an old SPA that deleted it locally gets everything back (instead of a
  // blank child whose next learning would overwrite real progress).
  const undeleted = role === "learner" ? children.filter((r) => r.deleted).map((r) => r.id) : [];

  const reads = stmts.length;
  stmts.push(
    db.prepare("SELECT rev FROM users WHERE id = ?1").bind(U),
    db.prepare(`SELECT ${CHILD_COLS} FROM children WHERE user_id = ?1 AND rev > ?2`).bind(U, cursor),
    db.prepare(`SELECT ${PROGRESS_COLS} FROM progress WHERE user_id = ?1 AND rev > ?2`).bind(U, cursor),
    db
      .prepare(`SELECT ${CHILD_COLS} FROM children WHERE user_id = ?1 AND id IN (SELECT value FROM json_each(?2))`)
      .bind(U, JSON.stringify(children.map((r) => r.id))),
    db
      .prepare(
        `SELECT ${PROGRESS_COLS} FROM progress
         WHERE user_id = ?1 AND (child_id || '|' || kind || '|' || key) IN (SELECT value FROM json_each(?2))`,
      )
      .bind(U, JSON.stringify(records.map(recordKey))),
    // Server-owned verifications (docs/PARENT_VERIFICATION.md §7.1). Pull only: nothing in a SyncRequest writes them.
    db
      .prepare(
        `SELECT ${VERIF_COLS} FROM perek_verifications
         WHERE user_id = ?1 AND rev > ?2
           AND child_id IN (SELECT id FROM children WHERE user_id = ?1 AND deleted = 0)`,
      )
      .bind(U, cursor),
    db
      .prepare(
        `SELECT ${PROGRESS_COLS} FROM progress
         WHERE user_id = ?1 AND child_id IN (SELECT value FROM json_each(?2))
           AND child_id IN (SELECT id FROM children WHERE user_id = ?1 AND deleted = 0)`,
      )
      .bind(U, JSON.stringify(undeleted)),
    db
      .prepare(
        `SELECT ${VERIF_COLS} FROM perek_verifications
         WHERE user_id = ?1 AND child_id IN (SELECT value FROM json_each(?2))
           AND child_id IN (SELECT id FROM children WHERE user_id = ?1 AND deleted = 0)`,
      )
      .bind(U, JSON.stringify(undeleted)),
  );

  const results = await db.batch(stmts);
  const rev = (results[reads]?.results[0] as { rev: number } | undefined)?.rev ?? 0;
  const childMap = new Map<string, ChildRow>();
  for (const i of [reads + 1, reads + 3]) {
    for (const r of (results[i]?.results ?? []) as ChildDbRow[]) childMap.set(r.id, toChildRow(r));
  }
  const recordMap = new Map<string, RecordRow>();
  for (const i of [reads + 2, reads + 4, reads + 6]) {
    for (const r of (results[i]?.results ?? []) as ProgressDbRow[]) {
      const row = toRecordRow(r);
      recordMap.set(recordKey(row), row);
    }
  }
  const verifMap = new Map<string, PerekVerificationRow>();
  for (const i of [reads + 5, reads + 7]) {
    for (const r of (results[i]?.results ?? []) as VerificationDbRow[]) {
      const row = toVerificationRow(r);
      verifMap.set(`${row.childId}|${row.masechta}|${row.perek}`, row);
    }
  }

  const body: SyncResponse = {
    cursor: rev,
    children: [...childMap.values()],
    records: [...recordMap.values()],
    serverTime: t,
    verifications: [...verifMap.values()],
  };
  return c.json(body);
}

syncRoutes.post("/sync", requireUser, (c) => runSync(c, "learner"));

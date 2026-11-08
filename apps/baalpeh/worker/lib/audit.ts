/** The change log shown in parent mode (docs/PARENT_MODE.md §6.6). Keyed to the account; the actor names the login. */
import type { AuditAction, AuditEntry, ChildMeta, ChildRow, RecordRow } from "../../shared/api";

export interface Actor {
  /** The parent session's login email, or the address a link went to. */
  email: string | null;
  /** sessions.id; null for links. */
  sessionId: string | null;
  /** User-Agent (cut to 200 chars here). */
  device: string | null;
}

export type AuditVia = AuditEntry["via"];

export interface AuditInput {
  userId: string;
  at: number;
  action: AuditAction;
  childId?: string | null;
  childName?: string | null;
  detail?: Record<string, unknown>;
  via: AuditVia;
  actor: Actor;
}

const INSERT = `INSERT INTO audit_log
  (id, user_id, at, action, child_id, child_name, detail, via, actor_email, actor_session, actor_device)`;

function binds(a: AuditInput): unknown[] {
  return [
    crypto.randomUUID(),
    a.userId,
    a.at,
    a.action,
    a.childId ?? null,
    a.childName ?? null,
    JSON.stringify(a.detail ?? {}),
    a.via,
    a.actor.email,
    a.actor.sessionId,
    a.actor.device === null ? null : a.actor.device.slice(0, 200),
  ];
}

/**
 * One log row. With `when`, the row is written only if that SQL condition holds at that point of the batch; its
 * placeholders start at ?12 and take `when.params`.
 */
export function auditStmt(db: D1Database, a: AuditInput, when?: { sql: string; params: unknown[] }): D1PreparedStatement {
  if (!when) return db.prepare(`${INSERT} VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)`).bind(...binds(a));
  return db
    .prepare(`${INSERT} SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11 WHERE ${when.sql}`)
    .bind(...binds(a), ...when.params);
}

export interface AuditDbRow {
  id: string;
  at: number;
  action: AuditAction;
  child_id: string | null;
  child_name: string | null;
  detail: string;
  via: AuditVia;
  actor_email: string | null;
  actor_device: string | null;
}

export function toAuditEntry(r: AuditDbRow): AuditEntry {
  let detail: Record<string, unknown> = {};
  try {
    const d = JSON.parse(r.detail) as unknown;
    if (d && typeof d === "object" && !Array.isArray(d)) detail = d as Record<string, unknown>;
  } catch {
    // keep {}
  }
  return {
    id: r.id,
    at: r.at,
    action: r.action,
    childId: r.child_id,
    childName: r.child_name,
    detail,
    via: r.via,
    actorEmail: r.actor_email,
    actorDevice: r.actor_device,
  };
}

const MAX_KEYS = 60;

/** Settings that are the learner's navigation state, not a parent's edit: never named in the log. */
const UNLOGGED_SETTINGS = new Set(["lastMasechta"]);

/** Fields of a child's meta that a log line names. `sort` alone is not logged, nor UNLOGGED_SETTINGS. */
function changedFields(from: ChildMeta, to: ChildMeta): string[] {
  const out: string[] = [];
  for (const f of ["name", "emoji", "color"] as const) if (from[f] !== to[f]) out.push(f);
  if (from.sort !== to.sort) out.push("sort");
  const keys = new Set([...Object.keys(from.settings ?? {}), ...Object.keys(to.settings ?? {})]);
  for (const k of [...keys].sort()) {
    if (UNLOGGED_SETTINGS.has(k)) continue;
    const a = (from.settings as unknown as Record<string, unknown> | undefined)?.[k];
    const b = (to.settings as unknown as Record<string, unknown> | undefined)?.[k];
    if (a !== b) out.push(`settings.${k}`);
  }
  return out;
}

export interface PriorChild {
  deleted: boolean;
  meta: ChildMeta | null;
}

/**
 * The log rows of one parent sync, built in JS from the pre-read (`prior`) and the pushed rows. Parent writes are
 * unconditional (server time, no LWW), so what was pushed is what is written.
 */
export function syncAuditInputs(
  base: { userId: string; at: number; actor: Actor },
  prior: Map<string, PriorChild>,
  children: ChildRow[],
  records: RecordRow[],
): AuditInput[] {
  const out: AuditInput[] = [];
  const common = { userId: base.userId, at: base.at, via: "parent" as const, actor: base.actor };
  const recordsByChild = new Map<string, RecordRow[]>();
  for (const r of records) {
    const list = recordsByChild.get(r.childId) ?? [];
    list.push(r);
    recordsByChild.set(r.childId, list);
  }
  const added = new Set<string>();
  const removed = new Set<string>();
  const state = new Map(prior);
  for (const ch of children) {
    const before = state.get(ch.id);
    if (before?.deleted) continue; // tombstones are final
    if (!before) {
      if (ch.deleted) continue;
      const rows = recordsByChild.get(ch.id)?.length ?? 0;
      added.add(ch.id);
      out.push({ ...common, action: "child_added", childId: ch.id, childName: ch.meta.name, detail: { imported: rows > 0, rows } });
    } else if (ch.deleted) {
      removed.add(ch.id);
      out.push({ ...common, action: "child_removed", childId: ch.id, childName: before.meta?.name ?? ch.meta.name, detail: {} });
    } else if (before.meta) {
      const fields = changedFields(before.meta, ch.meta);
      if (fields.some((f) => f !== "sort")) {
        const detail: Record<string, unknown> = { fields };
        if (fields.includes("name")) {
          detail.from = { name: before.meta.name };
          detail.to = { name: ch.meta.name };
        }
        out.push({ ...common, action: "child_edited", childId: ch.id, childName: ch.meta.name, detail });
      }
    }
    state.set(ch.id, { deleted: ch.deleted, meta: ch.meta });
  }
  for (const [childId, rows] of recordsByChild) {
    if (added.has(childId) || removed.has(childId)) continue;
    const s = state.get(childId);
    if (!s || s.deleted) continue; // not written: unknown or tombstoned child
    const keys = rows.filter((r) => r.kind !== "d").map((r) => `${r.kind}:${r.key}`);
    if (keys.length === 0) continue;
    out.push({
      ...common,
      action: "progress_edited",
      childId,
      childName: s.meta?.name ?? null,
      detail: { keys: keys.slice(0, MAX_KEYS), count: keys.length },
    });
  }
  return out;
}

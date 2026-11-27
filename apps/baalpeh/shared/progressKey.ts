/**
 * shared/progressKey.ts — progress record keys for more than one masechta (docs/SERVER_PLAN.md §8.1).
 * Pure, no imports: used by the Worker (validation) and the SPA (progress, sync mapping, import).
 *
 * Berakhot keeps the original unqualified keys forever: "perek:mishnah" ("1:2") and "perek" ("1").
 * Every other masechta qualifies them with its catalog id: "peah/1:2", "peah/1".
 * "berakhot/…" is non-canonical: it is never written, the client never pushes it and the Worker rejects it.
 */

/** The masechta that the unqualified keys (and events without `masechta`) mean. */
export const LEGACY_MASECHTA_ID = "berakhot";

/** A catalog id: lowercase letter, then 1..31 lowercase letters, digits or underscores. */
export const MASECHTA_ID_RE = /^[a-z][a-z0-9_]{1,31}$/;

const M_RE = /^(?:([a-z][a-z0-9_]{1,31})\/)?(\d{1,3}):(\d{1,3})$/;
const P_RE = /^(?:([a-z][a-z0-9_]{1,31})\/)?(\d{1,3})$/;

export function isMasechtaId(v: unknown): v is string {
  return typeof v === "string" && MASECHTA_ID_RE.test(v);
}

/**
 * A child's last place in the library, "<masechta>/<perek>/<mishnah>" (e.g. "peah/2/3"), by format only: the client
 * re-checks it against the catalog when reading it (src/library/location.ts).
 */
export function isLibraryPlace(v: unknown): v is string {
  if (typeof v !== "string" || v.length > 80) return false;
  const [m, p, n, ...rest] = v.split("/");
  return rest.length === 0 && isMasechtaId(m) && /^[1-9]\d{0,2}$/.test(p ?? "") && /^[1-9]\d{0,2}$/.test(n ?? "");
}

const prefix = (masechta: string): string => (masechta === LEGACY_MASECHTA_ID ? "" : `${masechta}/`);

/** Mishnah record key: "1:2" for Berakhot, "peah/1:2" otherwise. */
export function progressKey(masechta: string, perek: number, mishnah: number): string {
  return `${prefix(masechta)}${perek}:${mishnah}`;
}

/** Perek record key: "1" for Berakhot, "peah/1" otherwise. */
export function perekKey(masechta: string, perek: number): string {
  return `${prefix(masechta)}${perek}`;
}

export interface ParsedProgressKey {
  masechta: string;
  perek: number;
  /** null for a perek key. */
  mishnah: number | null;
}

/**
 * Parses a canonical key of `kind` ("m": mishnah, "p": perek). Returns null for anything malformed and for the
 * non-canonical "berakhot/…" form.
 */
export function parseProgressKey(kind: "m" | "p", key: string): ParsedProgressKey | null {
  if (typeof key !== "string") return null;
  const m = (kind === "m" ? M_RE : P_RE).exec(key);
  if (!m) return null;
  const qualifier = m[1];
  if (qualifier === LEGACY_MASECHTA_ID) return null;
  return {
    masechta: qualifier ?? LEGACY_MASECHTA_ID,
    perek: Number(m[2]),
    mishnah: kind === "m" ? Number(m[3]) : null,
  };
}

/** True when `key` is a canonical key of `kind` for `masechta`. */
export function keyBelongsTo(kind: "m" | "p", key: string, masechta: string): boolean {
  return parseProgressKey(kind, key)?.masechta === masechta;
}

/** The masechta of a practice-log event: absent (older events) means Berakhot. */
export function eventMasechta(e: { masechta?: string }): string {
  return e.masechta ?? LEGACY_MASECHTA_ID;
}

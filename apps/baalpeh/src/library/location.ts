import { entryOf, perekSize } from "../data";
import type { KV } from "../sync/store";
import type { MeaningView } from "../types";

/**
 * The library's place in the Mishnah, its URL and what it remembers. Pure (no React); the library tracks no progress,
 * so the only thing it ever stores is the last place read, on this device.
 *
 * URLs: /library (home), /library/<seder> (its masechtos, e.g. /library/s:moed), /library/<masechta> (its perakim),
 * /library/<masechta>/<perek> (reading, from the top), /library/<masechta>/<perek>/<mishnah> (reading, scrolled to it).
 */
export const LIBRARY_PATH = "/library";

export type LibraryPlace =
  | { v: "home" }
  | { v: "seder"; seder: string }
  | { v: "masechta"; m: string }
  | { v: "read"; m: string; perek: number; mishnah?: number };

/** A place to read: a perek of a catalog masechta, at an optional mishnah. */
export interface ReadPlace { m: string; perek: number; mishnah?: number }

const SEDER_PREFIX = "s:";

/** Whether a path is in the library (so App opens it instead of the sign-in shell). */
export const isLibraryPath = (path: string): boolean => {
  const p = path.replace(/\/+$/, "");
  return p === LIBRARY_PATH || p.startsWith(`${LIBRARY_PATH}/`);
};

const posInt = (s: string | undefined): number | null => (s !== undefined && /^[1-9]\d{0,2}$/.test(s) ? Number(s) : null);

/**
 * A library path to a place. Anything that doesn't name a real place (unknown masechta, perek or mishnah out of range)
 * falls back to the nearest valid place above it, so an old or mistyped link still opens something sensible.
 */
export function parseLibraryPath(path: string, sederIds: readonly string[]): LibraryPlace {
  const parts = path.replace(/\/+$/, "").slice(LIBRARY_PATH.length).split("/").filter(Boolean).map(decodeURIComponent);
  const [first, p, n] = parts;
  if (!first) return { v: "home" };
  if (first.startsWith(SEDER_PREFIX)) {
    const seder = first.slice(SEDER_PREFIX.length);
    return sederIds.includes(seder) ? { v: "seder", seder } : { v: "home" };
  }
  const e = entryOf(first);
  if (!e) return { v: "home" };
  const perek = posInt(p);
  if (perek === null || perek > e.perakim.length) return { v: "masechta", m: e.id };
  const mishnah = posInt(n);
  const shape = { id: e.id, perakim: e.perakim };
  return mishnah !== null && mishnah <= perekSize(shape, perek) ? { v: "read", m: e.id, perek, mishnah } : { v: "read", m: e.id, perek };
}

/** The URL of a place (the inverse of parseLibraryPath). */
export function libraryPath(place: LibraryPlace): string {
  switch (place.v) {
    case "home": return LIBRARY_PATH;
    case "seder": return `${LIBRARY_PATH}/${SEDER_PREFIX}${encodeURIComponent(place.seder)}`;
    case "masechta": return `${LIBRARY_PATH}/${encodeURIComponent(place.m)}`;
    case "read": return `${LIBRARY_PATH}/${encodeURIComponent(place.m)}/${place.perek}${place.mishnah ? `/${place.mishnah}` : ""}`;
  }
}

/** The neighbouring perek inside the masechta, or null at either end. */
export function neighbourPerek(m: string, perek: number, dir: 1 | -1): number | null {
  const e = entryOf(m);
  const next = perek + dir;
  return e && next >= 1 && next <= e.perakim.length ? next : null;
}

/** Device-local memory of the last place read ("Continue where you left off"). Never synced, never per child. */
export const LAST_PLACE_KEY = "baalpeh:library:last";
/** The library's own text size (it has no learner whose settings it could use). */
export const LIBRARY_SCALE_KEY = "baalpeh:library:scale";

export function loadLastPlace(kv: KV): ReadPlace | null {
  let raw: string | null;
  try { raw = kv.getItem(LAST_PLACE_KEY); } catch { return null; }
  if (!raw) return null;
  try {
    const x: unknown = JSON.parse(raw);
    if (typeof x !== "object" || x === null) return null;
    const { m, perek, mishnah } = x as Record<string, unknown>;
    if (typeof m !== "string" || typeof perek !== "number") return null;
    // Re-validate through the URL parser: the catalog may have changed since it was saved.
    const place = parseLibraryPath(libraryPath({ v: "read", m, perek, ...(typeof mishnah === "number" ? { mishnah } : {}) }), []);
    return place.v === "read" ? { m: place.m, perek: place.perek, ...(place.mishnah ? { mishnah: place.mishnah } : {}) } : null;
  } catch {
    return null;
  }
}

export function saveLastPlace(kv: KV, place: ReadPlace): void {
  try { kv.setItem(LAST_PLACE_KEY, JSON.stringify(place)); } catch { /* storage unavailable: nothing to resume next time */ }
}

export const SCALE_MIN = 0.8;
export const SCALE_MAX = 1.6;

export function loadScale(kv: KV): number {
  try {
    const n = Number(kv.getItem(LIBRARY_SCALE_KEY));
    return Number.isFinite(n) && n >= SCALE_MIN && n <= SCALE_MAX ? n : 1;
  } catch {
    return 1;
  }
}

export function saveScale(kv: KV, scale: number): void {
  try { kv.setItem(LIBRARY_SCALE_KEY, String(scale)); } catch { /* ignore */ }
}

/** The library's meaning view (Simple or Steinsaltz), separate from any child's setting. */
export const LIBRARY_VIEW_KEY = "baalpeh:library:view";

export function loadView(kv: KV): MeaningView {
  try { return kv.getItem(LIBRARY_VIEW_KEY) === "steinsaltz" ? "steinsaltz" : "simple"; } catch { return "simple"; }
}

export function saveView(kv: KV, v: MeaningView): void {
  try { kv.setItem(LIBRARY_VIEW_KEY, v); } catch { /* ignore */ }
}

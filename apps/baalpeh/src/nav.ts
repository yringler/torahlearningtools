import { CATALOG, DEFAULT_MASECHTA_ID, entryOf, mishnayosCount, SEDARIM, sederOf, shapeOf, type CatalogEntry } from "./data";
import { dueByMasechta, dueReviews, gatedDueReviews, gatedNextLearning, knownCount, nextLearning, startedCount, type Verified } from "./progress";
import { today } from "./srs";
import { parsePlaceToken, placeToken, type ReadPlace } from "./library/location";
import type { Profile } from "./types";

/**
 * Pure helpers for the Seder → Masechta → Perek map navigation (no React, no text: catalog counts only).
 * Picking a child opens the perek map of the child's last masechta; the map's "Choose a different masechta" opens the
 * masechta list of its seder, and that list's "Choose a different seder" opens the seder list.
 */

/** A catalog id, or the default masechta for anything else (absent, unknown, removed from the catalog). */
export function resolveMasechta(id: unknown): string {
  return typeof id === "string" && entryOf(id) ? id : DEFAULT_MASECHTA_ID;
}

/** The masechta a child's perek map opens at. */
export const lastMasechtaOf = (p: Profile): string => resolveMasechta(p.settings.lastMasechta);

/** The seder of a (resolved) masechta. */
export const sederIdOf = (masechta: string): string => sederOf(resolveMasechta(masechta))?.id ?? SEDARIM[0]?.id ?? "";

/**
 * Choosing a masechta: `settings.lastMasechta` is written only when the choice changes what the child opens at (so
 * reopening the same masechta, or choosing the default when nothing is stored, writes nothing and syncs nothing).
 * Returns `p` itself when nothing changes.
 */
export function chooseMasechta(p: Profile, id: string): Profile {
  if (!entryOf(id) || lastMasechtaOf(p) === id) return p;
  return { ...p, settings: { ...p.settings, lastMasechta: id } };
}

/** "מסכת פאה" */
export const masechtaHe = (id: string): string => `מסכת ${entryOf(id)?.he ?? ""}`;

/** "Peah" */
export const masechtaEn = (id: string): string => entryOf(id)?.en ?? id;

/** Due reviews of one masechta, through the parent gate when `verified` is given (signed in). */
function dueIn(p: Profile, id: string, now: string, verified: Verified | undefined): number {
  const ms = shapeOf(id);
  return (verified ? gatedDueReviews(p, ms, verified, now) : dueReviews(p, ms, now)).length;
}

export interface MasechtaTile {
  id: string;
  he: string;
  en: string;
  known: number;
  total: number;
  due: number;
  /** The masechta the child's map is on now (outlined in the child's colour). */
  current: boolean;
  translated: boolean;
  /** Every mishnah known and nothing left to learn (gated when signed in). */
  finished: boolean;
}

function tileOf(p: Profile, e: CatalogEntry, current: string, now: string, verifiedOf?: (id: string) => Verified): MasechtaTile {
  const ms = shapeOf(e.id);
  const v = verifiedOf?.(e.id);
  const total = mishnayosCount(ms);
  const known = knownCount(p, ms);
  const next = v ? gatedNextLearning(p, ms, v) : nextLearning(p, ms);
  return {
    id: e.id, he: e.he, en: e.en, known, total, due: dueIn(p, e.id, now, v), current: e.id === current,
    translated: e.translated, finished: next === null && known === total,
  };
}

/** The masechta list of one seder, in catalog order. */
export function masechtaTiles(p: Profile, seder: string, current: string, now: string = today(), verifiedOf?: (id: string) => Verified): MasechtaTile[] {
  return CATALOG.filter((e) => e.seder === seder).map((e) => tileOf(p, e, current, now, verifiedOf));
}

export interface SederTile {
  id: string;
  he: string;
  en: string;
  masechtos: number;
  known: number;
  total: number;
  due: number;
  current: boolean;
}

/** The seder list: each seder's totals over its masechtos. */
export function sederTiles(p: Profile, current: string, now: string = today(), verifiedOf?: (id: string) => Verified): SederTile[] {
  const cur = sederIdOf(current);
  return SEDARIM.map((s) => {
    const tiles = masechtaTiles(p, s.id, current, now, verifiedOf);
    const sum = (f: (t: MasechtaTile) => number) => tiles.reduce((a, t) => a + f(t), 0);
    return { id: s.id, he: s.he, en: s.en, masechtos: tiles.length, known: sum((t) => t.known), total: sum((t) => t.total), due: sum((t) => t.due), current: s.id === cur };
  });
}

/** Masechtos other than `current` with due reviews: the perek map's "🔁 3 reviews waiting in מסכת ברכות" rows. */
export function otherDue(p: Profile, current: string, now: string = today(), verifiedOf?: (id: string) => Verified): Array<{ masechta: string; due: number }> {
  return dueByMasechta(p, now, verifiedOf).filter((x) => x.masechta !== current);
}

/**
 * "Berakhot: 5 known, 2 started · Peah: 3 known" — a profile's progress per catalog masechta (only keys that belong to
 * it count), or "nothing learned yet". The import prompt uses it.
 */
export function progressSummary(p: Profile): string {
  const parts: string[] = [];
  for (const e of CATALOG) {
    const ms = shapeOf(e.id);
    const known = knownCount(p, ms);
    const started = startedCount(p, ms);
    if (known === 0 && started === 0) continue;
    parts.push(`${e.en}: ${known} known${started > 0 ? `, ${started} started` : ""}`);
  }
  return parts.length ? parts.join(" · ") : "nothing learned yet";
}

/** "🔁 3 reviews waiting in מסכת ברכות" */
export const nudgeText = (due: number, masechta: string): string =>
  `🔁 ${due} review${due === 1 ? "" : "s"} waiting in ${masechtaHe(masechta)}`;

/**
 * What the masechta gate shows when loading failed: "offline" (no connection and the masechta isn't saved on this
 * device: it needs the internet once) or "error" (anything else: Retry).
 */
export const loadFailure = (online: boolean, downloaded: boolean): "offline" | "error" => (!online && !downloaded ? "offline" : "error");

/** The tile's "needs internet" hint: offline, and this masechta isn't saved on the device (nor in memory). */
export const needsInternet = (online: boolean, available: boolean): boolean => !online && !available;

/** Where the child last read in the library (null: never, or the place no longer exists). */
export const libraryPlaceOf = (p: Profile): ReadPlace | null => parsePlaceToken(p.settings.libraryPlace);

/** The child with a new library place; `p` itself when it is already there (so nothing syncs). */
export function withLibraryPlace(p: Profile, r: ReadPlace): Profile {
  const token = placeToken(r);
  return p.settings.libraryPlace === token ? p : { ...p, settings: { ...p.settings, libraryPlace: token } };
}

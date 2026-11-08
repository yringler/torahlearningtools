import type { Ms } from "../../shared/api";
import { isMasechtaId, LEGACY_MASECHTA_ID } from "../../shared/progressKey";
import { profileToRows } from "../sync/mapping";
import { addPending, type AccountStore } from "../sync/store";
import type { Profile } from "../types";

const norm = (s: string) => s.trim().toLocaleLowerCase();

/**
 * Device (guest / pre-account) progress is offered for import, by the prompt and by the parent area's button, only
 * into an account with no children yet (owner's rule, docs/PARENT_VERIFICATION.md §9), and only once this device has
 * synced, so "not pulled yet" isn't mistaken for "no children". Backup-file import is separate and always offered.
 */
export function canImportDevice(legacyCount: number, accountChildren: number, lastSyncAt: Ms | null): boolean {
  return legacyCount > 0 && accountChildren === 0 && lastSyncAt !== null;
}

/** Which legacy profiles start checked in the import prompt: all, except names already in the account. */
export function importDefaults(legacy: Profile[], existing: Profile[]): Record<string, boolean> {
  const names = new Set(existing.map((p) => norm(p.name)));
  return Object.fromEntries(legacy.map((p) => [p.id, !names.has(norm(p.name))]));
}

/** Copies profiles under new ids (for v1 import and backup import). */
export function copyAsNew(selected: Profile[], newId: () => string = () => crypto.randomUUID()): Profile[] {
  return selected.map((p) => ({ ...p, id: newId() }));
}

/** §9.6: append copies with new ids, queue all their rows, and remember the decision. */
export function importLegacy(s: AccountStore, selected: Profile[], now: Ms, newId?: () => string): AccountStore {
  const copies = copyAsNew(selected, newId);
  const base = s.profiles.length;
  const rows = copies.map((p, i) => profileToRows(p, base + i, now));
  const next = addPending(s, { children: rows.map((r) => r.child), records: rows.flatMap((r) => r.records) });
  return { ...next, profiles: [...s.profiles, ...copies], importDecision: "imported" };
}

/** Keeps only object values (a hand-edited backup can hold `null` or numbers, which the app can't read). */
function entries<T>(m: Record<string, T>): Record<string, T> {
  return Object.fromEntries(Object.entries(m).filter(([, v]) => typeof v === "object" && v !== null && !Array.isArray(v)));
}

const NON_CANONICAL = `${LEGACY_MASECHTA_ID}/`;

/**
 * Rewrites the non-canonical "berakhot/1:2" ("berakhot/1") to the canonical "1:2" ("1"). When both exist, the
 * unqualified one wins. Other keys are kept as they are (the sync mapping skips malformed ones).
 */
function canonicalKeys<T>(m: Record<string, T>): Record<string, T> {
  const out: Record<string, T> = {};
  for (const [k, v] of Object.entries(m)) if (!k.startsWith(NON_CANONICAL)) out[k] = v;
  for (const [k, v] of Object.entries(m)) {
    if (!k.startsWith(NON_CANONICAL)) continue;
    const bare = k.slice(NON_CANONICAL.length);
    if (bare && !Object.prototype.hasOwnProperty.call(out, bare)) out[bare] = v;
  }
  return out;
}

/** Fills in fields an old or hand-edited backup may lack, so the app and the sync mapping can rely on them. */
export function normalizeProfile(x: Profile, index: number): Profile {
  const p = (typeof x === "object" && x !== null ? x : {}) as Partial<Profile>;
  const obj = <T,>(v: T | undefined): T => (typeof v === "object" && v !== null && !Array.isArray(v) ? v : ({} as T));
  const settings = obj(p.settings);
  return {
    id: typeof p.id === "string" && p.id ? p.id : `legacy-${index}`,
    name: typeof p.name === "string" && p.name.trim() ? p.name : `Child ${index + 1}`,
    color: typeof p.color === "string" ? p.color : "#2f7d6d",
    emoji: typeof p.emoji === "string" ? p.emoji : "🐮",
    settings: {
      fontScale: typeof settings.fontScale === "number" ? settings.fontScale : 1,
      // The old `dailyMinutes` was always on by default, so it is not carried over: breaks stay off until a parent turns them on.
      ...(typeof settings.breakMinutes === "number" ? { breakMinutes: settings.breakMinutes } : {}),
      ...(settings.meaningView === "simple" || settings.meaningView === "steinsaltz" ? { meaningView: settings.meaningView } : {}),
      ...(isMasechtaId(settings.lastMasechta) ? { lastMasechta: settings.lastMasechta } : {}),
    },
    mishnayos: canonicalKeys(entries(obj(p.mishnayos))),
    perakim: canonicalKeys(entries(obj(p.perakim))),
    days: Array.isArray(p.days) ? p.days.filter((d): d is string => typeof d === "string") : [],
  };
}

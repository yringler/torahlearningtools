import type { Ms } from "../../shared/api";
import { profileToRows } from "../sync/mapping";
import { addPending, type AccountStore } from "../sync/store";
import type { Profile } from "../types";

const norm = (s: string) => s.trim().toLocaleLowerCase();

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

/** Fills in fields an old or hand-edited backup may lack, so the app and the sync mapping can rely on them. */
export function normalizeProfile(x: Profile, index: number): Profile {
  const p = (typeof x === "object" && x !== null ? x : {}) as Partial<Profile>;
  const obj = <T,>(v: T | undefined): T => (typeof v === "object" && v !== null && !Array.isArray(v) ? v : ({} as T));
  const settings = obj(p.settings);
  return {
    id: typeof p.id === "string" && p.id ? p.id : `legacy-${index}`,
    name: typeof p.name === "string" && p.name.trim() ? p.name : `Child ${index + 1}`,
    color: typeof p.color === "string" ? p.color : "#2f7d6d",
    emoji: typeof p.emoji === "string" ? p.emoji : "🦁",
    settings: {
      fontScale: typeof settings.fontScale === "number" ? settings.fontScale : 1,
      tts: settings.tts === true,
      dailyMinutes: typeof settings.dailyMinutes === "number" ? settings.dailyMinutes : 15,
      ...(settings.meaningView === "simple" || settings.meaningView === "steinsaltz" ? { meaningView: settings.meaningView } : {}),
    },
    mishnayos: entries(obj(p.mishnayos)),
    perakim: entries(obj(p.perakim)),
    days: Array.isArray(p.days) ? p.days.filter((d): d is string => typeof d === "string") : [],
  };
}

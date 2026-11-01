import type { AppState, MishnahProgress, PerekProgress, Profile } from "./types";

/** v1 storage (before accounts). Read-only now: the app never writes it and never deletes it. */
export const KEY = "baalpeh:v1";

export const emptyState = (): AppState => ({ version: 1, profiles: [] });

export function loadLegacy(): AppState {
  try {
    const s = localStorage.getItem(KEY);
    if (!s) return emptyState();
    const parsed: unknown = JSON.parse(s);
    return isAppState(parsed) ? parsed : emptyState();
  } catch {
    return emptyState();
  }
}

export function requestPersist(): void {
  try {
    void navigator.storage?.persist?.();
  } catch {
    /* ignore */
  }
}

export function isAppState(x: unknown): x is AppState {
  return typeof x === "object" && x !== null && (x as AppState).version === 1 && Array.isArray((x as AppState).profiles);
}

export const COLORS = ["#2f7d6d", "#c0603a", "#4a64b5", "#a2479a", "#c79a1e", "#3d8a3a"] as const;
export const EMOJIS = ["🦁", "🐘", "🦉", "🐢", "🦊", "🐬", "🐻", "🦒"] as const;

export function newProfile(name: string, index: number): Profile {
  return {
    id: crypto.randomUUID(),
    name,
    color: COLORS[index % COLORS.length] ?? "#2f7d6d",
    emoji: EMOJIS[index % EMOJIS.length] ?? "🦁",
    settings: { fontScale: 1, tts: false, dailyMinutes: 15 },
    mishnayos: {},
    perakim: {},
    days: [],
  };
}

export const blankMishnah = (): MishnahProgress => ({ stepIndex: 0, state: "new", fails: {} });
export const blankPerek = (): PerekProgress => ({ chainedThrough: 0, complete: false });

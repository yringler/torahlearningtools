import { normalizeProfile } from "./legacy/import";
import { emptyState, isAppState, KEY as LEGACY_KEY, newProfile } from "./storage";
import type { KV } from "./sync/store";
import type { AppState, Profile } from "./types";

/**
 * Guest mode: the app with no account. It never talks to the server; the one implicit learner is kept in the
 * v1 localStorage format (`baalpeh:v1`), so a later sign-in on this device offers to import it (§9.6).
 */
export const GUEST_FLAG_KEY = "baalpeh:guest";
export const GUEST_ID = "guest-local";

export function isGuestChosen(kv: KV): boolean {
  try {
    return kv.getItem(GUEST_FLAG_KEY) === "1";
  } catch {
    return false;
  }
}

export function setGuestChosen(kv: KV, on: boolean): void {
  try {
    if (on) kv.setItem(GUEST_FLAG_KEY, "1");
    else kv.removeItem(GUEST_FLAG_KEY);
  } catch {
    /* storage unavailable: guest mode still works until reload */
  }
}

export type BootRoute = "verify" | "guest" | "app" | "boot";

/** First screen of a page load. A magic link always wins (it means "sign in"), then the remembered guest choice. */
export function bootRoute(o: { verifyToken: string | null; guest: boolean; cachedUser: boolean }): BootRoute {
  if (o.verifyToken !== null) return "verify";
  if (o.guest) return "guest";
  return o.cachedUser ? "app" : "boot";
}

/** Phases in which the auth shell asks the server who is signed in. Guest is never one of them. */
export const asksServer = (phase: string): boolean => phase === "boot" || phase === "app";

function readState(kv: KV): AppState {
  try {
    const raw = kv.getItem(LEGACY_KEY);
    if (!raw) return emptyState();
    const parsed: unknown = JSON.parse(raw);
    return isAppState(parsed) ? parsed : emptyState();
  } catch {
    return emptyState();
  }
}

export function blankGuest(): Profile {
  return { ...newProfile("Guest", 0), id: GUEST_ID };
}

/** The guest learner saved on this device, or a fresh one (not written until there is something to save). */
export function loadGuest(kv: KV): Profile {
  const state = readState(kv);
  const i = state.profiles.findIndex((p) => typeof p === "object" && p !== null && p.id === GUEST_ID);
  const found = state.profiles[i];
  return found ? normalizeProfile(found, i) : blankGuest();
}

/** Writes the guest learner into the v1 state, keeping any other v1 profiles on this device as they are. */
export function saveGuest(kv: KV, p: Profile): void {
  const state = readState(kv);
  const guest = { ...p, id: GUEST_ID };
  const has = state.profiles.some((x) => typeof x === "object" && x !== null && x.id === GUEST_ID);
  const profiles = has ? state.profiles.map((x) => (x.id === GUEST_ID ? guest : x)) : [...state.profiles, guest];
  try {
    kv.setItem(LEGACY_KEY, JSON.stringify({ ...state, version: 1, profiles } satisfies AppState));
  } catch {
    /* storage unavailable or full; progress lasts for this visit only */
  }
}

import type { SignInAs } from "../../shared/api";

/** Pure routing decisions of the auth shell (docs/PARENT_MODE.md §9.1). */

/** What a "who is signed in" call said: 200, 401, or no answer (offline / server trouble). */
export type WhoAmI = "ok" | "none" | "offline";

export type BootPhase = "app" | "parent" | "choose" | "offlineNoAccount" | "askParent";

/**
 * Boot without a cached learner: the learner session first, then (only when it said 401) the parent session, then
 * the login choice. "askParent": call /api/parent/me next.
 */
export function bootPhase(learner: WhoAmI, parent?: WhoAmI): BootPhase {
  if (learner === "ok") return "app";
  if (learner === "offline") return "offlineNoAccount";
  if (parent === undefined) return "askParent";
  if (parent === "ok") return "parent";
  return parent === "offline" ? "offlineNoAccount" : "choose";
}

/** Where a successful sign-in goes: the scope the server set decides (an absent scope is an older server: learner). */
export const phaseAfterSignIn = (scope: SignInAs | undefined): "app" | "parent" => (scope === "parent" ? "parent" : "app");

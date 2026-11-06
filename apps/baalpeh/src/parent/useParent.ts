import { useCallback, useRef, useState } from "react";
import type { LearningEvent, LearningEventBody, Ms, User } from "../../shared/api";
import { api, ApiFailure, NetworkFailure, type Api } from "../api/client";
import { DEFAULT_MASECHTA_ID } from "../data";
import { importLegacy as importLegacyPure } from "../legacy/import";
import type { Verified } from "../progress";
import { today } from "../srs";
import { takeBatch } from "../sync/engine";
import {
  applyLocalEdit, applyServerResponse, applyVerifications, clearSent, emptyStore, enqueueEvent, pendingCount, verifiedSet, verifKey,
  type AccountStore,
} from "../sync/store";
import type { ProfilesUpdate } from "../sync/useAccount";
import type { Profile } from "../types";

/**
 * Parent mode's data (docs/PARENT_MODE.md §9.4): an in-memory AccountStore, never saved to the device and never the
 * learner's store. Every edit is pushed at once through POST /api/parent/sync (server clock, fenced against stale
 * learner devices, §8); there is no offline queue: parent mode is online-only.
 */

export type ParentProblem = null | "offline" | "rejected" | "error";

export interface ParentSyncDeps {
  api: Pick<Api, "parentSync">;
  get(): AccountStore;
  set(s: AccountStore): void;
  now?: () => Ms;
}

export type ParentSyncResult = "ok" | "locked" | "signedOut" | "offline" | "rejected" | "error";

/**
 * Pushes everything pending and pulls what's new, until nothing is pending. Pure apart from `deps` (tested).
 * 403 parent_locked keeps pending for after the PIN; 400/413 drop the batch (it can never succeed).
 */
export async function runParentSync(deps: ParentSyncDeps): Promise<ParentSyncResult> {
  const now = deps.now ?? (() => Date.now());
  let rejected = false;
  for (let round = 0; round < 100; round++) {
    const sent = takeBatch(deps.get());
    try {
      const res = await deps.api.parentSync({ cursor: deps.get().cursor, ...sent });
      deps.set(applyServerResponse(deps.get(), sent, res, now(), { parentWins: false }));
    } catch (e) {
      if (e instanceof NetworkFailure) return "offline";
      if (e instanceof ApiFailure && e.status === 401) return "signedOut";
      if (e instanceof ApiFailure && e.status === 403) return "locked";
      if (e instanceof ApiFailure && (e.status === 400 || e.status === 413)) {
        deps.set(clearSent(deps.get(), sent));
        rejected = true;
      } else return "error";
    }
    if (pendingCount(deps.get()) === 0) break;
  }
  return rejected ? "rejected" : "ok";
}

export interface ParentData {
  store: AccountStore;
  profiles: Profile[];
  /** The first full pull has finished. */
  loaded: boolean;
  saving: boolean;
  problem: ParentProblem;
  /** Applies a change to the children, plus optional events (resets), and pushes it right away. */
  edit(next: ProfilesUpdate, events?: { childId: string; body: LearningEventBody }[]): void;
  importLegacy(selected: Profile[]): void;
  sync(): Promise<ParentSyncResult>;
  pendingNow(): number;
  verifiedFor(childId: string): Verified;
  verifiedAt(childId: string, perek: number): Ms | null;
  /** POST /api/parent/children/:id/verifications, then applies the returned rows. Throws ApiFailure/NetworkFailure. */
  setVerified(childId: string, perakim: number[], verified: boolean): Promise<void>;
}

export function useParent(user: User, on: { locked(): void; signedOut(): void }): ParentData {
  const ref = useRef<AccountStore>(emptyStore(user));
  const [store, setStore] = useState<AccountStore>(ref.current);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<ParentProblem>(null);
  const running = useRef<Promise<ParentSyncResult> | null>(null);
  const again = useRef(false);
  const onRef = useRef(on);
  onRef.current = on;

  const set = useCallback((s: AccountStore) => { ref.current = s; setStore(s); }, []);

  const sync = useCallback((): Promise<ParentSyncResult> => {
    if (running.current) { again.current = true; return running.current; }
    setSaving(true);
    const p = (async () => {
      let r: ParentSyncResult;
      do {
        again.current = false;
        r = await runParentSync({ api, get: () => ref.current, set });
      } while (r === "ok" && again.current);
      return r;
    })().then((r) => {
      running.current = null;
      setSaving(false);
      if (r === "ok") { setProblem(null); setLoaded(true); }
      else if (r === "offline" || r === "error" || r === "rejected") setProblem(r);
      if (r === "rejected") setLoaded(true);
      if (r === "locked") onRef.current.locked();
      if (r === "signedOut") onRef.current.signedOut();
      return r;
    });
    running.current = p;
    return p;
  }, [set]);

  const edit = useCallback((next: ProfilesUpdate, events: { childId: string; body: LearningEventBody }[] = []) => {
    const cur = ref.current;
    const profiles = typeof next === "function" ? next(cur.profiles) : next;
    let s = applyLocalEdit(cur, profiles, Date.now());
    for (const { childId, body } of events) {
      const at = Date.now();
      s = enqueueEvent(s, { ...body, id: crypto.randomUUID(), childId, at, day: today(new Date(at)) } as LearningEvent);
    }
    set(s);
    void sync();
  }, [set, sync]);

  const importLegacy = useCallback((selected: Profile[]) => {
    set(importLegacyPure(ref.current, selected, Date.now()));
    void sync();
  }, [set, sync]);

  const setVerified = useCallback(async (childId: string, perakim: number[], verified: boolean) => {
    const r = await api.parentSetVerifications(childId, { masechta: DEFAULT_MASECHTA_ID, perakim, verified });
    set(applyVerifications(ref.current, r.verifications));
  }, [set]);

  return {
    store, profiles: store.profiles, loaded, saving, problem, edit, importLegacy, sync,
    pendingNow: () => pendingCount(ref.current),
    verifiedFor: (childId) => verifiedSet(store, childId, DEFAULT_MASECHTA_ID),
    verifiedAt: (childId, perek) => {
      const e = store.verified[childId]?.[verifKey(DEFAULT_MASECHTA_ID, perek)];
      return e?.verified ? e.verifiedAt ?? e.updatedAt : null;
    },
    setVerified,
  };
}

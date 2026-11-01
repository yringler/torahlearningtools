import { useCallback, useEffect, useRef, useState } from "react";
import type { LearningEvent, LearningEventBody, User } from "../../shared/api";
import { api } from "../api/client";
import { kv } from "../kv";
import { importLegacy as importLegacyPure } from "../legacy/import";
import { today } from "../srs";
import type { Profile } from "../types";
import { SyncEngine, type SyncStatus } from "./engine";
import {
  applyLocalEdit, enqueueEvent, loadStore, pendingCount, saveStore, setCurrentUser, storeKey, type AccountStore,
} from "./store";

export { kv } from "../kv";

export type ProfilesUpdate = Profile[] | ((prev: Profile[]) => Profile[]);

export interface Account {
  store: AccountStore;
  profiles: Profile[];
  setProfiles(next: ProfilesUpdate): void;
  addEvent(childId: string, body: LearningEventBody): void;
  status: SyncStatus;
  syncNow(): Promise<void>;
  /** Pending rows and events right now (not as of the last render). */
  pendingNow(): number;
  importLegacy(selected: Profile[]): void;
  setImportDecision(d: AccountStore["importDecision"]): void;
  /** Stops syncing and removes this account's local data and the current-user marker. */
  endSession(): void;
}

/** Owns the AccountStore for one signed-in user: local-first state plus the background SyncEngine. */
export function useAccount(user: User): Account {
  // The latest store, readable synchronously (several edits can happen in one event handler).
  // The caller remounts this hook (React `key`) when the user changes.
  const ref = useRef<AccountStore | null>(null);
  if (ref.current === null) ref.current = loadStore(kv, user);
  const [store, setStore] = useState<AccountStore>(ref.current);
  const disposed = useRef(false);
  const [status, setStatus] = useState<SyncStatus>(() => ({ state: "idle", pending: pendingCount(store), lastSyncAt: store.lastSyncAt }));

  const get = useCallback((): AccountStore => ref.current ?? store, [store]);
  const set = useCallback((s: AccountStore) => {
    if (disposed.current) return;
    ref.current = s;
    saveStore(kv, s);
    setStore(s);
    setStatus((st) => ({ ...st, pending: pendingCount(s), lastSyncAt: s.lastSyncAt }));
  }, []);

  const [engine] = useState(() => new SyncEngine({
    api,
    get: () => ref.current ?? store,
    set,
    onStatus: (s) => { if (!disposed.current) setStatus(s); },
  }));

  useEffect(() => {
    disposed.current = false;
    engine.start();
    return () => engine.stop();
  }, [engine]);

  const setProfiles = useCallback((next: ProfilesUpdate) => {
    const cur = get();
    const profiles = typeof next === "function" ? next(cur.profiles) : next;
    set(applyLocalEdit(cur, profiles, Date.now()));
    engine.kick();
  }, [engine, get, set]);

  const addEvent = useCallback((childId: string, body: LearningEventBody) => {
    const at = Date.now();
    const e = { ...body, id: crypto.randomUUID(), childId, at, day: today(new Date(at)) } as LearningEvent;
    set(enqueueEvent(get(), e));
    engine.kick();
  }, [engine, get, set]);

  const importLegacy = useCallback((selected: Profile[]) => {
    set(importLegacyPure(get(), selected, Date.now()));
    engine.kick(0);
  }, [engine, get, set]);

  const setImportDecision = useCallback((d: AccountStore["importDecision"]) => set({ ...get(), importDecision: d }), [get, set]);

  const endSession = useCallback(() => {
    engine.stop();
    disposed.current = true;
    try {
      kv.removeItem(storeKey(user.id));
    } catch {
      /* ignore */
    }
    setCurrentUser(kv, null);
  }, [engine, user.id]);

  return {
    store, profiles: store.profiles, setProfiles, addEvent, status, syncNow: () => engine.syncNow(),
    pendingNow: () => pendingCount(get()),
    importLegacy, setImportDecision, endSession,
  };
}

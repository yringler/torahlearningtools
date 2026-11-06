import { useCallback, useEffect, useRef, useState } from "react";
import type { LearningEvent, LearningEventBody, Ms, PerekVerificationRow, User } from "../../shared/api";
import { api } from "../api/client";
import { kv } from "../kv";
import { DEFAULT_MASECHTA_ID } from "../data";
import { importLegacy as importLegacyPure } from "../legacy/import";
import { cooldownTest, type RequestResult } from "../perekTest";
import { requestErrorResult } from "../perekTestRequest";
import type { Verified } from "../progress";
import { today } from "../srs";
import type { Profile } from "../types";
import { SyncEngine, type SyncStatus } from "./engine";
import {
  applyLocalEdit, applyVerifications, enqueueEvent, loadStore, pendingCount, saveStore, setCurrentUser, storeKey, verifiedSet,
  verifKey, type AccountStore, type LastTest,
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
  /** Perakim of the active masechta a parent verified for this child (server-owned). */
  verifiedFor(childId: string): Verified;
  /** When a parent verified this perek, or null. */
  verifiedAt(childId: string, perek: number): Ms | null;
  /** This device's last test request for this child. */
  lastTest(childId: string): LastTest | undefined;
  /** The server's clock (device clock plus the last measured offset). */
  serverNow(): Ms;
  /** Syncs (so the child row exists on the server), then asks for the perek test email. Never queued. */
  requestTest(childId: string, perek: number): Promise<RequestResult>;
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

  const serverNow = useCallback((): Ms => Date.now() + (get().clockOffset ?? 0), [get]);

  const rememberTest = useCallback((childId: string, t: LastTest) => {
    const cur = get();
    set({ ...cur, lastTest: { ...cur.lastTest, [childId]: t } });
  }, [get, set]);

  const applyRow = useCallback((row: PerekVerificationRow) => set(applyVerifications(get(), [row])), [get, set]);

  const requestTest = useCallback(async (childId: string, perek: number): Promise<RequestResult> => {
    const masechta = DEFAULT_MASECHTA_ID;
    try { await engine.syncNow(); } catch { /* the request below reports the problem */ }
    try {
      const r = await api.perekTest({ childId, masechta, perek });
      set({ ...get(), clockOffset: r.serverTime - Date.now() });
      if (r.alreadyVerified) {
        if (r.verification) applyRow(r.verification);
        void engine.syncNow();
        return { kind: "already" };
      }
      rememberTest(childId, { masechta, perek, sentAt: r.serverTime, nextAllowedAt: r.nextAllowedAt });
      return { kind: "sent" };
    } catch (e) {
      const res = requestErrorResult(e);
      if (res.kind === "cooldown") {
        const t = cooldownTest(masechta, perek, res.retryAfterSec, serverNow());
        if (t) rememberTest(childId, t);
      }
      if (res.kind === "notFrontier") await engine.syncNow().catch(() => undefined);
      return res;
    }
  }, [applyRow, engine, get, rememberTest, serverNow, set]);

  return {
    verifiedFor: (childId) => verifiedSet(store, childId, DEFAULT_MASECHTA_ID),
    verifiedAt: (childId, perek) => {
      const e = store.verified[childId]?.[verifKey(DEFAULT_MASECHTA_ID, perek)];
      return e?.verified ? e.verifiedAt ?? e.updatedAt : null;
    },
    lastTest: (childId) => store.lastTest?.[childId],
    serverNow,
    requestTest,
    store, profiles: store.profiles, setProfiles, addEvent, status, syncNow: () => engine.syncNow(),
    pendingNow: () => pendingCount(get()),
    importLegacy, setImportDecision, endSession,
  };
}

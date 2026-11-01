import { SYNC_LIMITS, type Ms, type SyncRequest } from "../../shared/api";
import { ApiFailure, NetworkFailure, type Api } from "../api/client";
import { applyServerResponse, clearSent, pendingCount, type AccountStore, type SentBatch } from "./store";

export type SyncState = "idle" | "syncing" | "offline" | "error" | "signedOut";
export interface SyncStatus {
  state: SyncState;
  pending: number;
  lastSyncAt: Ms | null;
}

type Timer = ReturnType<typeof setTimeout>;

export interface EngineDeps {
  api: Pick<Api, "sync">;
  get(): AccountStore;
  set(s: AccountStore): void;
  onStatus(s: SyncStatus): void;
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => Timer;
  clearTimer?: (t: Timer) => void;
}

/** Retry delays after a network or server error. The last one repeats. */
export const BACKOFF_MS = [5_000, 15_000, 60_000, 300_000] as const;
const INTERVAL_MS = 60_000;
/** Safety stop for one syncNow() call. */
const MAX_ROUNDS = 100;

/** Takes up to MAX_ROWS rows (children first) and MAX_EVENTS events from pending. */
export function takeBatch(s: AccountStore): SentBatch {
  const children = Object.values(s.pending.children).slice(0, SYNC_LIMITS.MAX_ROWS);
  const records = Object.values(s.pending.records).slice(0, SYNC_LIMITS.MAX_ROWS - children.length);
  return { children, records, events: s.pending.events.slice(0, SYNC_LIMITS.MAX_EVENTS) };
}

export class SyncEngine {
  private readonly now: () => number;
  private readonly setTimer: (fn: () => void, ms: number) => Timer;
  private readonly clearTimer: (t: Timer) => void;
  private running: Promise<void> | null = null;
  private again = false;
  private kickTimer: Timer | null = null;
  private retryTimer: Timer | null = null;
  private interval: Timer | null = null;
  private failures = 0;
  private state: SyncState = "idle";
  private stopped = false;
  private listening = false;

  constructor(private readonly deps: EngineDeps) {
    this.now = deps.now ?? (() => Date.now());
    this.setTimer = deps.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
    this.clearTimer = deps.clearTimer ?? ((t) => clearTimeout(t));
  }

  get syncState(): SyncState {
    return this.state;
  }

  /** Debounced sync, default 2 s after the last call. */
  kick(delayMs = 2000): void {
    if (this.stopped || this.state === "signedOut") return;
    if (this.kickTimer) this.clearTimer(this.kickTimer);
    this.kickTimer = this.setTimer(() => {
      this.kickTimer = null;
      void this.syncNow();
    }, delayMs);
  }

  /** Single-flight: a call during a running round marks "again" and returns that round's promise. */
  syncNow(): Promise<void> {
    if (this.running) {
      this.again = true;
      return this.running;
    }
    if (this.retryTimer) {
      this.clearTimer(this.retryTimer);
      this.retryTimer = null;
    }
    this.running = this.loop().finally(() => {
      this.running = null;
    });
    return this.running;
  }

  start(): void {
    this.stopped = false;
    if (this.state === "signedOut") this.state = "idle";
    if (!this.listening && typeof window !== "undefined") {
      window.addEventListener("online", this.onOnline);
      document.addEventListener("visibilitychange", this.onVisible);
      this.listening = true;
    }
    if (!this.interval) {
      this.interval = setInterval(() => {
        if (typeof document === "undefined" || document.visibilityState === "visible") void this.syncNow();
      }, INTERVAL_MS);
    }
    void this.syncNow();
  }

  stop(): void {
    this.stopped = true;
    if (this.listening) {
      window.removeEventListener("online", this.onOnline);
      document.removeEventListener("visibilitychange", this.onVisible);
      this.listening = false;
    }
    if (this.interval) clearInterval(this.interval);
    this.interval = null;
    for (const t of [this.kickTimer, this.retryTimer]) if (t) this.clearTimer(t);
    this.kickTimer = this.retryTimer = null;
  }

  private readonly onOnline = () => void this.syncNow();
  private readonly onVisible = () => {
    if (document.visibilityState === "visible") void this.syncNow();
  };

  private emit(state: SyncState): void {
    this.state = state;
    const s = this.deps.get();
    this.deps.onStatus({ state, pending: pendingCount(s), lastSyncAt: s.lastSyncAt });
  }

  private scheduleRetry(): void {
    if (this.stopped) return;
    const delay = BACKOFF_MS[Math.min(this.failures, BACKOFF_MS.length - 1)] ?? 300_000;
    this.failures += 1;
    if (this.retryTimer) this.clearTimer(this.retryTimer);
    this.retryTimer = this.setTimer(() => {
      this.retryTimer = null;
      void this.syncNow();
    }, delay);
  }

  private async loop(): Promise<void> {
    if (this.state === "signedOut") return;
    let dropped = false;
    this.emit("syncing");
    for (let round = 0; round < MAX_ROUNDS; round++) {
      this.again = false;
      const store = this.deps.get();
      const sent = takeBatch(store);
      const body: SyncRequest = { cursor: store.cursor, ...sent };
      try {
        const res = await this.deps.api.sync(body);
        this.deps.set(applyServerResponse(this.deps.get(), sent, res, this.now()));
        this.failures = 0;
      } catch (e) {
        if (e instanceof ApiFailure && e.status === 401) {
          this.stop();
          this.emit("signedOut");
          return;
        }
        if (e instanceof ApiFailure && (e.status === 400 || e.status === 403 || e.status === 413)) {
          // This batch can never succeed: drop it so the rest can sync.
          console.warn("sync rejected", e.status, e.body);
          this.deps.set(clearSent(this.deps.get(), sent));
          dropped = true;
          if (pendingCount(this.deps.get()) > 0) continue;
          break;
        }
        this.emit(e instanceof NetworkFailure ? "offline" : "error");
        this.scheduleRetry();
        return;
      }
      if (pendingCount(this.deps.get()) === 0 && !this.again) break;
    }
    this.emit(dropped ? "error" : "idle");
  }
}

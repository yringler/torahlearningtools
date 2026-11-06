import { PARENT } from "../../shared/api";

/**
 * Pure parent-PIN logic (docs/PARENT_MODE.md §9.4–§9.6): the weak-PIN rule, the PIN pad's state machine and the
 * re-lock timers. The server checks only /^\d{4}$/; refusing easy PINs here is a nudge, not a security boundary.
 */

const LEN = PARENT.PIN_LENGTH;

/** All the same digit, 1234 or 4321. */
export function weakPin(pin: string): boolean {
  return /^(\d)\1+$/.test(pin) || pin === "1234" || pin === "4321";
}

export function wrongPinText(left: number | undefined): string {
  if (left === undefined) return "That PIN isn't right.";
  if (left <= 1) return "That PIN isn't right. 1 try left. After that, the PIN locks until you reset it by email.";
  return `That PIN isn't right. ${left} tries left.`;
}

export interface PadState {
  digits: string;
  /** The 4th digit was typed; the caller is checking it. Keys are disabled. */
  busy: boolean;
  /** Set when the 4th digit arrives: the PIN to submit. Cleared by every outcome. */
  submit: string | null;
  error: string;
  /** Bumped on a wrong PIN, so the dots shake again. */
  shake: number;
  locked: boolean;
}

export type PadAction =
  | { a: "digit"; d: string }
  | { a: "back" }
  /** Pasted or autofilled text: the first 4 digits in it. */
  | { a: "paste"; text: string }
  | { a: "wrong"; left?: number | undefined }
  /** Any other failure (offline, rate limited, mismatch…): clear and show the message, no shake. */
  | { a: "fail"; message: string }
  | { a: "locked" }
  /** Start again (a new step of the setup, or after a success). */
  | { a: "clear" };

export const initialPad: PadState = { digits: "", busy: false, submit: null, error: "", shake: 0, locked: false };

function withDigits(st: PadState, digits: string): PadState {
  const d = digits.slice(0, LEN);
  if (d.length === LEN) return { ...st, digits: d, busy: true, submit: d, error: "" };
  return { ...st, digits: d, error: d.length > 0 ? "" : st.error };
}

export function pinPadReducer(st: PadState, act: PadAction): PadState {
  switch (act.a) {
    case "digit":
      if (st.busy || st.locked || !/^\d$/.test(act.d)) return st;
      return withDigits(st, st.digits + act.d);
    case "back":
      if (st.busy || st.locked) return st;
      return { ...st, digits: st.digits.slice(0, -1) };
    case "paste": {
      if (st.busy || st.locked) return st;
      const d = act.text.replace(/\D/g, "");
      return d ? withDigits(st, d) : st;
    }
    case "wrong":
      return { ...st, digits: "", busy: false, submit: null, error: wrongPinText(act.left), shake: st.shake + 1 };
    case "fail":
      return { ...st, digits: "", busy: false, submit: null, error: act.message };
    case "locked":
      return { ...st, digits: "", busy: false, submit: null, error: "", locked: true };
    case "clear":
      return { ...initialPad, shake: st.shake };
  }
}

/** Client re-lock timers (§3.3): server-side the unlock also ends after 5 min idle and 60 min overall. */
export const LOCK = {
  IDLE_MS: 5 * 60_000,
  HIDDEN_MS: 60_000,
  PING_EVERY_MS: 2 * 60_000,
  /** Only ping (keep the server unlock alive) when someone touched the screen this recently. */
  PING_INPUT_WITHIN_MS: 2 * 60_000,
} as const;

export interface LockInput {
  lastInputAt: number;
  /** When the tab was hidden, or null while it is visible. */
  hiddenSince: number | null;
  lastPingAt: number;
  now: number;
}

/** What the parent shell's 1-second tick should do. */
export function lockDecision(x: LockInput): { lock: boolean; ping: boolean } {
  if (x.now - x.lastInputAt >= LOCK.IDLE_MS) return { lock: true, ping: false };
  if (x.hiddenSince !== null && x.now - x.hiddenSince >= LOCK.HIDDEN_MS) return { lock: true, ping: false };
  const ping = x.hiddenSince === null && x.now - x.lastPingAt >= LOCK.PING_EVERY_MS && x.now - x.lastInputAt < LOCK.PING_INPUT_WITHIN_MS;
  return { lock: false, ping };
}

/** The IANA zone for the "PIN changed" email, when the browser knows it. */
export function timeZone(): string | undefined {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return tz && tz.length <= 64 ? tz : undefined;
  } catch {
    return undefined;
  }
}

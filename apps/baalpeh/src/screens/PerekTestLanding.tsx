import { useEffect, useReducer, useState } from "react";
import type { PerekTestInfo } from "../../shared/api";
import { hebNum } from "../../shared/hebrew";
import { api, ApiFailure, errorCode, NetworkFailure } from "../api/client";
import { PinPad, type PinOutcome } from "../components/PinPad";
import { forgotFailText, pinOutcomeOf } from "../parent/PinFlows";

/**
 * The parent's test page, opened from the email (docs/PARENT_VERIFICATION.md §10.4). Public: rendered outside the
 * auth shell, so it never calls /api/me, never syncs and needs no masechta download (the text comes with lookup).
 * Opening the page only reads (POST /lookup). Only the parent's tap on "knows it" calls confirm, so an email scanner
 * that fetches the link, even one that runs JavaScript, can't verify anything.
 */
export const PEREK_TEST_PATH = "/perek-test";

/** Minimal sessionStorage, injectable for tests. */
export interface TabStore {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
}
const TOKEN_KEY = "baalpeh:perek-test-token";

function tabStore(): TabStore | null {
  try {
    return typeof sessionStorage === "undefined" ? null : sessionStorage;
  } catch {
    return null;
  }
}

/**
 * Reads `#t=<token>` on /perek-test and strips it from the address bar at once. Call once per page load, outside
 * React. The token is kept in this tab's sessionStorage, so a reload (which the email suggests if the page looks
 * wrong) still shows the test. Returns null on any other path, and "" when the page has no token at all.
 */
export function takePerekTestToken(
  loc: { pathname: string; hash: string } = location,
  replace: (url: string) => void = (url) => history.replaceState(null, "", url),
  store: TabStore | null = tabStore(),
): string | null {
  if (loc.pathname.replace(/\/+$/, "") !== PEREK_TEST_PATH) return null;
  const fromHash = new URLSearchParams(loc.hash.replace(/^#/, "")).get("t") ?? "";
  replace(PEREK_TEST_PATH);
  try {
    if (fromHash) {
      store?.setItem(TOKEN_KEY, fromHash);
      return fromHash;
    }
    return store?.getItem(TOKEN_KEY) ?? "";
  } catch {
    return fromHash;
  }
}

export type FailKind = "invalid" | "expired" | "offline" | "limited" | "other";

/** The PIN sheet (docs/PARENT_MODE.md §9.11): open while set. */
export interface PinStep {
  busy: boolean;
  error?: string | undefined;
  triesLeft?: number | undefined;
  locked?: boolean | undefined;
  /** "Forgot PIN?" sent the reset email. */
  resetSent?: boolean | undefined;
}

export type LandingState =
  | { s: "loading" }
  /** `notYet`: the parent tapped "Not yet" (client only; the link stays live). `pin`: the PIN sheet is open. */
  | { s: "pending"; info: PerekTestInfo; busy: boolean; notYet: boolean; showText: boolean; error?: string | undefined; pin?: PinStep | undefined }
  /** `fresh`: this tap confirmed it ("Mazel tov"); otherwise it was already done ("Already done"). */
  | { s: "done"; info: PerekTestInfo; fresh: boolean }
  | { s: "expired"; info?: PerekTestInfo }
  /** `missing`: the page was opened (or reloaded) without a token. */
  | { s: "invalid"; info?: PerekTestInfo; missing?: boolean }
  /** The lookup itself failed (offline, too many tries): retry. */
  | { s: "error"; message: string };

export type LandingAction =
  | { a: "lookupOk"; info: PerekTestInfo }
  | { a: "lookupFail"; kind: FailKind }
  | { a: "retry" }
  | { a: "tapConfirm" }
  | { a: "confirmOk"; info: PerekTestInfo }
  | { a: "confirmFail"; kind: FailKind }
  | { a: "notYet" }
  | { a: "toggleText" }
  | { a: "openPin" }
  | { a: "closePin" }
  | { a: "pinWrong"; left?: number | undefined }
  | { a: "pinLocked" }
  /** confirm without a PIN answered pin_required (a PIN was set after lookup): open the sheet. */
  | { a: "pinRequired" }
  | { a: "resetSent" };

export const initialLanding = (token: string): LandingState => (token ? { s: "loading" } : { s: "invalid", missing: true });

const failMessage = (k: FailKind): string =>
  k === "offline" ? "You're offline. Connect and tap again."
    : k === "limited" ? "Too many tries. Wait a few minutes and try again."
    : "Something went wrong. Try again.";

/** Pure: every state change of the page. Nothing here calls the server; only "tapConfirm" leads to confirm. */
export function landingReducer(st: LandingState, act: LandingAction): LandingState {
  const info = "info" in st ? st.info : undefined;
  switch (act.a) {
    case "lookupOk":
      if (act.info.status === "verified") return { s: "done", info: act.info, fresh: false };
      if (act.info.status === "expired") return { s: "expired", info: act.info };
      return { s: "pending", info: act.info, busy: false, notYet: false, showText: true };
    case "lookupFail":
      if (act.kind === "invalid") return { s: "invalid" };
      if (act.kind === "expired") return { s: "expired" };
      return { s: "error", message: failMessage(act.kind) };
    case "retry":
      return { s: "loading" };
    case "tapConfirm":
      if (st.s !== "pending") return st;
      if (st.info.pinRequired) return landingReducer(st, { a: "openPin" });
      return { ...st, busy: true, notYet: false, error: undefined };
    case "openPin":
      return st.s === "pending" ? { ...st, busy: false, notYet: false, error: undefined, pin: { busy: false, locked: st.info.pinLocked === true } } : st;
    case "closePin":
      return st.s === "pending" ? { ...st, pin: undefined } : st;
    case "pinWrong":
      return st.s === "pending" && st.pin ? { ...st, pin: { ...st.pin, busy: false, triesLeft: act.left } } : st;
    case "pinLocked":
      return st.s === "pending" ? { ...st, busy: false, info: { ...st.info, pinRequired: true, pinLocked: true }, pin: { busy: false, locked: true } } : st;
    case "pinRequired":
      return st.s === "pending" ? { ...st, busy: false, info: { ...st.info, pinRequired: true }, pin: { busy: false, locked: st.info.pinLocked === true } } : st;
    case "resetSent":
      // The lock ends only when the new PIN is set; until then the server answers pin_locked again, which re-locks.
      return st.s === "pending" ? { ...st, info: { ...st.info, pinLocked: false }, pin: { busy: false, resetSent: true } } : st;
    case "confirmOk":
      return { s: "done", info: act.info, fresh: true };
    case "confirmFail":
      if (act.kind === "expired") return info ? { s: "expired", info } : { s: "expired" };
      if (act.kind === "invalid") return info ? { s: "invalid", info } : { s: "invalid" };
      return st.s === "pending" ? { ...st, busy: false, error: failMessage(act.kind) } : st;
    case "notYet":
      return st.s === "pending" ? { ...st, notYet: true, error: undefined } : st;
    case "toggleText":
      return st.s === "pending" ? { ...st, showText: !st.showText } : st;
  }
}

/** What a failed lookup or confirm means for the page. */
export function failKind(e: unknown): FailKind {
  if (e instanceof NetworkFailure) return "offline";
  if (e instanceof ApiFailure) {
    if (e.status === 429) return "limited";
    if (e.body?.error === "invalid_link" || e.body?.error === "bad_request") return /expired/i.test(e.body.message) ? "expired" : "invalid";
  }
  return "other";
}

const dateText = (ms: number | null): string => (ms === null ? "" : new Date(ms).toLocaleDateString(undefined, { dateStyle: "medium" }));

export function PerekTestLanding({ token }: { token: string }) {
  const [st, dispatch] = useReducer(landingReducer, token, initialLanding);

  useEffect(() => {
    if (st.s !== "loading") return;
    let cancelled = false;
    api.perekTestLookup({ token }).then(
      (info) => { if (!cancelled) dispatch({ a: "lookupOk", info }); },
      (e: unknown) => { if (!cancelled) dispatch({ a: "lookupFail", kind: failKind(e) }); },
    );
    return () => { cancelled = true; };
  }, [st.s, token]);

  const confirm = async () => {
    const needsPin = st.s === "pending" && st.info.pinRequired === true;
    dispatch({ a: "tapConfirm" });
    if (needsPin) return;
    try {
      dispatch({ a: "confirmOk", info: await api.perekTestConfirm({ token }) });
    } catch (e) {
      if (errorCode(e) === "pin_required") dispatch({ a: "pinRequired" });
      else if (errorCode(e) === "pin_locked") dispatch({ a: "pinLocked" });
      else dispatch({ a: "confirmFail", kind: failKind(e) });
    }
  };

  const confirmWithPin = async (pin: string): Promise<PinOutcome> => {
    try {
      const info = await api.perekTestConfirm({ token, pin });
      dispatch({ a: "confirmOk", info });
      return { ok: true };
    } catch (e) {
      const k = failKind(e);
      if (k === "expired" || k === "invalid") { dispatch({ a: "confirmFail", kind: k }); return { ok: true }; }
      const out = pinOutcomeOf(e);
      if ("wrong" in out) dispatch({ a: "pinWrong", left: out.left });
      if ("locked" in out) dispatch({ a: "pinLocked" });
      return out;
    }
  };

  const info = "info" in st ? st.info : undefined;
  const name = info?.childName ?? "";
  const who = name || "Your child";
  const whoLower = name || "your child";

  let body: JSX.Element;
  switch (st.s) {
    case "loading":
      body = <p className="hint">Loading…</p>;
      break;
    case "error":
      body = (
        <div className="landing-result">
          <p role="alert">{st.message}</p>
          <button className="btn primary big" onClick={() => dispatch({ a: "retry" })}>Try again</button>
        </div>
      );
      break;
    case "invalid":
      body = (
        <div className="landing-result">
          {st.missing ? (
            <h2>Open the test link from the email again.</h2>
          ) : (
            <>
              <h2>This test link isn't valid anymore.</h2>
              <p>{who} can send a new one from the app.</p>
            </>
          )}
        </div>
      );
      break;
    case "expired":
      body = (
        <div className="landing-result">
          <h2>This test link has expired.</h2>
          <p>Ask {whoLower} to tap "I'm ready to show Abba or Ima" in the app to get a new one.</p>
        </div>
      );
      break;
    case "done":
      body = st.fresh ? (
        <div className="landing-result">
          <div className="big-emoji">🎉</div>
          <h2>Mazel tov! Perek {st.info.perek} is officially done.</h2>
          <p>{name}'s next perek opens the next time the app is online, usually within a minute. Tell {name} how proud you are!</p>
          {st.info.nextPerek !== null && <p className="hint">If {name} has already learned Perek {st.info.nextPerek} too, the app will ask for that test next.</p>}
        </div>
      ) : (
        <div className="landing-result">
          <div className="big-emoji">✓</div>
          <h2>Already done.</h2>
          <p>{name} passed Perek {st.info.perek}{st.info.verifiedAt !== null ? ` on ${dateText(st.info.verifiedAt)}` : ""}.</p>
        </div>
      );
      break;
    case "pending": {
      const i = st.info;
      body = (
        <>
          <h2 className="landing-title">{i.childEmoji} <span style={{ color: i.childColor }}>{name}</span> is ready to show you what they learned!</h2>
          <p className="landing-sub"><bdi dir="rtl" lang="he">מסכת {i.masechtaHe} פרק {hebNum(i.perek)}</bdi> · {i.masechtaEn} Perek {i.perek}</p>
          <p>Have {name} say the whole perek by heart. Follow along below: every line is a piece {name} practiced.</p>
          <button className="btn ghost-btn small" aria-expanded={st.showText} onClick={() => dispatch({ a: "toggleText" })}>
            {st.showText ? "Hide text" : "Show text"}
          </button>
          {st.showText && (
            <div className="landing-text" dir="rtl" lang="he">
              {i.mishnayos.map((pieces, m) => (
                <section key={m}>
                  <b>משנה {hebNum(m + 1)}</b>
                  {pieces.map((he, k) => <div key={k}>{he}</div>)}
                </section>
              ))}
            </div>
          )}
          {st.error && <p className="error" role="alert">{st.error}</p>}
          <div className="landing-bar">
            {/* In the sticky bar, so the parent sees it right where they tapped (the text above is long). */}
            {st.notYet && (
              <div className="landing-note" role="status">
                <b>Thanks! Tell {name} to keep practicing 💪</b>
                <p>This link still works. Come back and tap "knows it" any time in the next 30 days.</p>
              </div>
            )}
            <button className="btn primary big" disabled={st.busy} onClick={() => void confirm()}>
              {st.busy ? "Saving…" : i.nextPerek !== null ? `✅ ${name} knows it, open the next perek` : `✅ ${name} knows it`}
            </button>
            <button className="btn secondary" disabled={st.busy} onClick={() => dispatch({ a: "notYet" })}>🔁 Not yet, a bit more practice</button>
          </div>
        </>
      );
      break;
    }
  }

  const pinSheet = st.s === "pending" && st.pin && (
    <PinSheet name={name || "your child"} step={st.pin} onSubmit={confirmWithPin} onClose={() => dispatch({ a: "closePin" })}
      onForgot={async () => {
        await api.perekTestForgotPin({ token });
        dispatch({ a: "resetSent" });
      }} />
  );

  return (
    <div className="landing" dir="ltr">
      {pinSheet}
      <header className="landing-head">
        <span dir="rtl" lang="he">משנה בעל פה</span> · <span>Mishnah Ba'al Peh</span>
      </header>
      {body}
    </div>
  );
}

/** "Enter your parent PIN" over the test page; the locked and "check your email" states replace the pad. */
function PinSheet({ name, step, onSubmit, onClose, onForgot }: {
  name: string; step: PinStep; onSubmit: (pin: string) => Promise<PinOutcome>; onClose: () => void; onForgot: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // "Forgot PIN?" on the pad asks first (as in parent mode): a stray tap by a child must not send a reset email.
  const [askForgot, setAskForgot] = useState(false);
  const forgot = async () => {
    setBusy(true);
    setError("");
    try { await onForgot(); } catch (e) { setError(errorCode(e) === "pin_not_set" ? "This account has no PIN yet. Tap \"knows it\" again." : forgotFailText(e)); }
    setBusy(false);
  };
  let body: JSX.Element;
  if (step.resetSent) {
    body = (
      <>
        <div className="big-emoji">📬</div>
        <h2>Check your email</h2>
        <p>Check your email for a link to choose a new PIN. Then come back to this page and tap "knows it" again. This test link still works.</p>
        <button className="btn primary" onClick={onClose}>Back to the test</button>
      </>
    );
  } else if (step.locked) {
    body = (
      <>
        <div className="big-emoji">🔒</div>
        <h2>Your parent PIN is locked after 5 wrong tries.</h2>
        <p>We'll email the account a link to choose a new PIN.</p>
        <button className="btn primary" disabled={busy} onClick={() => void forgot()}>{busy ? "Sending…" : "Email me a reset link"}</button>
        <button className="btn ghost-btn" onClick={onClose}>Cancel</button>
      </>
    );
  } else if (askForgot) {
    body = (
      <>
        <h2>Email a link to set a new PIN?</h2>
        <p>We'll send it to the account's email. Your current PIN keeps working until a new one is set.</p>
        <button className="btn primary" disabled={busy} onClick={() => void forgot()}>{busy ? "Sending…" : "Send the email"}</button>
        <button className="btn ghost-btn" disabled={busy} onClick={() => { setError(""); setAskForgot(false); }}>Cancel</button>
      </>
    );
  } else {
    body = (
      <>
        <h2>Enter your parent PIN</h2>
        <p>So only a parent can confirm {name}'s test.</p>
        <PinPad onSubmit={onSubmit} onForgot={() => setAskForgot(true)} />
        <button className="btn ghost-btn" onClick={onClose}>Cancel</button>
      </>
    );
  }
  return (
    <div className="sheet-backdrop confirm" role="dialog" aria-modal="true" aria-label="Parent PIN">
      <div className="sheet confirm-sheet pin-sheet" dir="ltr">
        {body}
        {error && <p className="error" role="alert">{error}</p>}
      </div>
    </div>
  );
}

import { useEffect, useState } from "react";
import type { PinResetInfo } from "../../shared/api";
import { api, ApiFailure, NetworkFailure } from "../api/client";
import { PinSetup } from "../parent/PinFlows";
import { timeZone } from "../parent/pin";
import type { TabStore } from "../screens/PerekTestLanding";
import { AuthFrame } from "./Login";

/**
 * /parent-pin#t=<token>: the "Forgot PIN?" email's page (docs/PARENT_MODE.md §9.6). Public, outside the auth shell.
 * Opening it only reads (lookup); the new PIN is set only when it is typed twice, so a link scanner changes nothing.
 */
export const PIN_RESET_PATH = "/parent-pin";
const TOKEN_KEY = "baalpeh:pin-reset-token";

function tabStore(): TabStore | null {
  try {
    return typeof sessionStorage === "undefined" ? null : sessionStorage;
  } catch {
    return null;
  }
}

/** Reads `#t=` on /parent-pin and strips it at once; kept in this tab for a reload. Like takePerekTestToken. */
export function takePinResetToken(
  loc: { pathname: string; hash: string } = location,
  replace: (url: string) => void = (url) => history.replaceState(null, "", url),
  store: TabStore | null = tabStore(),
): string | null {
  if (loc.pathname.replace(/\/+$/, "") !== PIN_RESET_PATH) return null;
  const fromHash = new URLSearchParams(loc.hash.replace(/^#/, "")).get("t") ?? "";
  replace(PIN_RESET_PATH);
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

type St =
  | { s: "loading" }
  | { s: "ok"; info: PinResetInfo }
  | { s: "saved" }
  | { s: "invalid" }
  | { s: "error"; message: string };

const failText = (e: unknown): string =>
  e instanceof NetworkFailure ? "You're offline. Connect and tap again."
    : e instanceof ApiFailure && e.status === 429 ? "Too many tries. Wait a few minutes and try again."
    : "Something went wrong. Try again.";

export function PinResetLanding({ token }: { token: string }) {
  const [st, setSt] = useState<St>(token ? { s: "loading" } : { s: "invalid" });
  const [tryN, setTryN] = useState(0);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    api.pinResetLookup({ token }).then(
      (info) => { if (!cancelled) setSt({ s: "ok", info }); },
      (e: unknown) => {
        if (cancelled) return;
        setSt(e instanceof ApiFailure && e.body?.error === "invalid_link" ? { s: "invalid" } : { s: "error", message: failText(e) });
      },
    );
    return () => { cancelled = true; };
  }, [token, tryN]);

  const save = async (pin: string): Promise<string | null> => {
    try {
      const tz = timeZone();
      await api.pinReset({ token, pin, ...(tz ? { tz } : {}) });
      try { sessionStorage.removeItem(TOKEN_KEY); } catch { /* ignore */ }
      setSt({ s: "saved" });
      return null;
    } catch (e) {
      if (e instanceof ApiFailure && e.body?.error === "invalid_link") { setSt({ s: "invalid" }); return null; }
      if (e instanceof ApiFailure && e.body?.error === "email_failed") return "We couldn't send the notice email, so the PIN wasn't saved. Try again in a minute.";
      return failText(e);
    }
  };

  let body: JSX.Element;
  switch (st.s) {
    case "loading":
      body = <p className="hint">Loading…</p>;
      break;
    case "invalid":
      body = (
        <>
          <h2>This link has expired or was already used.</h2>
          <p className="hint">Tap "Forgot PIN?" in the app to get a new one.</p>
        </>
      );
      break;
    case "error":
      body = (
        <>
          <p role="alert">{st.message}</p>
          <button className="btn primary big" onClick={() => { setSt({ s: "loading" }); setTryN((n) => n + 1); }}>Try again</button>
        </>
      );
      break;
    case "saved":
      body = (
        <>
          <div className="big-emoji">✓</div>
          <h2>Your new PIN is set.</h2>
          <p>We emailed a note about the change.</p>
          <a className="btn primary big" href="/">Open Mishnah Ba'al Peh</a>
        </>
      );
      break;
    case "ok":
      body = <PinSetup title={`Choose a new parent PIN for ${st.info.email}`} save={save} />;
      break;
  }
  return <AuthFrame>{body}</AuthFrame>;
}

import { useState } from "react";
import type { AuthSuccessResponse, SignInAs } from "../../shared/api";
import { api, ApiFailure, NetworkFailure } from "../api/client";
import { AuthFrame } from "./Login";

export const VERIFY_PATH = "/auth/verify";

/** `#token=…&as=parent` → "parent"; anything else is a learner link. Display only: the server decides the scope. */
export const verifyAs = (hash: string): SignInAs =>
  new URLSearchParams(hash.replace(/^#/, "")).get("as") === "parent" ? "parent" : "learner";

/**
 * Reads the magic-link token (and its `as` hint) from the URL fragment and strips it from the address bar right away.
 * Call once per page load (outside React, so StrictMode's double render can't lose it).
 */
export function takeVerifyToken(): { token: string; as: SignInAs } | null {
  if (location.pathname !== VERIFY_PATH) return null;
  const params = new URLSearchParams(location.hash.replace(/^#/, ""));
  const token = params.get("token") ?? "";
  const as = verifyAs(location.hash);
  history.replaceState(null, "", VERIFY_PATH);
  return { token, as };
}

interface Props {
  token: string;
  as: SignInAs;
  onSuccess: (r: AuthSuccessResponse) => void;
  onLogin: () => void;
}

/** The magic-link landing page. The token is only sent when the parent taps, so link scanners can't use it up. */
export function VerifyLanding({ token, as, onSuccess, onLogin }: Props) {
  const [busy, setBusy] = useState(false);
  const [invalid, setInvalid] = useState(token === "");
  const [error, setError] = useState("");

  const go = async () => {
    setBusy(true);
    setError("");
    try {
      const r = await api.verifyLink({ token });
      history.replaceState(null, "", "/");
      onSuccess(r);
      return;
    } catch (e) {
      if (e instanceof ApiFailure && (e.body?.error === "invalid_link" || e.body?.error === "bad_request")) setInvalid(true);
      else if (e instanceof NetworkFailure) setError("You're offline. Connect and try again.");
      else if (e instanceof ApiFailure && e.body?.error === "rate_limited") setError("Too many tries. Wait a few minutes.");
      else setError("Something went wrong. Try again.");
    }
    setBusy(false);
  };

  const toLogin = () => {
    history.replaceState(null, "", "/");
    onLogin();
  };

  if (invalid) {
    return (
      <AuthFrame>
        <h2>This link has expired or was already used</h2>
        <p className="hint">Sign-in links work once and expire after 15 minutes.</p>
        <button className="btn primary big" onClick={toLogin}>Sign in</button>
      </AuthFrame>
    );
  }
  return (
    <AuthFrame>
      <h2>{as === "parent" ? "Open parent mode on this device?" : "Sign in to Mishnah Ba'al Peh on this device?"}</h2>
      <button className="btn primary big" disabled={busy} onClick={() => void go()}>
        {busy ? "Signing in…" : as === "parent" ? "Sign in as parent on this device" : "Sign in on this device"}
      </button>
      {error && <p className="error" role="alert">{error}</p>}
    </AuthFrame>
  );
}

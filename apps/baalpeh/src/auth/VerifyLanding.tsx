import { useState } from "react";
import type { AuthSuccessResponse } from "../../shared/api";
import { api, ApiFailure, NetworkFailure } from "../api/client";
import { AuthFrame } from "./Login";

export const VERIFY_PATH = "/auth/verify";

/**
 * Reads the magic-link token from the URL fragment and strips it from the address bar right away.
 * Call once per page load (outside React, so StrictMode's double render can't lose it).
 */
export function takeVerifyToken(): string | null {
  if (location.pathname !== VERIFY_PATH) return null;
  const params = new URLSearchParams(location.hash.replace(/^#/, ""));
  const token = params.get("token") ?? "";
  history.replaceState(null, "", VERIFY_PATH);
  return token;
}

interface Props {
  token: string;
  onSuccess: (r: AuthSuccessResponse) => void;
  onLogin: () => void;
}

/** The magic-link landing page. The token is only sent when the parent taps, so link scanners can't use it up. */
export function VerifyLanding({ token, onSuccess, onLogin }: Props) {
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
      <h2>Sign in to Mishnah Ba'al Peh on this device?</h2>
      <button className="btn primary big" disabled={busy} onClick={() => void go()}>
        {busy ? "Signing in…" : "Sign in on this device"}
      </button>
      {error && <p className="error" role="alert">{error}</p>}
    </AuthFrame>
  );
}

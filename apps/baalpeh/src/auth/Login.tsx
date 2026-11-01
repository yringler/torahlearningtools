import { useEffect, useRef, useState } from "react";
import type { ConfigResponse } from "../../shared/api";
import { api, ApiFailure, NetworkFailure } from "../api/client";
import { Turnstile, type TurnstileHandle } from "./Turnstile";

export const plausibleEmail = (s: string): boolean => {
  const e = s.trim();
  return e.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
};

interface Props {
  initialEmail?: string | undefined;
  reason?: "expired" | undefined;
  onSent: (email: string) => void;
  /** "Continue as guest": use the app with no account. */
  onGuest?: (() => void) | undefined;
}

export function AuthFrame({ children }: { children: React.ReactNode }) {
  return (
    <div className="auth" dir="ltr">
      <h1 className="app-title"><span dir="rtl">משנה בעל פה</span></h1>
      <div className="auth-card">{children}</div>
    </div>
  );
}

export function Login({ initialEmail, reason, onSent, onGuest }: Props) {
  const [config, setConfig] = useState<ConfigResponse | null>(null);
  const [configError, setConfigError] = useState(false);
  const [email, setEmail] = useState(initialEmail ?? "");
  const [token, setToken] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const widget = useRef<TurnstileHandle>(null);

  const loadConfig = () => {
    setConfigError(false);
    api.config().then(setConfig, () => setConfigError(true));
  };
  useEffect(loadConfig, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token || !plausibleEmail(email) || busy) return;
    setBusy(true);
    setError("");
    const addr = email.trim();
    try {
      await api.requestLogin({ email: addr, turnstileToken: token });
      widget.current?.reset();
      onSent(addr);
      return;
    } catch (err) {
      widget.current?.reset();
      if (err instanceof NetworkFailure) setError("You're offline. Connect to the internet and try again.");
      else if (err instanceof ApiFailure) {
        const code = err.body?.error;
        if (code === "turnstile_failed") setError("Please try the check again.");
        else if (code === "rate_limited") {
          const min = Math.max(1, Math.ceil((err.body?.retryAfterSec ?? 60) / 60));
          setError(`Too many tries. Wait ${min} minute${min === 1 ? "" : "s"}.`);
        } else if (code === "email_failed") setError("We couldn't send the email. Try again later.");
        else if (code === "bad_request") setError("Please check the email address.");
        else setError("Something went wrong. Try again.");
      } else setError("Something went wrong. Try again.");
    }
    setBusy(false);
  };

  return (
    <AuthFrame>
      <h2>Parent sign-in</h2>
      {reason === "expired" && <p className="notice">Your sign-in expired. Please sign in again.</p>}
      <p className="hint">We'll email you a sign-in link and a code. No password needed.</p>
      <form onSubmit={(e) => void submit(e)} className="auth-form">
        <label className="field">
          <span>Email</span>
          <input type="email" autoComplete="email" inputMode="email" value={email} placeholder="you@example.com"
            onChange={(e) => setEmail(e.target.value)} required />
        </label>
        {config ? (
          <Turnstile ref={widget} siteKey={config.turnstileSiteKey} onToken={setToken}
            onLoadError={() => setError("The security check couldn't load. Check your connection and reload.")} />
        ) : configError ? (
          <p className="error">Can't reach the server. <button type="button" className="link-btn" onClick={loadConfig}>Retry</button></p>
        ) : (
          <p className="hint">Loading…</p>
        )}
        <button className="btn primary big" type="submit" disabled={!token || !plausibleEmail(email) || busy}>
          {busy ? "Sending…" : "Send me a sign-in email"}
        </button>
        {error && <p className="error" role="alert">{error}</p>}
        {config?.devEmail && <p className="dev-note">Dev mode: the link and code are in the wrangler console.</p>}
      </form>
      {onGuest && <GuestOption onGuest={onGuest} />}
    </AuthFrame>
  );
}

/** The secondary way in: no account, progress kept only in this browser. */
export function GuestOption({ onGuest }: { onGuest: () => void }) {
  return (
    <div className="guest-option">
      <button type="button" className="link-btn" onClick={onGuest}>Continue as guest</button>
      <p className="hint">Try without an account. Progress is saved only in this browser.</p>
    </div>
  );
}

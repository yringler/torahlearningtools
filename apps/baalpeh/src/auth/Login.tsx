import { useEffect, useRef, useState } from "react";
import type { ConfigResponse, SignInAs } from "../../shared/api";
import { api, ApiFailure, NetworkFailure } from "../api/client";
import { LicensesLink, PricingNote, PrivacyLink } from "../components/Licenses";
import { useOpenLibrary } from "../library/open";
import { Turnstile, type TurnstileHandle } from "./Turnstile";

export const plausibleEmail = (s: string): boolean => {
  const e = s.trim();
  return e.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
};

interface Props {
  /** Which sign-in: the learner app or parent mode (docs/PARENT_MODE.md §9.2). */
  as: SignInAs;
  initialEmail?: string | undefined;
  /** Coming from learner mode: the account's email, read-only. */
  lockEmail?: boolean | undefined;
  reason?: "expired" | undefined;
  onSent: (email: string) => void;
  /** "‹ Back" to the choice. */
  onBack?: (() => void) | undefined;
  /** "Continue as guest": use the app with no account. */
  onGuest?: (() => void) | undefined;
}

export function AuthFrame({ children }: { children: React.ReactNode }) {
  return (
    <div className="auth" dir="ltr">
      <h1 className="app-title"><span dir="rtl">משנה בעל פה</span></h1>
      <div className="auth-card">{children}</div>
      <div className="auth-footer"><LicensesLink /> · <PrivacyLink className="link-btn" /></div>
    </div>
  );
}

/** Step 1 of signing in: learner or parent. */
export function Choose({ reason, onPick, onGuest }: { reason?: "expired" | undefined; onPick: (as: SignInAs) => void; onGuest: () => void }) {
  return (
    <AuthFrame>
      {reason === "expired" && <p className="notice">Your sign-in expired. Please sign in again.</p>}
      <h2>Welcome</h2>
      <div className="choice-list">
        <button className="choice" onClick={() => onPick("learner")}>
          <span className="choice-icon" aria-hidden="true">📖</span>
          <span className="choice-text"><b>Sign in as learner</b><span className="sub">For children learning on this device</span></span>
        </button>
        <button className="choice" onClick={() => onPick("parent")}>
          <span className="choice-icon" aria-hidden="true">🔑</span>
          <span className="choice-text"><b>Sign in as parent</b><span className="sub">Add children, see progress, change settings. First time here? Start here.</span></span>
        </button>
      </div>
      <PricingNote />
      <GuestOption onGuest={onGuest} />
      <LibraryOption />
    </AuthFrame>
  );
}

export function Login({ as, initialEmail, lockEmail, reason, onSent, onBack, onGuest }: Props) {
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
      await api.requestLogin({ email: addr, turnstileToken: token, as });
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
      {onBack && <button type="button" className="link-btn back-link" onClick={onBack}>‹ Back</button>}
      <h2>{as === "parent" ? "Parent sign-in" : "Learner sign-in"}</h2>
      {reason === "expired" && <p className="notice">Your sign-in expired. Please sign in again.</p>}
      <p className="hint">{as === "parent"
        ? "We'll email you a parent sign-in link and a code. Then you'll enter your 4-digit parent PIN, or choose one the first time."
        : "Use your family's account email. We'll email a sign-in link and a code to it. No password needed."}</p>
      <form onSubmit={(e) => void submit(e)} className="auth-form">
        <label className="field">
          <span>Email</span>
          <input type="email" autoComplete="email" inputMode="email" value={email} placeholder="you@example.com" readOnly={lockEmail === true}
            onChange={(e) => setEmail(e.target.value)} required />
        </label>
        {lockEmail && (
          <p className="hint">We'll send it to {email}. <span className="small">Different account? Sign this device out in parent mode first.</span></p>
        )}
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
      <PricingNote />
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

/** The library: read any mishnah with its meanings, no account and nothing saved (docs/LIBRARY.md). */
export function LibraryOption() {
  const open = useOpenLibrary();
  if (!open) return null;
  return (
    <div className="guest-option">
      <button type="button" className="link-btn" onClick={() => open()}>📚 Open the Library</button>
      <p className="hint">Read and learn any mishnah. No account needed.</p>
    </div>
  );
}

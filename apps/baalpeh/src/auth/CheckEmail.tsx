import { useEffect, useState } from "react";
import { AUTH, type AuthSuccessResponse } from "../../shared/api";
import { api, ApiFailure, NetworkFailure } from "../api/client";
import { AuthFrame } from "./Login";

interface Props {
  email: string;
  onSuccess: (r: AuthSuccessResponse) => void;
  /** Back to Login with the email prefilled. */
  onResend: (email: string) => void;
  onDifferentEmail: () => void;
}

const RESEND_COOLDOWN_SEC = 30;

export function CheckEmail({ email, onSuccess, onResend, onDifferentEmail }: Props) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [dead, setDead] = useState(false);
  const [cooldown, setCooldown] = useState(RESEND_COOLDOWN_SEC);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  const verify = async (digits: string) => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const r = await api.verifyCode({ email, code: digits });
      onSuccess(r);
      return;
    } catch (e) {
      if (e instanceof NetworkFailure) setError("You're offline. Connect and try again.");
      else if (e instanceof ApiFailure && e.body?.error === "invalid_code") {
        const left = e.body.attemptsLeft;
        if (left === undefined) { setDead(true); setError("This code has expired. Request a new email."); }
        else setError(`That code isn't right (${left} ${left === 1 ? "try" : "tries"} left).`);
      } else if (e instanceof ApiFailure && e.body?.error === "too_many_attempts") {
        setDead(true);
        setError("Too many wrong codes. Request a new email.");
      } else if (e instanceof ApiFailure && e.body?.error === "rate_limited") {
        const min = Math.max(1, Math.ceil((e.body.retryAfterSec ?? 60) / 60));
        setError(`Too many tries. Wait ${min} minute${min === 1 ? "" : "s"}.`);
      } else setError("Something went wrong. Try again.");
      setCode("");
    }
    setBusy(false);
  };

  const onChange = (v: string) => {
    const cleaned = v.replace(/[^0-9 ]/g, "").slice(0, 7);
    setCode(cleaned);
    const digits = cleaned.replace(/\s/g, "");
    if (digits.length === AUTH.CODE_LENGTH && !dead) void verify(digits);
  };

  return (
    <AuthFrame>
      <h2>Check your email</h2>
      <p>We sent an email to <b>{email}</b>. Tap the link in it, or type the 6-digit code here.</p>
      <p className="hint">The link works on any device you open it on. The newest email is the only one that works.</p>
      <label className="field">
        <span>Code</span>
        <input className="code-input" inputMode="numeric" autoComplete="one-time-code" maxLength={7} pattern="[0-9 ]*"
          value={code} disabled={busy || dead} onChange={(e) => onChange(e.target.value)} aria-label="6-digit code" autoFocus />
      </label>
      {busy && <p className="hint">Checking…</p>}
      {error && <p className="error" role="alert">{error}</p>}
      <div className="auth-links">
        <button type="button" className={`link-btn ${dead ? "strong" : ""}`} disabled={cooldown > 0 && !dead} onClick={() => onResend(email)}>
          Send a new email{cooldown > 0 && !dead ? ` (${cooldown}s)` : ""}
        </button>
        <button type="button" className="link-btn" onClick={onDifferentEmail}>Use a different email</button>
      </div>
    </AuthFrame>
  );
}

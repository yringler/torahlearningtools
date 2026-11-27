import { useState } from "react";
import { ApiFailure, NetworkFailure } from "../api/client";
import { PinPad, type PinOutcome } from "../components/PinPad";
import { ConfirmSheet } from "../components/ConfirmSheet";
import { weakPin } from "./pin";

const minutes = (sec: number | undefined) => Math.max(1, Math.ceil((sec ?? 60) / 60));
const minText = (m: number) => `${m} minute${m === 1 ? "" : "s"}`;

/** What a failed unlock or confirm means for the pad. */
export function pinOutcomeOf(e: unknown): PinOutcome {
  if (e instanceof NetworkFailure) return { fail: "You're offline. Connect to enter your PIN." };
  if (e instanceof ApiFailure) {
    const code = e.body?.error;
    if (code === "invalid_pin") return { wrong: true, left: e.body?.attemptsLeft };
    if (code === "pin_locked") return { locked: true };
    if (e.status === 429) return { fail: `Too many tries. Wait ${minText(minutes(e.body?.retryAfterSec))}.` };
  }
  return { fail: "Something went wrong. Try again." };
}

/** Saving a new PIN failed: the text to show. */
export function setPinFailText(e: unknown): string {
  if (e instanceof NetworkFailure) return "You're offline. Connect and try again.";
  if (e instanceof ApiFailure && e.body?.error === "email_failed") return "We couldn't send the notice email, so the PIN wasn't saved. Try again in a minute.";
  if (e instanceof ApiFailure && e.status === 429) return `Too many tries. Wait ${minText(minutes(e.body?.retryAfterSec))}.`;
  return "Something went wrong. Try again.";
}

interface SetupProps {
  /** H2 of step 1. */
  title: string;
  intro?: React.ReactNode;
  /** Saves the PIN; resolves with an error text to start again, or null when saved. */
  save: (pin: string) => Promise<string | null>;
}

/** Choose, then repeat (docs/PARENT_MODE.md §9.6). Weak PINs are refused at step 1. */
export function PinSetup({ title, intro, save }: SetupProps) {
  const [first, setFirst] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [round, setRound] = useState(0);
  const restart = (msg: string) => { setFirst(null); setNote(msg); setRound((r) => r + 1); };

  const submit = async (pin: string): Promise<PinOutcome> => {
    if (first === null) {
      if (weakPin(pin)) return { fail: "That one is easy to guess. Pick another." };
      setNote("");
      setFirst(pin);
      setRound((r) => r + 1);
      return { ok: true };
    }
    if (pin !== first) { restart("Those didn't match. Let's start again."); return { ok: true }; }
    const err = await save(pin);
    if (err !== null) restart(err);
    return { ok: true };
  };

  return (
    <div className="pin-screen">
      {first === null ? (
        <>
          <h2>{title}</h2>
          {intro}
        </>
      ) : (
        <h2>Enter the same 4 digits again</h2>
      )}
      <PinPad step={round} message={note} onSubmit={submit} />
      {first !== null && <button className="btn ghost-btn small" onClick={() => restart("")}>‹ Start again</button>}
    </div>
  );
}

/** The forgot-PIN confirm sheet and its "check your email" result. `send` resolves with the masked address. */
export function ForgotPin({ email, send, onClose }: { email: string; send: () => Promise<string>; onClose: () => void }) {
  const [sentTo, setSentTo] = useState<string | null>(null);
  if (sentTo !== null) {
    return (
      <div className="sheet-backdrop confirm" role="dialog" aria-modal="true" onClick={onClose}>
        <div className="sheet confirm-sheet" dir="ltr" onClick={(e) => e.stopPropagation()}>
          <div className="big-emoji">📬</div>
          <h3>Check your email</h3>
          <p>Open the link in the email from Mishnah Ba'al Peh to choose a new PIN. It works for 1 hour.</p>
          <button className="btn primary" onClick={onClose}>Back</button>
        </div>
      </div>
    );
  }
  return (
    <ConfirmSheet title="Email a link to set a new PIN?" action="Send the email" onCancel={onClose}
      onAct={async () => {
        try {
          setSentTo(await send());
        } catch (e) {
          throw new Error(forgotFailText(e));
        }
      }}>
      <p>We'll send it to <b>{email}</b>. Your current PIN keeps working until a new one is set.</p>
    </ConfirmSheet>
  );
}

export function forgotFailText(e: unknown): string {
  if (e instanceof NetworkFailure) return "You're offline. Connect and try again.";
  if (e instanceof ApiFailure && e.status === 429) {
    return `A reset email was just sent. Check your inbox, or try again in ${minutes(e.body?.retryAfterSec)} min.`;
  }
  if (e instanceof ApiFailure && e.body?.error === "email_failed") return "We couldn't send the email. Try again in a minute.";
  return "Something went wrong. Try again.";
}

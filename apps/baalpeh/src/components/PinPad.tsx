import { useEffect, useReducer, useRef } from "react";
import { PARENT } from "../../shared/api";
import { initialPad, pinPadReducer } from "../parent/pin";

/** What checking a PIN came to. `ok`: the caller moves on (the pad just clears). */
export type PinOutcome =
  | { ok: true }
  | { wrong: true; left?: number | undefined }
  | { locked: true }
  | { fail: string };

interface Props {
  /** Called with all 4 digits; the keys stay disabled until it settles. */
  onSubmit: (pin: string) => Promise<PinOutcome>;
  /** Shows the "Forgot PIN?" key. */
  onForgot?: (() => void) | undefined;
  /** An error to show from outside (e.g. "Those didn't match"). */
  message?: string | undefined;
  /** Changing this clears the pad (a new step of the setup). */
  step?: string | number | undefined;
}

const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9"] as const;

/**
 * The one PIN pad (docs/PARENT_MODE.md §9.5): 4 dots, 1–9, Forgot, 0, ⌫. Physical digit keys, Backspace and pasting
 * 4 digits work; the 4th digit submits. Nothing is checked here: the server decides.
 */
export function PinPad({ onSubmit, onForgot, message, step }: Props) {
  const [st, dispatch] = useReducer(pinPadReducer, initialPad);
  const submitRef = useRef(onSubmit);
  submitRef.current = onSubmit;
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);

  useEffect(() => { dispatch({ a: "clear" }); }, [step]);

  useEffect(() => {
    if (st.submit === null) return;
    const pin = st.submit;
    void submitRef.current(pin).then(
      (r) => {
        if (!alive.current) return;
        if ("ok" in r) dispatch({ a: "clear" });
        else if ("wrong" in r) dispatch({ a: "wrong", left: r.left });
        else if ("locked" in r) dispatch({ a: "locked" });
        else dispatch({ a: "fail", message: r.fail });
      },
      () => { if (alive.current) dispatch({ a: "fail", message: "Something went wrong. Try again." }); },
    );
  }, [st.submit]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return;
      if (/^\d$/.test(e.key)) { e.preventDefault(); dispatch({ a: "digit", d: e.key }); }
      else if (e.key === "Backspace") { e.preventDefault(); dispatch({ a: "back" }); }
    };
    const onPaste = (e: ClipboardEvent) => {
      const text = e.clipboardData?.getData("text") ?? "";
      if (/\d/.test(text)) { e.preventDefault(); dispatch({ a: "paste", text }); }
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("paste", onPaste);
    return () => { window.removeEventListener("keydown", onKey); window.removeEventListener("paste", onPaste); };
  }, []);

  const error = st.error || message || "";
  const n = st.digits.length;
  return (
    <div className="pinpad">
      <div key={st.shake} className={`pin-dots${st.shake > 0 && st.error ? " shake" : ""}`} role="status" aria-live="polite"
        aria-label={`${n} of ${PARENT.PIN_LENGTH} digits`}>
        {Array.from({ length: PARENT.PIN_LENGTH }, (_, i) => <span key={i} className={`pin-dot${i < n ? " on" : ""}`} />)}
        <span className="sr-only">{n} of {PARENT.PIN_LENGTH} digits</span>
      </div>
      <p className="pin-error" role="alert">{error}</p>
      <div className="pin-keys">
        {KEYS.map((k) => (
          <button key={k} type="button" className="pin-key" aria-label={k} disabled={st.busy} onClick={() => dispatch({ a: "digit", d: k })}>{k}</button>
        ))}
        {onForgot ? (
          <button type="button" className="pin-key text" onClick={onForgot} disabled={st.busy}>Forgot PIN?</button>
        ) : <span aria-hidden="true" />}
        <button type="button" className="pin-key" aria-label="0" disabled={st.busy} onClick={() => dispatch({ a: "digit", d: "0" })}>0</button>
        <button type="button" className="pin-key text" aria-label="Delete" disabled={st.busy || n === 0} onClick={() => dispatch({ a: "back" })}>⌫</button>
      </div>
      {st.busy && <p className="hint">Checking…</p>}
    </div>
  );
}

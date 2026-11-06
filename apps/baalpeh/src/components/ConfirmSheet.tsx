import { useState } from "react";

interface Props {
  title: string;
  children?: React.ReactNode;
  action: string;
  danger?: boolean;
  /** Extra condition for the action (e.g. a typed name matches). */
  canAct?: boolean;
  /** Resolves when done (the caller closes the sheet); a thrown Error's message is shown inline. */
  onAct: () => Promise<void> | void;
  onCancel: () => void;
}

/** A bottom sheet on phones, a centred card on tablets (docs/PARENT_MODE.md §9.8). */
export function ConfirmSheet({ title, children, action, danger, canAct = true, onAct, onCancel }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const act = async () => {
    setBusy(true);
    setError("");
    try {
      await onAct();
    } catch (e) {
      setError(e instanceof Error && e.message ? e.message : "Something went wrong. Try again.");
      setBusy(false);
    }
  };
  return (
    <div className="sheet-backdrop confirm" role="dialog" aria-modal="true" aria-labelledby="confirm-title" onClick={() => !busy && onCancel()}>
      <div className="sheet confirm-sheet" dir="ltr" onClick={(e) => e.stopPropagation()}>
        <h3 id="confirm-title">{title}</h3>
        {children}
        {error && <p className="error" role="alert">{error}</p>}
        <div className="confirm-actions">
          <button className="btn secondary" disabled={busy} onClick={onCancel}>Cancel</button>
          <button className={`btn primary${danger ? " danger-fill" : ""}`} disabled={busy || !canAct} onClick={() => void act()}>
            {busy ? "Saving…" : action}
          </button>
        </div>
      </div>
    </div>
  );
}

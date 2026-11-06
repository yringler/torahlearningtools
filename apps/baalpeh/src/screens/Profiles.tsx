import { useState } from "react";
import { SESSION_GUEST_EMOJI } from "../guest";
import { kv } from "../kv";
import type { SyncStatus } from "../sync/engine";
import type { Profile } from "../types";

interface Props {
  profiles: Profile[];
  status: SyncStatus;
  /** First sync of a fresh device is running. */
  loading: boolean;
  onPick: (id: string) => void;
  /** Learn as an untracked guest (nothing saved, not part of the account). */
  onGuest: () => void;
  /** Starts the parent sign-in (email, then the PIN). Nothing here opens parent mode by itself. */
  onParentSignIn: () => Promise<void>;
}

const DOT_LABEL: Record<SyncStatus["state"], string> = {
  idle: "Synced", syncing: "Syncing", offline: "Offline", error: "Sync problem", signedOut: "Signed out",
};

/** The one-time note for existing families (docs/PARENT_MODE.md §9.3). */
export const PARENT_NOTE_KEY = "baalpeh:parentModeNote";
const noteSeen = (): boolean => {
  try { return kv.getItem(PARENT_NOTE_KEY) === "1"; } catch { return true; }
};

/** Profiles' child-facing copy, kept here so the copy test can read it. */
export const NO_LEARNERS = {
  title: "No learners yet.",
  hint: "Ask Abba or Ima to add you in parent mode. Then you can begin learning here.",
} as const;
export const PARENT_NOTE = "Parents now have their own sign-in, with a 4-digit PIN. A parent can tap \"Parent? Sign in as parent\" below.";

/** "Who's learning?" — the learner app's first screen. It holds nothing a child could change for the family. */
export function Profiles({ profiles, status, loading, onPick, onGuest, onParentSignIn }: Props) {
  const [busy, setBusy] = useState(false);
  const [showNote, setShowNote] = useState(() => !noteSeen());
  const closeNote = () => {
    try { kv.setItem(PARENT_NOTE_KEY, "1"); } catch { /* ignore */ }
    setShowNote(false);
  };
  const parent = () => {
    if (busy) return;
    setBusy(true);
    void onParentSignIn().finally(() => setBusy(false));
  };
  return (
    <div className="profiles" dir="ltr">
      <span className={`sync-dot ${status.state}`} role="img" aria-label={DOT_LABEL[status.state]} title={DOT_LABEL[status.state]} />
      <h1 className="app-title"><span dir="rtl">משנה בעל פה</span></h1>
      {profiles.length > 0 ? (
        <>
          <h2>Who's learning?</h2>
          <div className="profile-grid">
            {profiles.map((p) => (
              <button key={p.id} className="profile-tile" style={{ borderColor: p.color }} onClick={() => onPick(p.id)}>
                <span className="emoji">{p.emoji}</span>
                <span className="name" style={{ color: p.color }}>{p.name}</span>
              </button>
            ))}
            {/* Last, so children keep their places. Dashed and muted: not one of the children. */}
            <button className="profile-tile guest" onClick={onGuest} aria-label="Guest (nothing is saved)">
              <span className="emoji">{SESSION_GUEST_EMOJI}</span>
              <span className="name">Guest</span>
              <span className="sub">nothing saved</span>
            </button>
          </div>
          {showNote && (
            <div className="parent-note" role="note">
              <p>{PARENT_NOTE}</p>
              <button className="btn secondary small" onClick={closeNote}>OK</button>
            </div>
          )}
        </>
      ) : loading ? (
        <p className="hint first-run">Loading your children…</p>
      ) : (
        <div className="first-run">
          <h2>{NO_LEARNERS.title}</h2>
          <p className="hint">{NO_LEARNERS.hint}</p>
          <button className="btn primary" disabled={busy} onClick={parent}>🔑 Sign in as parent</button>
          <div className="or-divider" aria-hidden="true"><span>or</span></div>
          <button className="btn guest-first-run" onClick={onGuest}>{SESSION_GUEST_EMOJI} Learn as a guest <span className="sub">nothing saved</span></button>
        </div>
      )}
      <button className="link-btn parent-link" disabled={busy} onClick={parent}>{busy ? "Opening parent sign-in…" : "Parent? Sign in as parent"}</button>
    </div>
  );
}

import { useRef, useState } from "react";
import { newProfile } from "../storage";
import type { SyncStatus } from "../sync/engine";
import type { Profile } from "../types";

interface Props {
  profiles: Profile[];
  status: SyncStatus;
  /** First sync of a fresh device is running. */
  loading: boolean;
  onAdd: (p: Profile) => void;
  onPick: (id: string) => void;
  onParent: () => void;
}

/** Hold the parent button for 2s (keeps little fingers out). */
function HoldButton({ onHold, children }: { onHold: () => void; children: React.ReactNode }) {
  const t = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [holding, setHolding] = useState(false);
  const start = () => { setHolding(true); t.current = setTimeout(() => { setHolding(false); onHold(); }, 2000); };
  const stop = () => { setHolding(false); if (t.current) clearTimeout(t.current); };
  return (
    <button
      className={`btn ghost-btn hold ${holding ? "holding" : ""}`}
      onPointerDown={start} onPointerUp={stop} onPointerLeave={stop} onContextMenu={(e) => e.preventDefault()}
    >
      {children}
    </button>
  );
}

const DOT_LABEL: Record<SyncStatus["state"], string> = {
  idle: "Synced", syncing: "Syncing", offline: "Offline", error: "Sync problem", signedOut: "Signed out",
};

/** "Who's learning?" — the account's main screen. */
export function Profiles({ profiles, status, loading, onAdd, onPick, onParent }: Props) {
  const [name, setName] = useState("");
  const add = () => {
    const n = name.trim();
    if (!n) return;
    onAdd(newProfile(n, profiles.length));
    setName("");
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
          </div>
        </>
      ) : loading ? (
        <p className="hint first-run">Loading your children…</p>
      ) : (
        <div className="first-run">
          <h2>No children yet.</h2>
          <p className="hint">Add the first child who will learn on this device.</p>
          <form className="row center" onSubmit={(e) => { e.preventDefault(); add(); }}>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Child's name" aria-label="Child's name" maxLength={40} />
            <button className="btn primary" type="submit" disabled={!name.trim()}>Add child</button>
          </form>
        </div>
      )}
      <HoldButton onHold={onParent}>🔒 Parent (hold)</HoldButton>
    </div>
  );
}

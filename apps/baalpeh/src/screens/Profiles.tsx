import { useRef, useState } from "react";
import type { Profile } from "../types";

interface Props {
  profiles: Profile[];
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

export function Profiles({ profiles, onPick, onParent }: Props) {
  return (
    <div className="profiles" dir="ltr">
      <h1 className="app-title"><span dir="rtl">משנה בעל פה</span></h1>
      <h2>Who's learning?</h2>
      <div className="profile-grid">
        {profiles.map((p) => (
          <button key={p.id} className="profile-tile" style={{ borderColor: p.color }} onClick={() => onPick(p.id)}>
            <span className="emoji">{p.emoji}</span>
            <span className="name" style={{ color: p.color }}>{p.name}</span>
          </button>
        ))}
        {profiles.length === 0 && <p className="hint">No learners yet. Ask a parent to add you.</p>}
      </div>
      <HoldButton onHold={onParent}>🔒 Parent (hold)</HoldButton>
    </div>
  );
}

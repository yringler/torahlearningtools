import { useState } from "react";
import { words } from "../hebrew";
import type { Grade } from "../types";

interface Props {
  title: string;
  cards: Array<{ label?: string; he: string }>;
  onDone: (grade: Grade, slippedCards: number[]) => void;
}

/** Parent holds the device; child recites from memory. Tap words to mark slips, then grade. */
export function ParentCheck({ title, cards, onDone }: Props) {
  const [ready, setReady] = useState(false);
  const [slips, setSlips] = useState<Set<string>>(new Set());
  const toggle = (k: string) =>
    setSlips((s) => {
      const n = new Set(s);
      if (n.has(k)) n.delete(k); else n.add(k);
      return n;
    });
  const slipped = [...new Set([...slips].map((k) => Number(k.split(":")[0])))];

  if (!ready) {
    return (
      <div className="parent-check intro" dir="ltr">
        <div className="big-emoji">👂</div>
        <h2>{title}</h2>
        <p>Time to show Abba or Ima! Hand them the screen and say it by heart.</p>
        <button className="btn primary big" onClick={() => setReady(true)}>I'm the parent — show me the text</button>
      </div>
    );
  }
  return (
    <div className="parent-check">
      <div className="prompt" dir="ltr">Parent: listen, and tap any word the child missed or needed help with.</div>
      <div className="pc-text">
        {cards.map((c, ci) => (
          <div key={ci} className="pc-card">
            {c.label && <div className="pc-label">{c.label}</div>}
            {words(c.he).map((w, wi) => {
              const k = `${ci}:${wi}`;
              return (
                <button key={k} className={`word tappable ${slips.has(k) ? "slip" : ""}`} onClick={() => toggle(k)}>
                  {w}
                </button>
              );
            })}
          </div>
        ))}
      </div>
      <div className="actions grade" dir="ltr">
        <button className="btn primary" onClick={() => onDone("pass", slipped)}>⭐ Perfect</button>
        <button className="btn secondary" onClick={() => onDone("help", slipped)}>👍 Small slips</button>
        <button className="btn ghost-btn" onClick={() => onDone("notyet", slipped)}>🔁 Needs more practice</button>
      </div>
    </div>
  );
}

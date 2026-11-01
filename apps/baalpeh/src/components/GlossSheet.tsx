import type { Word } from "../types";

export function GlossSheet({ word, onClose }: { word: Word | null; onClose: () => void }) {
  if (!word) return null;
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()} dir="ltr">
        <div className="sheet-word" dir="rtl">{word.he}</div>
        <div className="sheet-en">{word.en}</div>
        {word.note && <div className="sheet-note">💡 {word.note}</div>}
        <button className="btn secondary" onClick={onClose}>Close</button>
      </div>
    </div>
  );
}

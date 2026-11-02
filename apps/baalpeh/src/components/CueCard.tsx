import { useEffect, useState } from "react";
import { firstLetter, trailingPunct, words } from "../hebrew";
import type { Cue, Word } from "../types";

interface Props {
  he: string;
  cue: Cue;
  /** Glossed words; when given and cue is 0, words become tappable. */
  glossWords?: Word[] | undefined;
  onWordTap?: ((w: Word) => void) | undefined;
  /** Hidden cards (cue ≥ 2) can be tapped to peek for 2 seconds. */
  onPeek?: (() => void) | undefined;
  highlight?: boolean;
}

const PEEK_MS = 2000;

function renderWord(w: string, cue: Cue, i: number): string {
  if (cue <= 1) return w;
  if (cue === 2) return `${firstLetter(w)}··${trailingPunct(w)}`;
  if (cue === 3) return i === 0 ? w : "";
  return "";
}

export function CueCard({ he, cue, glossWords, onWordTap, onPeek, highlight = false }: Props) {
  const [peeking, setPeeking] = useState(false);
  useEffect(() => {
    if (!peeking) return;
    const t = setTimeout(() => setPeeking(false), PEEK_MS);
    return () => clearTimeout(t);
  }, [peeking]);

  const shown: Cue = peeking ? 0 : cue;
  const ws = words(he);
  const canPeek = cue >= 2 && onPeek !== undefined && !peeking;

  const cls = ["card", `cue-${shown}`, highlight ? "card-new" : "", canPeek ? "peekable" : "", peeking ? "peeking" : ""]
    .filter(Boolean)
    .join(" ");

  const handleCard = () => {
    if (!canPeek) return;
    setPeeking(true);
    onPeek?.();
  };

  return (
    <div
      className={cls}
      onClick={handleCard}
      role={canPeek ? "button" : undefined}
      aria-label={canPeek ? "Peek at this piece" : undefined}
    >
      {shown === 4 ? (
        // keep the card's shape: invisible text holds the width
        <span className="ghost" aria-hidden="true">{he}</span>
      ) : (
        ws.map((w, i) => {
          const text = renderWord(w, shown, i);
          const g = glossWords?.[i];
          if (shown === 0 && g && onWordTap && !peeking) {
            return (
              <button key={i} className="word tappable" onClick={(e) => { e.stopPropagation(); onWordTap(g); }}>
                {text}
              </button>
            );
          }
          if (shown === 3 && i > 0) return i === 1 ? <span key={i} className="word dots">···</span> : null;
          return <span key={i} className="word">{text}</span>;
        })
      )}
      {canPeek && <span className="peek-hint" aria-hidden="true">👁</span>}
    </div>
  );
}

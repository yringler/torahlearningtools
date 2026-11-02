import type { Word } from "../types";

export function Chevron({ dir, className = "wp-arrow" }: { dir: "left" | "right"; className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" width="28" height="28" aria-hidden="true">
      <path d={dir === "left" ? "M15 5l-7 7 7 7" : "M9 5l7 7-7 7"} fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

interface Props {
  word: Word | null;
  /** 1-based place of the word and how many words there are (shown as "3 / 6"). */
  n: number;
  total: number;
  onNext: () => void;
  onPrev: () => void;
  canNext: boolean;
  canPrev: boolean;
  /** Shows a ✕ (used where the panel only appears after a tap). */
  onClose?: (() => void) | undefined;
  /** Text shown while no word is selected. */
  placeholder?: string | undefined;
  /** Stick to the bottom of the screen while scrolling. */
  sticky?: boolean | undefined;
}

/**
 * The selected word's meaning. Never modal: the text above stays tappable, so one tap on any word
 * switches to it. Hebrew reads right to left, so Next sits on the left and Back on the right.
 */
export function WordPanel({ word, n, total, onNext, onPrev, canNext, canPrev, onClose, placeholder, sticky = false }: Props) {
  return (
    <div className={`word-panel${sticky ? " sticky" : ""}`} dir="ltr" role="region" aria-label="Word meaning">
      <button type="button" className="wp-nav" onClick={onNext} disabled={!canNext} aria-label="Next word">
        <Chevron dir="left" />
        <span>Next</span>
      </button>
      <div className="wp-body" aria-live="polite">
        {word ? (
          <>
            <div className="wp-he" dir="rtl" lang="he">{word.he}</div>
            <div className="wp-en">{word.en}</div>
            {word.note && <div className="wp-note">💡 {word.note}</div>}
            {total > 1 && <div className="wp-count">{n} / {total}</div>}
          </>
        ) : (
          <div className="wp-placeholder">{placeholder}</div>
        )}
      </div>
      <button type="button" className="wp-nav" onClick={onPrev} disabled={!canPrev} aria-label="Previous word">
        <Chevron dir="right" />
        <span>Back</span>
      </button>
      {onClose && (
        <button type="button" className="wp-close" onClick={onClose} aria-label="Close word meaning">✕</button>
      )}
    </div>
  );
}

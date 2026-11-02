import { useEffect, useRef } from "react";
import type { Chunk, Step } from "../types";
import { pathGroups } from "../steps";

interface Props {
  steps: Step[];
  chunks: Chunk[];
  /** Current step index; steps.length means the parent check. */
  current: number;
  onJump: (index: number) => void;
  onClose: () => void;
}

/**
 * Every step of the mishnah as a list, for going back or skipping ahead on purpose. Opened from the
 * step label; the main button on the screen is the only "next".
 */
export function StepSheet({ steps, chunks, current, onJump, onClose }: Props) {
  const groups = pathGroups(steps, chunks);
  const currentRef = useRef<HTMLButtonElement>(null);
  const close = useRef(onClose);
  close.current = onClose;

  useEffect(() => {
    currentRef.current?.focus();
    currentRef.current?.scrollIntoView({ block: "nearest" });
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") close.current(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const row = (i: number, label: string) => {
    const st = i < current ? "done" : i === current ? "current" : "upcoming";
    const mark = st === "done" ? "✓" : st === "current" ? "●" : "○";
    const word = st === "done" ? "done" : st === "current" ? "now" : "not yet";
    return (
      <li key={i}>
        <button
          type="button"
          ref={st === "current" ? currentRef : undefined}
          className={`step-row ${st}`}
          aria-current={st === "current" ? "step" : undefined}
          aria-label={`${label}, ${word}`}
          onClick={() => { onJump(i); onClose(); }}
        >
          <span className="step-mark" aria-hidden="true">{mark}</span>
          <span>{label}</span>
        </button>
      </li>
    );
  };

  return (
    <div className="sheet-backdrop" role="dialog" aria-modal="true" aria-labelledby="step-sheet-title" onClick={onClose}>
      <div className="sheet step-sheet" dir="ltr" onClick={(e) => e.stopPropagation()}>
        <h3 id="step-sheet-title">Go to a step</h3>
        <div className="step-list">
          {groups.map((g) => (
            <section key={String(g.key)}>
              {groups.length > 1 && <h4>{g.key === "join" ? "All together" : `Part ${g.key + 1}`}</h4>}
              <ol>{g.steps.map((i) => row(i, (steps[i]?.label ?? "").replace(/^Part \d+ · /, "")))}</ol>
            </section>
          ))}
          <ol>{row(steps.length, "Show Abba or Ima")}</ol>
        </div>
        <button type="button" className="btn ghost-btn small" onClick={onClose}>Close</button>
      </div>
    </div>
  );
}

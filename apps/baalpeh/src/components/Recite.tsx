import { useEffect, useMemo, useState } from "react";
import type { Cue, Grade } from "../types";
import { CueCard } from "./CueCard";

export interface ReciteCard {
  he: string;
}

interface Props {
  cards: ReciteCard[];
  /** Cue for each card, per phase. The last phase is the graded test; earlier phases are warm-ups. */
  phases: Cue[][];
  prompts: string[];
  newest?: number | undefined;
  onDone: (grade: Grade, peeksPerCard: number[]) => void;
}

/** Disable "I said it" briefly so it can't be tapped through: ~1.2s per card, 2–6s. */
const lockMs = (n: number): number => Math.min(6000, Math.max(2000, n * 1200));

/**
 * Recall loop with peek counting.
 * Test phase: 0 peeks → pass; 1 peek → repeat once ("help"); ≥2 → step back a phase (or soften cues).
 * Three "not yet"s in a row end with grade notyet so the caller can insert a detour.
 */
export function Recite({ cards, phases, prompts, newest, onDone }: Props) {
  const [phase, setPhase] = useState(0);
  const [softened, setSoftened] = useState(false);
  const [peeks, setPeeks] = useState<number[]>(() => cards.map(() => 0));
  const [totalPeeks, setTotalPeeks] = useState<number[]>(() => cards.map(() => 0));
  const [helpUsed, setHelpUsed] = useState(false);
  const [fails, setFails] = useState(0);
  const [locked, setLocked] = useState(true);
  const [round, setRound] = useState(0);

  const isTest = phase === phases.length - 1;

  useEffect(() => {
    setLocked(true);
    const t = setTimeout(() => setLocked(false), lockMs(cards.length));
    return () => clearTimeout(t);
  }, [phase, round, cards.length]);

  const cues: Cue[] = useMemo(() => {
    const base = phases[phase] ?? phases[phases.length - 1] ?? [];
    return base.map((c) => (softened ? (Math.max(2, c - 1) as Cue) : c));
  }, [phases, phase, softened]);

  const peekCount = peeks.reduce((a, b) => a + b, 0);

  const restart = () => {
    setPeeks(cards.map(() => 0));
    setRound((r) => r + 1);
  };

  const saidIt = () => {
    if (!isTest) {
      setPhase(phase + 1);
      restart();
      return;
    }
    if (peekCount === 0) {
      onDone(helpUsed ? "help" : "pass", totalPeeks);
      return;
    }
    if (peekCount === 1) {
      if (helpUsed) { onDone("help", totalPeeks); return; }
      setHelpUsed(true);
      restart();
      return;
    }
    const f = fails + 1;
    setFails(f);
    if (f >= 3) { onDone("notyet", totalPeeks); return; }
    if (phases.length > 1) setPhase(phase - 1);
    else setSoftened(true);
    restart();
  };

  const peek = (i: number) => {
    setPeeks((p) => p.map((v, j) => (j === i ? v + 1 : v)));
    setTotalPeeks((p) => p.map((v, j) => (j === i ? v + 1 : v)));
  };

  const prompt = helpUsed && isTest ? "One more time — you can do it!" : prompts[phase] ?? prompts[prompts.length - 1] ?? "";

  return (
    <div className="recite">
      <div className="prompt" dir="ltr">{prompt}</div>
      <div className="cards">
        {cards.map((c, i) => (
          <CueCard
            key={`${round}-${i}`}
            he={c.he}
            cue={cues[i] ?? 4}
            onPeek={() => peek(i)}
            highlight={i === newest}
          />
        ))}
      </div>
      <div className="peek-line" dir="ltr">
        {(cues.some((c) => c >= 2)) && <>Stuck? Tap a card to peek. {peekCount > 0 && <b>Peeks: {peekCount}</b>}</>}
      </div>
      <div className="actions">
        <button className="btn primary big" disabled={locked} onClick={saidIt}>
          ✓ I said it
        </button>
      </div>
    </div>
  );
}

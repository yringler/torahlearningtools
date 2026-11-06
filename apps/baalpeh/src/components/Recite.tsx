import { useEffect, useMemo, useState } from "react";
import type { Cue, Grade } from "../types";
import { CueCard } from "./CueCard";

export interface ReciteCard {
  he: string;
}

/** A labelled run of cards (e.g. one mishnah's phrases): cards[start..end), `end` exclusive. */
export interface ReciteSection {
  label: string;
  start: number;
  end: number;
}

interface Props {
  cards: ReciteCard[];
  /** Cue for each card, per phase. The last phase is the graded test; earlier phases are warm-ups. */
  phases: Cue[][];
  prompts: string[];
  /** Card(s) to highlight as the newest. */
  newest?: number | readonly number[] | undefined;
  /** Group the cards under labels (compact phrase cards). Many sections are shown one per page. */
  sections?: ReciteSection[] | undefined;
  onDone: (grade: Grade, peeksPerCard: number[]) => void;
}

/** Disable "I said it" briefly so it can't be tapped through: ~1.2s per card, 2–6s. */
const lockMs = (n: number): number => Math.min(6000, Math.max(2000, n * 1200));

/** More than this many sections, or cards, and the sections are shown one per page. */
export const PAGE_SECTIONS = 2;
export const PAGE_CARDS = 24;

/**
 * The pages a recitation is shown in: one per section when there are more than PAGE_SECTIONS sections or more than
 * PAGE_CARDS cards, else one page with every section. Each page is a list of sections.
 */
export function recitePages(cardCount: number, sections: ReciteSection[] | undefined): ReciteSection[][] {
  const all: ReciteSection[] = sections && sections.length ? sections : [{ label: "", start: 0, end: cardCount }];
  const paged = sections !== undefined && (sections.length > PAGE_SECTIONS || cardCount > PAGE_CARDS);
  return paged ? all.map((s) => [s]) : [all];
}

/**
 * Recall loop with peek counting.
 * Test phase: 0 peeks → pass; 1 peek → repeat once ("help"); ≥2 → step back a phase (or soften cues).
 * Three "not yet"s in a row end with grade notyet so the caller can insert a detour.
 * With paging, "I said it" is on the last page; the other pages have Back / Next mishnah, each locked briefly.
 */
export function Recite({ cards, phases, prompts, newest, sections, onDone }: Props) {
  const [phase, setPhase] = useState(0);
  const [softened, setSoftened] = useState(false);
  const [peeks, setPeeks] = useState<number[]>(() => cards.map(() => 0));
  const [totalPeeks, setTotalPeeks] = useState<number[]>(() => cards.map(() => 0));
  const [helpUsed, setHelpUsed] = useState(false);
  const [fails, setFails] = useState(0);
  const [locked, setLocked] = useState(true);
  const [round, setRound] = useState(0);
  const [page, setPage] = useState(0);

  const pages = useMemo(() => recitePages(cards.length, sections), [cards.length, sections]);
  const pageIdx = Math.min(page, pages.length - 1);
  const shown = pages[pageIdx] ?? [];
  const onPage = shown.reduce((a, s) => a + Math.max(0, s.end - s.start), 0);
  const lastPage = pageIdx >= pages.length - 1;
  const isTest = phase === phases.length - 1;

  useEffect(() => {
    setLocked(true);
    const t = setTimeout(() => setLocked(false), lockMs(onPage));
    return () => clearTimeout(t);
  }, [phase, round, pageIdx, onPage]);

  const cues: Cue[] = useMemo(() => {
    const base = phases[phase] ?? phases[phases.length - 1] ?? [];
    return base.map((c) => (softened ? (Math.max(2, c - 1) as Cue) : c));
  }, [phases, phase, softened]);

  const isNewest = (i: number): boolean => (typeof newest === "number" ? i === newest : newest?.includes(i) ?? false);

  const peekCount = peeks.reduce((a, b) => a + b, 0);

  const restart = () => {
    setPeeks(cards.map(() => 0));
    setRound((r) => r + 1);
    setPage(0);
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

  const card = (i: number, c: ReciteCard) => (
    <CueCard key={`${round}-${i}`} he={c.he} cue={cues[i] ?? 4} onPeek={() => peek(i)} highlight={isNewest(i)} />
  );

  const said = (
    <button className="btn primary big" disabled={locked} onClick={saidIt}>
      ✓ I said it
    </button>
  );

  return (
    <div className="recite">
      <div className="prompt" dir="ltr">{prompt}</div>
      {sections ? (
        shown.map((s) => (
          <section key={`${s.start}-${s.label}`} className="mcard">
            <div className="mcard-label">{s.label}</div>
            <div className="cards compact">
              {cards.slice(s.start, s.end).map((c, j) => card(s.start + j, c))}
            </div>
          </section>
        ))
      ) : (
        <div className="cards">{cards.map((c, i) => card(i, c))}</div>
      )}
      <div className="peek-line" dir="ltr">
        {(cues.some((c) => c >= 2)) && <>Stuck? Tap a card to peek. {peekCount > 0 && <b>Peeks: {peekCount}</b>}</>}
      </div>
      {pages.length > 1 ? (
        // Right to left like the Hebrew: Back on the right, Next mishnah on the left.
        <div className="pager">
          <button className="btn ghost-btn small" dir="ltr" disabled={pageIdx === 0} onClick={() => setPage(pageIdx - 1)}>Back ›</button>
          <span className="pager-count" dir="ltr">Mishnah {pageIdx + 1} of {pages.length}</span>
          {lastPage ? said : (
            <button className="btn secondary" dir="ltr" disabled={locked} onClick={() => setPage(pageIdx + 1)}>‹ Next mishnah</button>
          )}
        </div>
      ) : (
        <div className="actions">{said}</div>
      )}
    </div>
  );
}

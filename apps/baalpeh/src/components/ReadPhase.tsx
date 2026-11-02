import { useMemo, useState } from "react";
import type { Chunk, MeaningView } from "../types";
import { useWordCursor, wordAvail, wordOrdinal } from "../wordCursor";
import { CueCard } from "./CueCard";
import { Meaning, ViewToggle } from "./Meaning";
import { WordPanel } from "./WordPanel";

interface Props {
  chunk: Chunk;
  context?: Chunk[]; // previous chunks of the segment, shown faintly for orientation
  perek: number;
  mishnah: number;
  view: MeaningView;
  onView: (v: MeaningView) => void;
  onDone: () => void;
}

/** First exposure: full text + meaning; tap words (or step with Next/Back) for glosses; read it out loud twice. */
export function ReadPhase({ chunk, context = [], perek, mishnah, view, onView, onDone }: Props) {
  const [reads, setReads] = useState(0);
  const avail = useMemo(() => wordAvail([chunk]), [chunk]);
  const cur = useWordCursor(avail, false, true, chunk);
  const word = cur.sel ? (chunk.words[cur.sel.word] ?? null) : null;
  const ord = cur.sel ? wordOrdinal(avail, cur.sel, false) : { n: 0, total: 0 };
  const tap = () => {
    if (reads + 1 >= 2) onDone();
    else setReads(reads + 1);
  };
  return (
    <div className="recite">
      <div className="prompt" dir="ltr">Read it out loud 2 times. Tap a word to see what it means.</div>
      {context.length > 0 && (
        <div className="context">{context.map((c) => c.he).join(" ")}</div>
      )}
      <div className="cards">
        <CueCard
          he={chunk.he}
          cue={0}
          glossWords={chunk.words}
          onWordTap={(_, i) => cur.tap(0, i)}
          selectedIndex={cur.sel?.word}
          highlight
        />
      </div>
      <WordPanel
        word={word}
        n={ord.n}
        total={ord.total}
        onNext={cur.next}
        onPrev={cur.prev}
        canNext={cur.canNext}
        canPrev={cur.canPrev}
        placeholder="Tap a word, or press Next to go word by word."
      />
      {chunk.en && <Meaning key={view} chunk={chunk} view={view} perek={perek} mishnah={mishnah} />}
      {chunk.st && <ViewToggle view={view} onChange={onView} />}
      <div className="actions">
        <button className="btn primary big" onClick={tap}>
          I read it <span className="dots-count">{[0, 1].map((i) => (i < reads ? "●" : "○")).join("")}</span>
        </button>
      </div>
    </div>
  );
}

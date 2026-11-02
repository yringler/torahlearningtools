import { useState } from "react";
import { speak } from "../tts";
import type { Chunk, MeaningView, Word } from "../types";
import { CueCard } from "./CueCard";
import { GlossSheet } from "./GlossSheet";
import { Meaning, ViewToggle } from "./Meaning";

interface Props {
  chunk: Chunk;
  context?: Chunk[]; // previous chunks of the segment, shown faintly for orientation
  tts: boolean;
  perek: number;
  mishnah: number;
  view: MeaningView;
  onView: (v: MeaningView) => void;
  onDone: () => void;
}

/** First exposure: full text + meaning; tap words for glosses; read aloud twice. */
export function ReadPhase({ chunk, context = [], tts, perek, mishnah, view, onView, onDone }: Props) {
  const [reads, setReads] = useState(0);
  const [word, setWord] = useState<Word | null>(null);
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
        <CueCard he={chunk.he} cue={0} glossWords={chunk.words} onWordTap={setWord} highlight />
      </div>
      {chunk.en && <Meaning key={view} chunk={chunk} view={view} perek={perek} mishnah={mishnah} />}
      {chunk.st && <ViewToggle view={view} onChange={onView} />}
      <div className="actions">
        {tts && (
          <button className="btn secondary" onClick={() => speak(chunk.he)} title="Approximate pronunciation">
            🔊
          </button>
        )}
        <button className="btn primary big" onClick={tap}>
          I read it <span className="dots-count">{[0, 1].map((i) => (i < reads ? "●" : "○")).join("")}</span>
        </button>
      </div>
      <GlossSheet word={word} onClose={() => setWord(null)} />
    </div>
  );
}

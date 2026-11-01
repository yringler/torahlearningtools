import { useState } from "react";
import { CueCard } from "../components/CueCard";
import { GlossSheet } from "../components/GlossSheet";
import { Meaning, SteinsaltzText, ViewToggle } from "../components/Meaning";
import { StepPath } from "../components/StepPath";
import { getMishnah, hebNum, MASECHTA } from "../data";
import { isKnown, mp } from "../progress";
import { buildSteps } from "../steps";
import { speak } from "../tts";
import { SOURCES } from "../sources";
import type { MeaningView, Profile, Word } from "../types";

interface Props {
  profile: Profile;
  perek: number;
  mishnah: number;
  onPractice: () => void;
  onReview: () => void;
  onBack: () => void;
  onView: (v: MeaningView) => void;
}

export function MishnahScreen({ profile, perek, mishnah, onPractice, onReview, onBack, onView }: Props) {
  const m = getMishnah(perek, mishnah);
  const steps = buildSteps(m.chunks);
  const st = mp(profile, perek, mishnah);
  const [word, setWord] = useState<Word | null>(null);
  const [hideMeaning, setHideMeaning] = useState(false);
  const [showFull, setShowFull] = useState(false);
  const view = profile.settings.meaningView ?? "simple";

  return (
    <div className="mishnah-screen">
      <div className="topbar" dir="ltr">
        <button className="btn ghost-btn small" onClick={onBack}>‹ Map</button>
        <span className="who" style={{ color: profile.color }}>{profile.emoji} {profile.name}</span>
      </div>
      <h2 className="task-title">{MASECHTA.masechta} {hebNum(perek)}:{hebNum(mishnah)}</h2>
      {m.summary && <p className="summary" dir="ltr">{m.summary}</p>}
      <StepPath steps={steps} chunks={m.chunks} current={isKnown(st) ? steps.length : st.stepIndex} />
      <div className="actions" dir="ltr">
        {isKnown(st) ? (
          <button className="btn primary big" onClick={onReview}>🔁 Review it</button>
        ) : (
          <button className="btn primary big" onClick={onPractice}>
            {st.stepIndex > 0 ? "▶ Keep learning" : "▶ Start learning"}
          </button>
        )}
      </div>
      <div className="toggles" dir="ltr">
        <ViewToggle view={view} onChange={onView} allowHide hidden={hideMeaning} onHide={setHideMeaning} />
        <label><input type="checkbox" checked={showFull} onChange={(e) => setShowFull(e.target.checked)} /> Whole mishnah in Steinsaltz</label>
      </div>
      <p className="hint" dir="ltr">Tap any word to see what it means.</p>
      <div className="study">
        {m.chunks.map((c, i) => (
          <div key={i} className="study-row">
            <CueCard he={c.he} cue={0} glossWords={c.words} onWordTap={setWord} />
            {profile.settings.tts && (
              <button className="btn ghost-btn small" onClick={() => speak(c.he)} aria-label="Play">🔊</button>
            )}
            {!hideMeaning && c.en && <Meaning key={view} chunk={c} view={view} perek={perek} mishnah={mishnah} />}
          </div>
        ))}
      </div>
      {showFull && (
        <div className="full-st" dir="ltr">
          {[m.stIntro ?? "", ...m.chunks.flatMap((c) => [c.st ?? "", c.stMore ?? ""])].filter(Boolean).map((h, i) => (
            <span key={i}><SteinsaltzText html={h} /> </span>
          ))}
          <div className="credit">{SOURCES.steinsaltz.detail}</div>
        </div>
      )}
      <GlossSheet word={word} onClose={() => setWord(null)} />
    </div>
  );
}

import { useState } from "react";
import { CueCard } from "../components/CueCard";
import { GlossSheet } from "../components/GlossSheet";
import { StepPath } from "../components/StepPath";
import { getMishnah, hebNum, MASECHTA } from "../data";
import { isKnown, mp } from "../progress";
import { buildSteps } from "../steps";
import { speak } from "../tts";
import type { Profile, Word } from "../types";

interface Props {
  profile: Profile;
  perek: number;
  mishnah: number;
  onPractice: () => void;
  onReview: () => void;
  onBack: () => void;
}

export function MishnahScreen({ profile, perek, mishnah, onPractice, onReview, onBack }: Props) {
  const m = getMishnah(perek, mishnah);
  const steps = buildSteps(m.chunks);
  const st = mp(profile, perek, mishnah);
  const [word, setWord] = useState<Word | null>(null);
  const [showMeaning, setShowMeaning] = useState(true);
  const [showFull, setShowFull] = useState(false);

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
        <label><input type="checkbox" checked={showMeaning} onChange={(e) => setShowMeaning(e.target.checked)} /> Show meanings</label>
        <label><input type="checkbox" checked={showFull} onChange={(e) => setShowFull(e.target.checked)} /> Full English (Steinsaltz)</label>
      </div>
      <p className="hint" dir="ltr">Tap any word to see what it means.</p>
      <div className="study">
        {m.chunks.map((c, i) => (
          <div key={i} className="study-row">
            <CueCard he={c.he} cue={0} glossWords={c.words} onWordTap={setWord} />
            {profile.settings.tts && (
              <button className="btn ghost-btn small" onClick={() => speak(c.he)} aria-label="Play">🔊</button>
            )}
            {showMeaning && c.en && <div className="meaning" dir="ltr">{c.en}</div>}
          </div>
        ))}
      </div>
      {showFull && <div className="full-english" dir="ltr">{m.english}<div className="credit">Translation: Steinsaltz, William Davidson Edition (Sefaria, CC-BY-NC).</div></div>}
      <GlossSheet word={word} onClose={() => setWord(null)} />
    </div>
  );
}

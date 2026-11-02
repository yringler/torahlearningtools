import { useRef, useState } from "react";
import { CueCard } from "../components/CueCard";
import { GlossSheet } from "../components/GlossSheet";
import { LicensesLink } from "../components/Licenses";
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
  const fullBtn = useRef<HTMLButtonElement>(null);
  const fullParts: string[] = [m.stIntro ?? "", ...m.chunks.flatMap((c) => [c.st ?? "", c.stMore ?? ""])].filter(Boolean);
  const view = profile.settings.meaningView ?? "simple";

  const toggleFull = (open: boolean): void => {
    setShowFull(open);
    requestAnimationFrame(() =>
      fullBtn.current?.scrollIntoView({ behavior: "smooth", block: open ? "start" : "nearest" }),
    );
  };

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
      {fullParts.length > 0 && (
        <div className="full-st-wrap" dir="ltr">
          <button
            ref={fullBtn}
            type="button"
            className="btn secondary full-st-btn"
            aria-expanded={showFull}
            aria-controls="full-st"
            onClick={() => toggleFull(!showFull)}
          >
            {showFull ? "▲ Hide whole-mishnah explanation" : "📖 Read the whole mishnah (Steinsaltz)"}
          </button>
          {showFull && (
            <div id="full-st" className="full-st">
              {fullParts.map((h, i) => (
                <span key={i}><SteinsaltzText html={h} /> </span>
              ))}
              <div className="credit">
                {SOURCES.steinsaltz.detail} · <a href={SOURCES.steinsaltz.license.url} target="_blank" rel="noreferrer license">{SOURCES.steinsaltz.license.name}</a>
                {" · "}<LicensesLink className="credit-link" />
              </div>
              <button type="button" className="btn ghost-btn small" onClick={() => toggleFull(false)}>▲ Hide</button>
            </div>
          )}
        </div>
      )}
      <GlossSheet word={word} onClose={() => setWord(null)} />
    </div>
  );
}

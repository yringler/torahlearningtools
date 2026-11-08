import { useMemo, useRef, useState } from "react";
import { sefariaUrl, SOURCES } from "../sources";
import type { MeaningView, Mishnah } from "../types";
import { useWordCursor, wordAvail, wordOrdinal } from "../wordCursor";
import { CueCard } from "./CueCard";
import { LicensesLink } from "./Licenses";
import { useMasechta } from "./MasechtaGate";
import { Meaning, SteinsaltzText, ViewToggle } from "./Meaning";
import { WordPanel } from "./WordPanel";

/**
 * One mishnah to read and study: the meaning-view toggle, each piece with its tappable words and meaning, the
 * whole-mishnah Steinsaltz expander, and the sticky word panel. Changes no progress, so the learner's mishnah screen
 * and the library both use it. Takes the mishnah itself (not a key into the active masechta), so the library can show
 * text without making its masechta the active one; `useMasechta()` gives the masechta's names and sources.
 */
export function MishnahStudy({ m, perek, mishnah, view, onView }: {
  m: Mishnah; perek: number; mishnah: number; view: MeaningView; onView: (v: MeaningView) => void;
}) {
  const ms = useMasechta();
  const { translated } = ms;
  const [about, setAbout] = useState(false);
  const [hideMeaning, setHideMeaning] = useState(false);
  const [showFull, setShowFull] = useState(false);
  const fullBtn = useRef<HTMLButtonElement>(null);
  const fullParts: string[] = translated ? [m.stIntro ?? "", ...m.chunks.flatMap((c) => [c.st ?? "", c.stMore ?? ""])].filter(Boolean) : [];
  const avail = useMemo(() => wordAvail(m.chunks), [m]);
  const cur = useWordCursor(avail, true, true, m);
  const word = cur.sel ? (m.chunks[cur.sel.chunk]?.words[cur.sel.word] ?? null) : null;
  const ord = cur.sel ? wordOrdinal(avail, cur.sel, true) : { n: 0, total: 0 };

  const toggleFull = (open: boolean): void => {
    setShowFull(open);
    requestAnimationFrame(() =>
      fullBtn.current?.scrollIntoView({ behavior: "smooth", block: open ? "start" : "nearest" }),
    );
  };

  return (
    <>
      {translated ? (
        <>
          <div className="toggles" dir="ltr">
            <ViewToggle view={view} onChange={onView} allowHide hidden={hideMeaning} onHide={setHideMeaning} steinsaltz={ms.steinsaltz} />
          </div>
          <p className="hint" dir="ltr">Tap any word to see what it means, then tap another word or use Next.</p>
        </>
      ) : (
        <p className="hint" dir="ltr">
          Hebrew only: this masechta has no meanings in the app yet.
          <button className="info-btn" onClick={() => setAbout(true)} aria-label="About this text">ⓘ</button>
        </p>
      )}
      <div className="study">
        {m.chunks.map((c, i) => (
          <div key={i} className="study-row">
            <CueCard
              he={c.he}
              cue={0}
              {...(translated ? {
                glossWords: c.words,
                onWordTap: (_: unknown, w: number) => cur.tap(i, w),
                selectedIndex: cur.sel?.chunk === i ? cur.sel.word : undefined,
              } : {})}
            />
            {translated && !hideMeaning && c.en && <Meaning key={view} chunk={c} view={view} perek={perek} mishnah={mishnah} />}
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
      {about && (
        <div className="sheet-backdrop" onClick={() => setAbout(false)}>
          <div className="sheet source-sheet" dir="ltr" onClick={(e) => e.stopPropagation()}>
            <h3>About this text</h3>
            <p>The Hebrew text is Torat Emet, from Sefaria. This masechta doesn't have meanings in the app yet, so it shows only the Hebrew.</p>
            <a className="btn secondary" href={sefariaUrl(ms.sefaria, perek, mishnah)} target="_blank" rel="noreferrer">Open on Sefaria</a>
            <LicensesLink />
            <button className="btn ghost-btn" onClick={() => setAbout(false)}>Close</button>
          </div>
        </div>
      )}
      {translated && cur.sel && (
        <WordPanel
          word={word}
          n={ord.n}
          total={ord.total}
          onNext={cur.next}
          onPrev={cur.prev}
          canNext={cur.canNext}
          canPrev={cur.canPrev}
          onClose={cur.clear}
          sticky
        />
      )}
    </>
  );
}

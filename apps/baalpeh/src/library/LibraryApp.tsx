import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { MishnahStudy } from "../components/MishnahStudy";
import { TextSizeSheet } from "../components/TextSizeSheet";
import { Chevron } from "../components/WordPanel";
import { CATALOG, entryOf, hebNum, prefetchMasechta, SEDARIM } from "../data";
import { kv } from "../kv";
import { needsInternet } from "../nav";
import { useAvailable } from "../screens/Masechtos";
import type { Masechta, MeaningView } from "../types";
import { useNavigatorOnline } from "../useOnline";
import { LibraryGate } from "./LibraryGate";
import type { LibraryChild } from "./open";
import {
  libraryPath, loadLastPlace, loadScale, loadView, neighbourPerek, saveLastPlace, saveScale, saveView, type LibraryPlace, type ReadPlace,
} from "./location";

interface Props {
  /** Where to open (from the URL). */
  initial: LibraryPlace;
  /** "‹ Done": back to wherever the library was opened from. */
  onDone: () => void;
  /** Opened for a child: the child's place (`last`) is used and updated (`onPlace`) instead of the device's. */
  child?: LibraryChild;
  last?: ReadPlace | null;
  onPlace?: (place: ReadPlace) => void;
}

/**
 * The library: the whole Mishnah to read, with meanings, open to anyone. Seder → masechta → perakim → one mishnah per
 * page. It tracks no progress and never talks to the server; it remembers only the last mishnah read, the text size
 * and the meaning view, on this device (src/library/location.ts). See docs/LIBRARY.md.
 */
export default function LibraryApp({ initial, onDone, child, last: childLast, onPlace }: Props) {
  const [place, setPlace] = useState<LibraryPlace>(initial);
  const [scale, setScaleState] = useState(() => loadScale(kv));
  const [view, setViewState] = useState<MeaningView>(() => loadView(kv));
  const [last, setLast] = useState<ReadPlace | null>(() => (child ? childLast ?? null : loadLastPlace(kv)));

  // The address bar always names the place (shareable); moves inside the library don't pile up browser history.
  useEffect(() => {
    const path = libraryPath(place);
    if (window.location.pathname !== path) window.history.replaceState(window.history.state, "", path);
    window.scrollTo(0, 0);
    if (place.v === "read") {
      const r: ReadPlace = { m: place.m, perek: place.perek, mishnah: place.mishnah ?? 1 };
      if (child) onPlace?.(r);
      else saveLastPlace(kv, r);
      setLast(r);
    }
  }, [place]); // eslint-disable-line react-hooks/exhaustive-deps

  // The library's own text size; whatever the screen underneath had comes back on leaving.
  useEffect(() => {
    const root = document.documentElement.style;
    const before = root.getPropertyValue("--scale");
    return () => { if (before) root.setProperty("--scale", before); else root.removeProperty("--scale"); };
  }, []);
  useEffect(() => { document.documentElement.style.setProperty("--scale", String(scale)); }, [scale]);

  const lastM = last?.m;
  useEffect(() => { if (lastM) prefetchMasechta(lastM).catch(() => undefined); }, [lastM]);

  const setScale = (s: number) => { setScaleState(s); saveScale(kv, s); };
  const setView = (v: MeaningView) => { setViewState(v); saveView(kv, v); };
  const sederOfM = (m: string) => entryOf(m)?.seder ?? SEDARIM[0]?.id ?? "";

  return <ChildCtx.Provider value={child}>{screen()}</ChildCtx.Provider>;

  function screen(): React.ReactNode {
  switch (place.v) {
    case "home":
      return <LibraryHome last={last} onDone={onDone} onContinue={(r) => setPlace({ v: "read", ...r })} onSeder={(seder) => setPlace({ v: "seder", seder })} />;
    case "seder":
      return <SederMasechtos seder={place.seder} last={lastM} onBack={() => setPlace({ v: "home" })} onPick={(m) => setPlace({ v: "masechta", m })} />;
    case "masechta": {
      const { m } = place;
      return (
        <LibraryGate key={m} id={m} onChooseOther={() => setPlace({ v: "seder", seder: sederOfM(m) })}>
          {() => <Perakim m={m} last={last} onBack={() => setPlace({ v: "seder", seder: sederOfM(m) })}
            onOpen={(perek, mishnah) => setPlace({ v: "read", m, perek, mishnah })} />}
        </LibraryGate>
      );
    }
    case "read": {
      const { m, perek } = place;
      const mishnah = place.mishnah ?? 1;
      return (
        <LibraryGate key={m} id={m} onChooseOther={() => setPlace({ v: "seder", seder: sederOfM(m) })}>
          {(text) => (
            <Reader text={text} m={m} perek={perek} mishnah={mishnah} view={view} onView={setView} scale={scale} onScale={setScale}
              onBack={() => setPlace({ v: "masechta", m })} onHome={() => setPlace({ v: "home" })}
              onGo={(p, n) => setPlace({ v: "read", m, perek: p, mishnah: n })}
              onOtherMasechta={() => setPlace({ v: "seder", seder: sederOfM(m) })} />
          )}
        </LibraryGate>
      );
    }
  }
  }
}

/** The child the library was opened for, named in every top bar. */
const ChildCtx = createContext<LibraryChild | undefined>(undefined);

function TopBar({ back, onBack, right }: { back: string; onBack: () => void; right?: React.ReactNode }) {
  const child = useContext(ChildCtx);
  return (
    <div className="topbar" dir="ltr">
      <button className="btn ghost-btn small" onClick={onBack}>{back}</button>
      <span className="who">{child && <span style={{ color: child.color }}>{child.emoji} {child.name} · </span>}📚 Library</span>
      {right ?? <span />}
    </div>
  );
}

/** "מסכת ברכות · פרק ב׳ · משנה ג׳" */
const placeHe = (r: ReadPlace): string => `מסכת ${entryOf(r.m)?.he ?? ""} · פרק ${hebNum(r.perek)} · משנה ${hebNum(r.mishnah ?? 1)}`;

export const LIBRARY_COPY = {
  footer: "Nothing here is saved to anyone's progress. Read anything, anytime.",
} as const;

function LibraryHome({ last, onDone, onContinue, onSeder }: {
  last: ReadPlace | null; onDone: () => void; onContinue: (r: ReadPlace) => void; onSeder: (seder: string) => void;
}) {
  return (
    <div className="masechtos library">
      <TopBar back="‹ Done" onBack={onDone} />
      {last && (
        <button className="btn primary huge" dir="ltr" onClick={() => onContinue(last)}>
          ▶ Continue reading
          <span className="sub" dir="rtl" lang="he">{placeHe(last)}</span>
        </button>
      )}
      <h2 className="masechta">ששה סדרי משנה</h2>
      <p className="hint center" dir="ltr">Choose a seder</p>
      <div className="profile-grid">
        {SEDARIM.map((s) => (
          <button key={s.id} className={`profile-tile masechta-tile${last && entryOf(last.m)?.seder === s.id ? " current" : ""}`}
            aria-label={`Seder ${s.en}, ${s.masechtos.length} masechtos`} onClick={() => onSeder(s.id)}>
            <span className="tile-he" dir="rtl" lang="he">סדר {s.he}</span>
            <span className="sub" dir="ltr">{s.en} · {s.masechtos.length} masechtos</span>
          </button>
        ))}
      </div>
      <p className="hint center" dir="ltr">{LIBRARY_COPY.footer}</p>
    </div>
  );
}

function SederMasechtos({ seder, last, onBack, onPick }: { seder: string; last: string | undefined; onBack: () => void; onPick: (m: string) => void }) {
  const s = SEDARIM.find((x) => x.id === seder);
  const list = CATALOG.filter((e) => e.seder === seder);
  const online = useNavigatorOnline();
  const avail = useAvailable(list.map((e) => e.id));
  return (
    <div className="masechtos library">
      <TopBar back="‹ Sedarim" onBack={onBack} />
      <h2 className="masechta">סדר {s?.he ?? ""}</h2>
      <p className="hint center" dir="ltr">Choose a masechta</p>
      <div className="profile-grid">
        {list.map((e) => {
          const perakim = e.perakim.length;
          return (
            <button key={e.id} className={`profile-tile masechta-tile${e.id === last ? " current" : ""}`}
              aria-label={`Masechta ${e.en}, ${perakim} perakim${e.translated ? "" : ", Hebrew only"}`} onClick={() => onPick(e.id)}>
              <span className="tile-he" dir="rtl" lang="he">מסכת {e.he}</span>
              <span className="sub" dir="ltr">{e.en}</span>
              <span className="tile-progress" dir="ltr">{perakim} {perakim === 1 ? "perek" : "perakim"}</span>
              {!e.translated && <span className="chip" dir="ltr">Hebrew only</span>}
              {needsInternet(online, avail.has(e.id)) && <span className="sub" dir="ltr">needs internet</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** Every perek of the masechta, each with a circle per mishnah: the way to jump anywhere. */
export function Perakim({ m, last, onBack, onOpen }: { m: string; last: ReadPlace | null; onBack: () => void; onOpen: (perek: number, mishnah: number) => void }) {
  const e = entryOf(m);
  if (!e) return null;
  return (
    <div className="home library">
      <TopBar back="‹ Masechtos" onBack={onBack} />
      <h2 className="masechta">מסכת {e.he}</h2>
      {!e.translated && <p className="hint center" dir="ltr">Hebrew only: this masechta has no meanings in the app yet.</p>}
      <div className="perek-map">
        {e.perakim.map((size, i) => {
          const perek = i + 1;
          return (
            <div key={perek} className="perek-row lib-perek">
              <button className="perek-head" onClick={() => onOpen(perek, 1)} aria-label={`Perek ${perek}, ${size} mishnayos, read from the start`}>
                <span className="perek-label">פרק {hebNum(perek)}</span>
                <span className="chev" aria-hidden="true">›</span>
              </button>
              <div className="lib-strip">
                {Array.from({ length: size }, (_, j) => j + 1).map((n) => {
                  const here = last?.m === m && last.perek === perek && (last.mishnah ?? 1) === n;
                  return (
                    <button key={n} className={`circle${here ? " lib-here" : ""}`} onClick={() => onOpen(perek, n)}
                      aria-label={`Mishnah ${perek}:${n}${here ? ", where you stopped" : ""}`}>
                      {hebNum(n).replace("׳", "")}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** One mishnah, with Next / Back across perakim. */
export function Reader({ text, m, perek, mishnah, view, onView, scale, onScale, onBack, onHome, onGo, onOtherMasechta }: {
  text: Masechta; m: string; perek: number; mishnah: number; view: MeaningView; onView: (v: MeaningView) => void;
  scale: number; onScale: (s: number) => void; onBack: () => void; onHome: () => void;
  onGo: (perek: number, mishnah: number) => void; onOtherMasechta: () => void;
}) {
  const [sizing, setSizing] = useState(false);
  const e = entryOf(m);
  const mish = useMemo(() => text.mishnayos.find((x) => x.perek === perek && x.mishnah === mishnah), [text, perek, mishnah]);
  if (!e || !mish) {
    return (
      <div className="mishnah-screen library">
        <TopBar back="‹ Perakim" onBack={onBack} />
        <p className="hint center" dir="ltr">This mishnah isn't here. <button className="link-btn" onClick={onHome}>Library home</button></p>
      </div>
    );
  }
  const size = e.perakim[perek - 1] ?? 0;
  const nextPerek = neighbourPerek(m, perek, 1);
  const prevPerek = neighbourPerek(m, perek, -1);
  const next = mishnah < size ? { p: perek, n: mishnah + 1, label: "Next" }
    : nextPerek !== null ? { p: nextPerek, n: 1, label: `Perek ${hebNum(nextPerek)}` } : null;
  const prev = mishnah > 1 ? { p: perek, n: mishnah - 1, label: "Back" }
    : prevPerek !== null ? { p: prevPerek, n: e.perakim[prevPerek - 1] ?? 1, label: `Perek ${hebNum(prevPerek)}` } : null;

  return (
    <div className="mishnah-screen library">
      <TopBar back="‹ Perakim" onBack={onBack}
        right={<button className="btn ghost-btn small" onClick={() => setSizing(true)} aria-label="Text size">Aa</button>} />
      <h2 className="task-title">{e.he} {hebNum(perek)}:{hebNum(mishnah)}</h2>
      {e.translated && mish.summary && <p className="summary" dir="ltr">{mish.summary}</p>}
      <MishnahStudy key={`${perek}:${mishnah}`} m={mish} perek={perek} mishnah={mishnah} view={view} onView={onView} />
      <div className="pager lib-pager" dir="ltr">
        {next ? (
          <button className="btn primary btn-next" onClick={() => onGo(next.p, next.n)}>
            <Chevron dir="left" className="btn-next-arrow" /><span>{next.label}</span>
          </button>
        ) : <span />}
        <span className="pager-count">Mishnah {mishnah} of {size}</span>
        {prev ? (
          <button className="btn secondary" onClick={() => onGo(prev.p, prev.n)}>
            <span>{prev.label}</span><Chevron dir="right" className="btn-next-arrow" />
          </button>
        ) : <span />}
      </div>
      {!next && (
        <button className="finished-link" dir="ltr" onClick={onOtherMasechta}>
          🎉 You finished reading <bdi dir="rtl">מסכת {e.he}</bdi>! Choose another ›
        </button>
      )}
      {sizing && <TextSizeSheet sample={mish.chunks[0]?.he ?? ""} scale={scale} onChange={onScale} onClose={() => setSizing(false)} />}
    </div>
  );
}

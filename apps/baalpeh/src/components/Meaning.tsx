import { useState } from "react";
import { MASECHTA } from "../data";
import { sefariaUrl, SOURCES } from "../sources";
import type { Chunk, MeaningView, Source } from "../types";

/** Render Steinsaltz markup: <b>translation</b> bold, the rest as lighter explanation. No raw HTML injection. */
export function SteinsaltzText({ html }: { html: string }) {
  const parts = html.split(/(<b>.*?<\/b>)/s).filter(Boolean);
  return (
    <>
      {parts.map((p, i) =>
        p.startsWith("<b>") ? <b key={i}>{p.slice(3, -4)}</b> : <span key={i} className="st-explain">{p}</span>,
      )}
    </>
  );
}

interface Props {
  chunk: Chunk;
  view: MeaningView;
  perek: number;
  mishnah: number;
  /** Offer the "more" expander for Steinsaltz's longer explanation. */
  allowMore?: boolean;
}

/** One chunk's meaning in the chosen view, with a quiet ⓘ that names the sources (no footnotes). */
export function Meaning({ chunk, view, perek, mishnah, allowMore = true }: Props) {
  const [more, setMore] = useState(false);
  const [info, setInfo] = useState(false);
  const basis: Source[] = chunk.basis ?? ["steinsaltz"];
  const useSt = view === "steinsaltz" && chunk.st;

  return (
    <div className={`meaning ${useSt ? "steinsaltz" : "simple"}`} dir="ltr">
      {useSt ? (
        <>
          <SteinsaltzText html={chunk.st ?? ""} />
          {allowMore && chunk.stMore && (
            more ? <> <SteinsaltzText html={chunk.stMore} /></> : (
              <button className="more-btn" onClick={() => setMore(true)} aria-label="Show more explanation">more…</button>
            )
          )}
        </>
      ) : (
        <>
          {chunk.en}
          {chunk.explain && <span className="explain"> {chunk.explain}</span>}
        </>
      )}
      <button className="info-btn" onClick={() => setInfo(true)} aria-label="Where this meaning comes from">ⓘ</button>
      {info && (
        <div className="sheet-backdrop" onClick={() => setInfo(false)}>
          <div className="sheet source-sheet" onClick={(e) => e.stopPropagation()}>
            <h3>Where this meaning comes from</h3>
            {useSt ? (
              <p>Quoted word for word from <b>{SOURCES.steinsaltz.name}</b>. <b>Bold</b> is his translation of the Mishnah; the lighter text is his explanation.</p>
            ) : (
              <p>A simplified version of {basis.map((b, i) => <span key={b}>{i > 0 && " and "}<b>{SOURCES[b].name}</b></span>)}.</p>
            )}
            {chunk.basisNote && <p className="hint">{chunk.basisNote}</p>}
            <ul className="source-list">
              {(useSt ? (["steinsaltz"] as Source[]) : basis).map((b) => <li key={b}>{SOURCES[b].detail}</li>)}
            </ul>
            <a className="btn secondary" href={sefariaUrl(MASECHTA.masechtaEn, perek, mishnah)} target="_blank" rel="noreferrer">
              Open on Sefaria
            </a>
            <button className="btn ghost-btn" onClick={() => setInfo(false)}>Close</button>
          </div>
        </div>
      )}
    </div>
  );
}

export function ViewToggle({ view, onChange, allowHide, hidden, onHide }: {
  view: MeaningView; onChange: (v: MeaningView) => void;
  allowHide?: boolean; hidden?: boolean; onHide?: (h: boolean) => void;
}) {
  return (
    <div className="seg" dir="ltr" role="group" aria-label="Meaning view">
      <button className={!hidden && view === "simple" ? "on" : ""} onClick={() => { onHide?.(false); onChange("simple"); }}>Simple</button>
      <button className={!hidden && view === "steinsaltz" ? "on" : ""} onClick={() => { onHide?.(false); onChange("steinsaltz"); }}>Steinsaltz</button>
      {allowHide && <button className={hidden ? "on" : ""} onClick={() => onHide?.(true)}>Hide</button>}
    </div>
  );
}

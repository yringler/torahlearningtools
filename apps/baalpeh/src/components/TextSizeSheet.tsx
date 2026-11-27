import { useState } from "react";

/** The "Aa" sheet: a text-size slider (0.8–1.6) with a live Hebrew sample. */
export function TextSizeSheet({ sample, scale, onChange, onClose }: {
  sample: string; scale: number; onChange: (s: number) => void; onClose: () => void;
}) {
  const [v, setV] = useState(scale);
  return (
    <div className="sheet-backdrop" role="dialog" aria-modal="true" aria-labelledby="ts-title" onClick={onClose}>
      <div className="sheet" dir="ltr" onClick={(e) => e.stopPropagation()}>
        <h3 id="ts-title">Text size</h3>
        <input type="range" min={0.8} max={1.6} step={0.1} value={v} aria-label="Text size"
          onChange={(e) => { const n = Number(e.target.value); setV(n); onChange(n); }} />
        <p className="ts-sample" dir="rtl" lang="he" style={{ fontSize: `calc(1.8rem * ${v})` }}>{sample}</p>
        <button className="btn primary" onClick={onClose}>Done</button>
      </div>
    </div>
  );
}

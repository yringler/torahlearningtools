import { useState } from "react";
import { importDefaults } from "../legacy/import";
import { isKnown } from "../progress";
import type { Profile } from "../types";

interface Props {
  legacy: Profile[];
  existing: Profile[];
  onImport: (selected: Profile[]) => void;
  onLater: () => void;
  onNever: () => void;
}

/** §9.6: offer to move pre-account progress on this device into the account. */
export function ImportPrompt({ legacy, existing, onImport, onLater, onNever }: Props) {
  const [checked, setChecked] = useState(() => importDefaults(legacy, existing));
  const names = new Set(existing.map((p) => p.name.trim().toLocaleLowerCase()));
  const selected = legacy.filter((p) => checked[p.id]);
  return (
    <div className="sheet-backdrop" role="dialog" aria-modal="true" aria-labelledby="import-title">
      <div className="sheet import-sheet" dir="ltr">
        <h3 id="import-title">This device has progress saved without an account:</h3>
        <ul className="import-list">
          {legacy.map((p) => {
            const all = Object.values(p.mishnayos ?? {});
            const known = all.filter(isKnown).length;
            const started = all.filter((m) => !isKnown(m) && m.stepIndex > 0).length;
            return (
              <li key={p.id}>
                <label>
                  <input type="checkbox" checked={checked[p.id] ?? false}
                    onChange={(e) => setChecked((c) => ({ ...c, [p.id]: e.target.checked }))} />
                  <span>{p.emoji} <b>{p.name}</b> · {known} mishnayos known{started > 0 ? `, ${started} started` : ""}</span>
                  {names.has(p.name.trim().toLocaleLowerCase()) && <span className="hint"> (already in your account?)</span>}
                </label>
              </li>
            );
          })}
        </ul>
        <button className="btn primary" disabled={selected.length === 0} onClick={() => onImport(selected)}>Add to my account</button>
        <div className="row center">
          <button className="btn ghost-btn small" onClick={onLater}>Not now</button>
          <button className="btn ghost-btn small" onClick={onNever}>Don't ask again</button>
        </div>
      </div>
    </div>
  );
}

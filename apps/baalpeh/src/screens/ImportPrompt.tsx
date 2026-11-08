import { useState } from "react";
import { importDefaults } from "../legacy/import";
import { IMPORT_TEST_NOTE } from "../perekTest";
import { progressSummary } from "../nav";
import type { Profile } from "../types";

interface Props {
  legacy: Profile[];
  existing: Profile[];
  onImport: (selected: Profile[]) => void;
  onLater?: () => void;
  onNever?: () => void;
  /** Parent mode: a section of the Children tab, not a prompt (no "Not now" / "Don't ask again"). */
  inline?: boolean;
}

/**
 * §9.6: offer to move pre-account progress on this device into the account. Shown only while the account has no
 * children (docs/PARENT_VERIFICATION.md §9); imported children arrive with no verified perakim.
 */
export function ImportPrompt({ legacy, existing, onImport, onLater, onNever, inline }: Props) {
  const [checked, setChecked] = useState(() => importDefaults(legacy, existing));
  const names = new Set(existing.map((p) => p.name.trim().toLocaleLowerCase()));
  const selected = legacy.filter((p) => checked[p.id]);
  const body = (
    <>
        <h3 id="import-title">{inline ? "Move from this device" : "This device has progress saved without an account:"}</h3>
        {inline && <p className="hint">This device has progress saved without an account (from guest mode or before accounts):</p>}
        <ul className="import-list">
          {legacy.map((p) => {
            return (
              <li key={p.id}>
                <label>
                  <input type="checkbox" checked={checked[p.id] ?? false}
                    onChange={(e) => setChecked((c) => ({ ...c, [p.id]: e.target.checked }))} />
                  <span>{p.emoji} <b>{p.name}</b> · {progressSummary(p)}</span>
                  {names.has(p.name.trim().toLocaleLowerCase()) && <span className="hint"> (already in your account?)</span>}
                </label>
              </li>
            );
          })}
        </ul>
        <p className="hint">{IMPORT_TEST_NOTE}</p>
        <button className="btn primary" disabled={selected.length === 0} onClick={() => onImport(selected)}>{inline ? "Move" : "Add to my account"}</button>
        {!inline && (
          <div className="row center">
            <button className="btn ghost-btn small" onClick={onLater}>Not now</button>
            <button className="btn ghost-btn small" onClick={onNever}>Don't ask again</button>
          </div>
        )}
    </>
  );
  if (inline) return <section className="card-section import-inline" aria-labelledby="import-title">{body}</section>;
  return (
    <div className="sheet-backdrop" role="dialog" aria-modal="true" aria-labelledby="import-title">
      <div className="sheet import-sheet" dir="ltr">{body}</div>
    </div>
  );
}

import { useState } from "react";
import { MASECHTA, mishnayosOf, PERAKIM } from "../data";
import { dueReviews, isKnown, mp, pp, resetMishnah } from "../progress";
import { EMOJIS, isAppState, newProfile } from "../storage";
import type { AppState, Profile } from "../types";

interface Props {
  state: AppState;
  onState: (s: AppState) => void;
  onBack: () => void;
}

export function Parent({ state, onState, onBack }: Props) {
  const [name, setName] = useState("");
  const [msg, setMsg] = useState("");

  const update = (p: Profile) => onState({ ...state, profiles: state.profiles.map((x) => (x.id === p.id ? p : x)) });

  const add = () => {
    const n = name.trim();
    if (!n) return;
    onState({ ...state, profiles: [...state.profiles, newProfile(n, state.profiles.length)] });
    setName("");
  };

  const exportJson = () => {
    const blob = new Blob([JSON.stringify(state, null, 1)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `baalpeh-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const importJson = async (f: File | undefined) => {
    if (!f) return;
    try {
      const parsed: unknown = JSON.parse(await f.text());
      if (!isAppState(parsed)) throw new Error("bad file");
      if (confirm("Replace all progress on this device with the backup?")) {
        onState(parsed);
        setMsg("Backup restored.");
      }
    } catch {
      setMsg("That file isn't a Ba'al Peh backup.");
    }
  };

  return (
    <div className="parent" dir="ltr">
      <div className="topbar">
        <button className="btn ghost-btn small" onClick={onBack}>‹ Back</button>
        <span className="who">Parent area</span>
      </div>

      <section>
        <h3>Children</h3>
        {state.profiles.map((p) => <ChildCard key={p.id} p={p} onChange={update}
          onDelete={() => confirm(`Delete ${p.name} and all their progress?`) && onState({ ...state, profiles: state.profiles.filter((x) => x.id !== p.id) })} />)}
        <div className="row">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Child's name" onKeyDown={(e) => e.key === "Enter" && add()} />
          <button className="btn primary" onClick={add}>Add child</button>
        </div>
      </section>

      <section>
        <h3>Backup</h3>
        <p className="hint">Progress lives only on this device. On iPad/iPhone, add this page to the Home Screen so Safari doesn't clear it, and export a backup now and then.</p>
        <div className="row">
          <button className="btn secondary" onClick={exportJson}>⬇ Export backup</button>
          <label className="btn secondary">⬆ Import backup<input type="file" accept="application/json" hidden onChange={(e) => void importJson(e.target.files?.[0])} /></label>
        </div>
        {msg && <p>{msg}</p>}
      </section>

      <section>
        <h3>How it works</h3>
        <ul className="hint">
          <li>Each mishnah is cut into small pieces. The child learns piece 1, piece 2, then 1+2 together, piece 3, then 1–3… Long mishnayos are learned in parts, then the parts are joined.</li>
          <li>Hints fade: full text → first letters → first word → nothing. Tapping a hidden card is a "peek", and peeks are counted automatically.</li>
          <li>At the end of each mishnah, and for each "mishnayos 1–k in a row" chain, you listen and grade. A perek is done when it's said in one shot.</li>
          <li>Learned mishnayos come back for review after 1, 3, 7, 14, 30 and 60 days. A finished perek is reviewed as a whole.</li>
          <li>Hebrew text: Torat Emet via Sefaria. Meanings come in two views. <b>Steinsaltz</b> is quoted word for word from the Koren Noé / William Davidson translation (bold = translation, light = explanation). <b>Simple</b> is an AI simplification of Steinsaltz, checked against Bartenura (tr. R. Shraga Silverstein). Tap ⓘ by any meaning to see its source. Please check anything that looks off.</li>
        </ul>
      </section>
    </div>
  );
}

function ChildCard({ p, onChange, onDelete }: { p: Profile; onChange: (p: Profile) => void; onDelete: () => void }) {
  const [open, setOpen] = useState(false);
  const known = Object.values(p.mishnayos).filter(isKnown).length;
  const total = MASECHTA.mishnayos.length;
  const perakimDone = PERAKIM.filter((x) => pp(p, x).complete).length;
  const set = <K extends keyof Profile["settings"]>(k: K, v: Profile["settings"][K]) => onChange({ ...p, settings: { ...p.settings, [k]: v } });
  return (
    <div className="child-card" style={{ borderColor: p.color }}>
      <div className="row between">
        <b style={{ color: p.color }}>{p.emoji} {p.name}</b>
        <span>{known}/{total} mishnayos · {perakimDone} perakim · {dueReviews(p).length} due</span>
        <button className="btn ghost-btn small" onClick={() => setOpen(!open)}>{open ? "Close" : "Settings"}</button>
      </div>
      {open && (
        <div className="child-settings">
          <label>Name <input value={p.name} onChange={(e) => onChange({ ...p, name: e.target.value })} /></label>
          <label>Picture
            <select value={p.emoji} onChange={(e) => onChange({ ...p, emoji: e.target.value })}>
              {EMOJIS.map((e) => <option key={e}>{e}</option>)}
            </select>
          </label>
          <label>Text size <input type="range" min={0.8} max={1.6} step={0.1} value={p.settings.fontScale} onChange={(e) => set("fontScale", Number(e.target.value))} /></label>
          <label>Session minutes <input type="number" min={5} max={60} value={p.settings.dailyMinutes} onChange={(e) => set("dailyMinutes", Number(e.target.value) || 15)} /></label>
          <label>Meanings while learning
            <select value={p.settings.meaningView ?? "simple"} onChange={(e) => set("meaningView", e.target.value === "steinsaltz" ? "steinsaltz" : "simple")}>
              <option value="simple">Simple (for young readers)</option>
              <option value="steinsaltz">Steinsaltz (bold translation + explanation)</option>
            </select>
          </label>
          <label><input type="checkbox" checked={p.settings.tts} onChange={(e) => set("tts", e.target.checked)} /> 🔊 Read-aloud (approximate: Israeli pronunciation, may skip nikud)</label>
          <details>
            <summary>Reset a mishnah</summary>
            {PERAKIM.map((perek) => (
              <div key={perek} className="row wrap">
                <span>Perek {perek}:</span>
                {mishnayosOf(perek).map((m) => (
                  <button key={m.mishnah} className={`btn small ${mp(p, perek, m.mishnah).state}`}
                    onClick={() => confirm(`Reset ${perek}:${m.mishnah}?`) && onChange(resetMishnah(p, perek, m.mishnah))}>
                    {m.mishnah}
                  </button>
                ))}
              </div>
            ))}
          </details>
          <button className="btn ghost-btn danger" onClick={onDelete}>Delete {p.name}</button>
        </div>
      )}
    </div>
  );
}

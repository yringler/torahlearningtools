import { useEffect, useRef, useState } from "react";
import type { LearningEventBody, Ms } from "../../shared/api";
import { BreakSetting } from "../components/BreakSetting";
import { ConfirmSheet } from "../components/ConfirmSheet";
import { CATALOG, hebNum, perakimOf, perekSize, shapeOf, type MasechtaShape } from "../data";
import { lastMasechtaOf, masechtaEn } from "../nav";
import { agoText, liveTest } from "../perekTest";
import { frontier, isKnown, mp, perekLearned, perekPhase, resetMishnah, resetPerek, type Verified } from "../progress";
import { ChildHistory } from "../screens/ChildHistory";
import { EMOJIS } from "../storage";
import { perekHe } from "./log";
import type { LastTest } from "../sync/store";
import type { Profile } from "../types";

export interface ChildDetailProps {
  profile: Profile;
  /** The perakim a parent verified, per masechta. */
  verifiedOf: (masechta: string) => Verified;
  verifiedAt: (masechta: string, perek: number) => Ms | null;
  /** This device's learner store's last test request for this child, if any. */
  lastTest: LastTest | undefined;
  now: Ms;
  online: boolean;
  /** Saves a changed child (plus events) through the parent sync. */
  save: (p: Profile, events?: LearningEventBody[]) => void;
  remove: () => void;
  setVerified: (masechta: string, perakim: number[], verified: boolean) => Promise<void>;
  onBack: () => void;
  toast: (msg: string) => void;
  tab: ChildTab;
  onTab: (t: ChildTab) => void;
}

export type ChildTab = "perakim" | "activity" | "settings";

const dateText = (ms: number) => new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });

/** The status chip of one perek in parent mode (docs/PARENT_MODE.md §9.7). */
export function perekChip(
  p: Profile, ms: MasechtaShape, o: { verified: Verified; verifiedAt: (perek: number) => Ms | null; lastTest: LastTest | undefined; now: Ms }, perek: number,
): string {
  const phase = perekPhase(p, ms, o.verified, perek);
  if (phase === "verified") {
    const at = o.verifiedAt(perek);
    return at !== null ? `✔ Verified ${dateText(at)}` : "✔ Verified";
  }
  if (phase === "locked") return `🔒 Opens after ${perekHe(frontier(ms, o.verified) ?? perek)}`;
  if (phase === "test") {
    const sent = liveTest(o.lastTest, ms.id, perek, o.now);
    return sent ? `📬 Test email sent ${agoText(sent.sentAt, o.now)}` : "🙋 Learned, ready for a test";
  }
  const nums = Array.from({ length: perekSize(ms, perek) }, (_, i) => i + 1);
  const known = nums.filter((m) => isKnown(mp(p, ms, perek, m))).length;
  const started = nums.some((m) => mp(p, ms, perek, m).stepIndex > 0 || mp(p, ms, perek, m).state !== "new");
  return known === 0 && !started ? "Not started" : `In progress ${known}/${nums.length} mishnayos`;
}

/** The practice-log events of a parent's reset of these mishnayos (each names its masechta). */
export const resetEvents = (masechta: string, perek: number, mishnayos: number[]): LearningEventBody[] =>
  mishnayos.map((mishnah) => ({ type: "reset", perek, mishnah, masechta }));

/** One mishnah's line in an expanded perek. */
export function mishnahLine(p: Profile, ms: MasechtaShape, perek: number, mishnah: number): { text: string; resettable: boolean } {
  const m = mp(p, ms, perek, mishnah);
  const due = m.review ? new Date(`${m.review.due}T12:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : null;
  if (isKnown(m)) return { text: `Known${due ? ` · review ${due}` : ""}`, resettable: true };
  if (m.state === "learning" || m.stepIndex > 0) return { text: "Learning", resettable: true };
  return { text: "Not started", resettable: false };
}

type Sheet =
  | { k: "verify"; perek: number }
  | { k: "unverify"; perek: number }
  | { k: "resetPerek"; perek: number }
  | { k: "notKnown"; perek: number; mishnah: number }
  | { k: "remove" };

export function ChildDetail(props: ChildDetailProps) {
  const { profile: p, tab } = props;
  /** The masechta whose perakim are shown (the child's last one at first). */
  const [masechta, setMasechta] = useState(() => lastMasechtaOf(p));
  const ms = shapeOf(masechta);
  const v = props.verifiedOf(masechta);
  const chipOpts = { verified: v, verifiedAt: (perek: number) => props.verifiedAt(masechta, perek), lastTest: props.lastTest, now: props.now };
  const name = masechtaEn(masechta);
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [menu, setMenu] = useState<number | null>(null);
  const [open, setOpen] = useState<Set<number>>(() => new Set());
  const done = () => props.toast(`Done. ${p.name}'s devices will update when they're online.`);
  const toggle = (perek: number) => setOpen((s) => { const n = new Set(s); if (n.has(perek)) n.delete(perek); else n.add(perek); return n; });

  const f = frontier(ms, v);
  const heb = (perek: number) => <bdi dir="rtl">פרק {hebNum(perek)}</bdi>;
  const mishnayosIn = (perek: number): number[] => Array.from({ length: perekSize(ms, perek) }, (_, i) => i + 1);

  let sheetEl: JSX.Element | null = null;
  if (sheet?.k === "verify") {
    const perek = sheet.perek;
    sheetEl = (
      <ConfirmSheet title={`Mark ${name} ${perekHe(perek)} as verified for ${p.name}?`} action="✔ Mark verified" onCancel={() => setSheet(null)}
        onAct={async () => { await props.setVerified(masechta, [perek], true); setSheet(null); done(); }}>
        <p>Use this when you've heard {p.name} say the whole perek yourself. The next perek opens on {p.name}'s devices the next time they're online.</p>
        {!perekLearned(p, ms, perek) && <p className="hint">{p.name} hasn't finished learning this perek in the app yet.</p>}
        {f !== null && f < perek && <p className="hint">{perekHe(f)} isn't verified yet, so perakim after it stay locked.</p>}
      </ConfirmSheet>
    );
  } else if (sheet?.k === "unverify") {
    const perek = sheet.perek;
    sheetEl = (
      <ConfirmSheet title={`Remove the verification of ${name} ${perekHe(perek)}?`} action="Remove verification" danger onCancel={() => setSheet(null)}
        onAct={async () => { await props.setVerified(masechta, [perek], false); setSheet(null); done(); }}>
        <p>Perakim after it lock again until you verify it, here or with a test email. {p.name}'s progress isn't changed. Old test emails for this perek stop working.</p>
      </ConfirmSheet>
    );
  } else if (sheet?.k === "resetPerek") {
    const perek = sheet.perek;
    const n = perekSize(ms, perek);
    sheetEl = (
      <ConfirmSheet title={`Reset all of ${name} ${perekHe(perek)} for ${p.name}?`} action="Reset perek" danger onCancel={() => setSheet(null)}
        onAct={() => {
          props.save(resetPerek(p, ms, perek), resetEvents(masechta, perek, mishnayosIn(perek)));
          setSheet(null);
          done();
        }}>
        <p>All {n} mishnayos and the whole-perek steps start over.</p>
        {v.has(perek) && <p className="hint">The verification stays. Remove it separately if you want.</p>}
      </ConfirmSheet>
    );
  } else if (sheet?.k === "notKnown") {
    const { perek, mishnah } = sheet;
    sheetEl = (
      <ConfirmSheet title={`Mark ${name} ${perek}:${mishnah} as not known for ${p.name}?`} action="Mark not known" danger onCancel={() => setSheet(null)}
        onAct={() => {
          props.save(resetMishnah(p, ms, perek, mishnah), resetEvents(masechta, perek, [mishnah]));
          setSheet(null);
          done();
        }}>
        <p>{p.name} will learn it again from the first piece, and its review schedule starts over. This reaches {p.name}'s devices the next time they're online.</p>
      </ConfirmSheet>
    );
  } else if (sheet?.k === "remove") {
    sheetEl = <RemoveSheet name={p.name} onCancel={() => setSheet(null)} onRemove={() => { setSheet(null); props.remove(); }} />;
  }

  return (
    <div className="child-detail">
      <div className="topbar">
        <button className="btn ghost-btn small" onClick={props.onBack}>‹ Children</button>
        <span className="who" style={{ color: p.color }}>{p.emoji} {p.name}</span>
      </div>
      <div className="segmented" role="tablist" aria-label={`${p.name}`}>
        {(["perakim", "activity", "settings"] as const).map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? "on" : ""} onClick={() => props.onTab(t)}>
            {t === "perakim" ? "Perakim" : t === "activity" ? "Activity" : "Settings"}
          </button>
        ))}
      </div>

      {tab === "perakim" && (
        <label className="field masechta-pick">
          <span>Masechta</span>
          <select value={masechta} onChange={(e) => { setMasechta(e.target.value); setMenu(null); setOpen(new Set()); }}>
            {CATALOG.map((e) => <option key={e.id} value={e.id}>{e.en} ({e.he}){e.translated ? "" : " · Hebrew only"}</option>)}
          </select>
        </label>
      )}
      {tab === "perakim" && (
        <ul className="perek-list">
          {perakimOf(ms).map((perek) => {
            const isV = v.has(perek);
            const chip = perekChip(p, ms, chipOpts, perek);
            return (
              <li key={perek} className="perek-item">
                <div className="perek-item-head">
                  <button className="perek-item-title" aria-expanded={open.has(perek)} onClick={() => toggle(perek)}>
                    <span>{heb(perek)} · Perek {perek}</span>
                    <span className={`chip${isV ? " verified" : ""}`}>{chip}</span>
                  </button>
                  <button className="btn ghost-btn small menu-btn" aria-label={`More for Perek ${perek}`} aria-expanded={menu === perek}
                    onClick={() => setMenu(menu === perek ? null : perek)}>⋯</button>
                </div>
                {menu === perek && (
                  <div className="perek-menu" role="menu">
                    {isV
                      ? <button role="menuitem" className="btn secondary small" onClick={() => { setMenu(null); setSheet({ k: "unverify", perek }); }}>Remove verification</button>
                      : <button role="menuitem" className="btn primary small" onClick={() => { setMenu(null); setSheet({ k: "verify", perek }); }}>✔ Mark as verified</button>}
                    <button role="menuitem" className="btn secondary small" onClick={() => { setMenu(null); setSheet({ k: "resetPerek", perek }); }}>Reset this perek</button>
                    <button role="menuitem" className="btn ghost-btn small" onClick={() => { setMenu(null); toggle(perek); }}>{open.has(perek) ? "Hide mishnayos" : "Show mishnayos"}</button>
                  </div>
                )}
                {open.has(perek) && (
                  <ul className="mishnah-lines">
                    {mishnayosIn(perek).map((m) => {
                      const line = mishnahLine(p, ms, perek, m);
                      return (
                        <li key={m}>
                          <span>{perek}:{m} · {line.text}</span>
                          {line.resettable && (
                            <button className="btn ghost-btn small" onClick={() => setSheet({ k: "notKnown", perek, mishnah: m })}>Mark not known</button>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {tab === "activity" && <ChildHistory profile={p} verifiedOf={props.verifiedOf} online={props.online} />}

      {tab === "settings" && <ChildSettingsForm p={p} save={(np) => props.save(np)} onRemove={() => setSheet({ k: "remove" })} />}

      {sheetEl}
    </div>
  );
}

/** Saves a little after the last change (a name being typed is one log entry, not one per letter). */
function ChildSettingsForm({ p, save, onRemove }: { p: Profile; save: (p: Profile) => void; onRemove: () => void }) {
  const [draft, setDraft] = useState(p);
  const [saved, setSaved] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef({ draft, p, save });
  latest.current = { draft, p, save };

  const flush = () => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    const { draft: d, p: cur, save: s } = latest.current;
    const next = { name: d.name.trim() || cur.name, emoji: d.emoji, settings: d.settings };
    if (JSON.stringify(next) !== JSON.stringify({ name: cur.name, emoji: cur.emoji, settings: cur.settings })) {
      s({ ...cur, ...next });
      setSaved(true);
    }
  };
  useEffect(() => () => flush(), []); // eslint-disable-line react-hooks/exhaustive-deps

  const change = (next: Profile, now = false) => {
    setDraft(next);
    setSaved(false);
    if (timer.current) clearTimeout(timer.current);
    latest.current = { ...latest.current, draft: next };
    if (now) flush();
    else timer.current = setTimeout(flush, 900);
  };
  const set = <K extends keyof Profile["settings"]>(k: K, val: Profile["settings"][K]) => change({ ...draft, settings: { ...draft.settings, [k]: val } });
  const emojis = EMOJIS.includes(draft.emoji as (typeof EMOJIS)[number]) ? [...EMOJIS] : [draft.emoji, ...EMOJIS];

  return (
    <div className="child-settings card-section">
      <label className="field">
        <span>Name</span>
        <input value={draft.name} maxLength={40} onChange={(e) => change({ ...draft, name: e.target.value })} onBlur={flush} />
      </label>
      <div className="field">
        <span>Picture</span>
        <div className="emoji-pick" role="radiogroup" aria-label="Picture">
          {emojis.map((e) => (
            <button key={e} type="button" role="radio" aria-checked={draft.emoji === e} className={draft.emoji === e ? "on" : ""}
              onClick={() => change({ ...draft, emoji: e }, true)}>{e}</button>
          ))}
        </div>
      </div>
      <BreakSetting p={draft} onChange={(np) => change(np)} />
      <label className="field">
        <span>Meanings while learning</span>
        <select value={draft.settings.meaningView ?? "simple"} onChange={(e) => set("meaningView", e.target.value === "steinsaltz" ? "steinsaltz" : "simple")}>
          <option value="simple">Simple (for young readers)</option>
          <option value="steinsaltz">Steinsaltz (bold translation + explanation)</option>
        </select>
      </label>
      <label className="field">
        <span>Text size</span>
        <input type="range" min={0.8} max={1.6} step={0.1} value={draft.settings.fontScale} onChange={(e) => set("fontScale", Number(e.target.value))} />
      </label>
      <p className="hint saved-note" role="status">{saved ? "Saved ✓" : " "}</p>
      <button className="btn ghost-btn danger" onClick={onRemove}>Remove {p.name}</button>
    </div>
  );
}

function RemoveSheet({ name, onCancel, onRemove }: { name: string; onCancel: () => void; onRemove: () => void }) {
  const [typed, setTyped] = useState("");
  const ok = typed.trim().toLocaleLowerCase() === name.trim().toLocaleLowerCase();
  return (
    <ConfirmSheet title={`Remove ${name}?`} action={`Remove ${name}`} danger canAct={ok} onCancel={onCancel} onAct={onRemove}>
      <p>{name}'s progress is deleted from every device. This can't be undone.</p>
      <label className="field">
        <span>Type {name} to confirm</span>
        <input value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" />
      </label>
    </ConfirmSheet>
  );
}

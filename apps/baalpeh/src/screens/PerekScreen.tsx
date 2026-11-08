import { useState } from "react";
import { useMasechta } from "../components/MasechtaGate";
import { frontierGroup, PerekPath, perekGroups } from "../components/PerekPath";
import { hebNum, mishnayosOf } from "../data";
import { parseChainKey, perekParts, perekPracticeLabel, perekSteps } from "../perekSteps";
import { canStartPerekStep, chainSatisfied, isKnown, mp, nextInPerek, pp, stepSatisfied, type PerekPhase, type Task } from "../progress";
import { isDue } from "../srs";
import type { Profile } from "../types";

interface Props {
  profile: Profile;
  perek: number;
  /** Group shown and selection when the screen opens (e.g. coming back from a session started here). */
  group?: number | undefined;
  sel?: string | undefined;
  onBack: () => void;
  /** Start a session for this task; `ui` is restored when the session returns here. */
  onStart: (task: Task, ui: { group: number; sel?: string }) => void;
  onOpenMishnah: (mishnah: number) => void;
  /**
   * Signed in: the parent-verification gate (docs/PARENT_VERIFICATION.md §13.6). `next` is the gated next task of
   * this perek (its test once learned). Guest mode has none: finishing a perek stays on the device.
   */
  gate?: { phase: PerekPhase; sent: boolean; next: Task | null } | undefined;
}

interface Action {
  caption?: string;
  primary?: { label: string; sub?: string; task: Task };
  secondary?: { label: string; run: () => void };
  /** A practice range: its first words are shown as a cue. */
  cue?: [number, number];
}

const range = (from: number, to: number): string => (from === to ? `mishnah ${from}` : `mishnayos ${from}–${to}`);

/**
 * A perek, selectable like a mishnah: its build-up path (mishnah 1 → 2 → 1+2 → 3 → 1–3 … → the whole perek), where a
 * tap only selects (a mishnah alone, mishnayos together, a part, or the 🎯 test), and one button runs the selection.
 */
export function PerekScreen({ profile, perek, group: initialGroup, sel: initialSel, onBack, onStart, onOpenMishnah, gate }: Props) {
  const am = useMasechta();
  const { id: masechta, shape: ms } = am;
  const list = mishnayosOf(perek);
  const n = list.length;
  const steps = perekSteps(ms, perek);
  const groups = perekGroups(ms, perek);
  const parts = perekParts(n);
  const [group, setGroup] = useState(() => (initialGroup !== undefined && groups[initialGroup] ? initialGroup : frontierGroup(profile, ms, perek)));
  const [sel, setSel] = useState<string | null>(initialSel ?? null);
  const next = gate ? gate.next : nextInPerek(profile, ms, perek);
  const done = steps.filter((s) => stepSatisfied(profile, ms, perek, s)).length;

  const allKnown = (from: number, to: number): boolean => {
    for (let m = from; m <= to; m++) if (!isKnown(mp(profile, ms, perek, m))) return false;
    return true;
  };
  const firstUnknown = (from: number, to: number): number => {
    for (let m = from; m <= to; m++) if (!isKnown(mp(profile, ms, perek, m))) return m;
    return to;
  };
  const practice = (from: number, to: number): Action => ({
    caption: from === to ? `Mishnah ${from} alone` : `Mishnayos ${from}–${to} together`,
    primary: { label: `▶ Practice ${range(from, to)}`, task: { masechta, type: "perek-practice", perek, from, to, label: perekPracticeLabel(ms, perek, from, to) } },
    cue: [from, to],
  });

  const frontierAction = (): Action => {
    if (!next) {
      return { primary: { label: "🔁 Review the perek", ...(isDue(pp(profile, ms, perek).review) ? { sub: "due today" } : {}), task: { masechta, type: "review-p", perek } } };
    }
    if (next.type === "learn") {
      const started = mp(profile, ms, perek, next.mishnah).stepIndex > 0;
      return { primary: { label: `▶ ${started ? "Keep learning" : "Learn"} mishnah ${next.mishnah}`, task: next } };
    }
    if (next.type === "perek-chain") return { primary: { label: `▶ Say ${range(next.from, next.to)} together`, task: next } };
    if (!gate) return { primary: { label: "⭐ Finish the perek", task: next } };
    return gate.sent
      ? { primary: { label: "📬 Waiting for Abba or Ima", sub: "practice while you wait", task: next } }
      : { primary: { label: "🎯 I'm ready to show Abba or Ima", task: next } };
  };

  /** A selection that can't run yet still offers a way forward: learn the missing mishnah, or the frontier step. */
  const learnFirst = (from: number, to: number): Action => {
    const m = firstUnknown(from, to);
    const started = mp(profile, ms, perek, m).stepIndex > 0;
    return { caption: `Learn mishnah ${m} first`, primary: { label: `▶ ${started ? "Keep learning" : "Learn"} mishnah ${m}`, task: { masechta, type: "learn", perek, mishnah: m } } };
  };
  const frontierFirst = (caption: string): Action => ({ ...frontierAction(), caption });

  const actionOf = (key: string | null): Action => {
    if (key === null) return frontierAction();
    if (key === "cap") return next?.type === "perek-finish" || !next ? frontierAction() : frontierFirst("Finish every step first");
    const open = (m: number): NonNullable<Action["secondary"]> => ({ label: `Open mishnah ${m} ›`, run: () => onOpenMishnah(m) });
    const mm = /^M(\d+)$/.exec(key);
    if (mm) {
      const m = Number(mm[1]);
      if (isKnown(mp(profile, ms, perek, m))) return { ...practice(m, m), secondary: open(m) };
      return { caption: `Mishnah ${m}`, primary: { label: `▶ Learn mishnah ${m}`, task: { masechta, type: "learn", perek, mishnah: m } }, secondary: open(m) };
    }
    const cm = /^C(.+)$/.exec(key);
    const c = cm ? parseChainKey(cm[1]) : null;
    if (c) {
      const [from, to] = c;
      if (chainSatisfied(profile, ms, perek, from, to) && allKnown(from, to)) return practice(from, to);
      const step = steps.find((s) => s.kind === "chain" && s.from === from && s.to === to);
      if (step && canStartPerekStep(profile, ms, perek, step)) {
        return { caption: `Mishnayos ${from}–${to} together`, primary: { label: `▶ Say ${range(from, to)} together`, task: { masechta, type: "perek-chain", perek, from, to } } };
      }
      if (!allKnown(from, to)) return learnFirst(from, to);
      return frontierFirst("Do the steps before it first");
    }
    const gm = /^G(\d+)$/.exec(key);
    if (gm) {
      const g = groups[Number(gm[1])];
      const r = g ? (g.key === "join" ? [1, n] : parts[g.key]) : undefined;
      if (!g || !r) return frontierAction();
      const [from, to] = r as [number, number];
      const name = g.key === "join" ? "the whole perek" : `Part ${g.key + 1}`;
      if (allKnown(from, to)) return { ...practice(from, to), caption: `Practice all of ${name}` };
      return learnFirst(from, to);
    }
    return frontierAction();
  };

  const action = actionOf(sel);
  const ui = (): { group: number; sel?: string } => ({ group, ...(sel !== null ? { sel } : {}) });
  const cue = action.cue
    ? list.filter((m) => m.mishnah >= action.cue![0] && m.mishnah <= action.cue![1]).map((m) => m.chunks[0]?.he.split(/\s+/)[0] ?? "").join(" … ")
    : "";

  return (
    <div className="perek-screen">
      <div className="topbar" dir="ltr">
        <button className="btn ghost-btn small" onClick={onBack}>‹ Map</button>
        <span className="who" style={{ color: profile.color }}>{profile.emoji} {profile.name}</span>
      </div>
      <h2 className="task-title">{am.he} פרק {hebNum(perek)}</h2>
      <p className="summary" dir="ltr">
        {n} mishnay{n === 1 ? "ah" : "os"}{parts.length > 1 ? ` · ${parts.length} parts` : ""} · {done} of {steps.length} steps
      </p>
      {gate?.phase === "verified" && <p className="perek-status" dir="ltr"><span className="seal">✔ shown</span> You showed Abba or Ima this perek!</p>}
      {gate?.phase === "test" && (
        <p className="perek-status" dir="ltr">{gate.sent ? "📬 We let Abba or Ima know. Say it for them, and when they tap the link, the next perek opens." : "🙋 You learned the whole perek! Next: go show Abba or Ima."}</p>
      )}
      <PerekPath
        profile={profile}
        perek={perek}
        group={group}
        sel={sel}
        onSelect={(key, g) => {
          const gm = /^G(\d+)$/.exec(key);
          if (gm) setGroup(Number(gm[1]));
          else if (g !== group) setGroup(g);
          setSel((s) => (s === key ? null : key));
        }}
        {...(action.caption !== undefined ? { caption: action.caption } : {})}
      />
      {cue && <p className="practice-cue" dir="rtl">{cue}</p>}
      <div className="actions" dir="ltr">
        {action.primary && (
          <button className="btn primary big" onClick={() => onStart(action.primary!.task, ui())}>
            {action.primary.label}
            {action.primary.sub && <span className="sub">{action.primary.sub}</span>}
          </button>
        )}
        {action.secondary && <button className="btn secondary" onClick={action.secondary.run}>{action.secondary.label}</button>}
      </div>
      <ul className="perek-list">
        {list.map((m) => {
          const st = mp(profile, ms, perek, m.mishnah);
          return (
            <li key={m.mishnah}>
              <button className="perek-list-row" onClick={() => onOpenMishnah(m.mishnah)} aria-label={`Open mishnah ${m.mishnah}, ${st.state}`}>
                <span className={`circle ${st.state}`} aria-hidden="true">{hebNum(m.mishnah).replace("׳", "")}</span>
                <span className="perek-list-text">
                  <span className="opening">{(m.chunks[0]?.he ?? "").split(/\s+/).slice(0, 3).join(" ")}</span>
                  {am.translated && m.summary && <span className="gist" dir="ltr">{m.summary}</span>}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

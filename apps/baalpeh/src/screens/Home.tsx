import { Fragment } from "react";
import { VerifIntroBanner } from "../components/PerekGate";
import { PerekStrip } from "../components/PerekStrip";
import { hebNum, MASECHTA, PERAKIM } from "../data";
import { perekSteps } from "../perekSteps";
import {
  dueReviews, frontier, gatedDueReviews, gatedNextLearning, nextLearning, perekDone, perekPhase, stepSatisfied, type PerekPhase, type Task,
  type Verified,
} from "../progress";
import { addDays, today } from "../srs";
import type { Profile } from "../types";

interface Props {
  profile: Profile;
  onStart: () => void;
  onOpenMishnah: (perek: number, mishnah: number) => void;
  onOpenPerek: (perek: number) => void;
  /** Back to the picker. Omitted in guest mode (one learner, nothing to switch to). */
  onBack?: () => void;
  /** Signed in: the parent-verification gate (docs/PARENT_VERIFICATION.md §10.2). Guest mode has none (ungated). */
  gate?: HomeGate;
}

export interface HomeGate {
  verified: Verified;
  /** This device has sent the test email for this perek (the link is still live). */
  sent: (perek: number) => boolean;
  /** A locked row was tapped: open the locked sheet. */
  onLocked: (perek: number) => void;
  /** The "🙋 Test me!" / "📬 Waiting" badge: open the test step. */
  onOpenTest: (perek: number) => void;
  /** The one-time banner for children who learned perakim before verification existed (§10.3). */
  intro?: { frontier: number; testReady: boolean; onGo: () => void; onClose: () => void };
}

const reviews = (n: number) => `${n} review${n > 1 ? "s" : ""}`;

/** The start button's sub-label under the gate (§10.2). */
export function gatedSubLabel(due: number, next: Task | null, testPerek: number | null, sent: boolean): string {
  if (testPerek !== null) {
    if (due > 0) return `${reviews(due)}, then your perek test`;
    return sent ? "Waiting for your test 📬 · practice while you wait" : `Get ready for your פרק ${hebNum(testPerek)} test`;
  }
  if (due > 0) return `${reviews(due)}, then new learning`;
  return next ? nextSubLabel(next) : "All caught up!";
}

function WeekDots({ days }: { days: string[] }) {
  const now = today();
  const week = Array.from({ length: 7 }, (_, i) => addDays(now, i - 6));
  return (
    <div className="week" dir="ltr" aria-label="Days learned this week">
      {week.map((d) => {
        const dow = new Date(`${d}T12:00:00`).getDay();
        return (
          <span key={d} className={`day ${days.includes(d) ? "on" : ""} ${dow === 6 ? "shabbos" : ""}`} title={d} />
        );
      })}
    </div>
  );
}

/** The start button's sub-label for the next learning task. */
export function nextSubLabel(t: Task): string {
  switch (t.type) {
    case "learn": return `Next: mishnah ${t.mishnah}`;
    case "perek-chain": return `Next: mishnayos ${t.from}–${t.to} together`;
    case "perek-finish": return `Next: finish Perek ${t.perek}`;
    default: return "Continue learning";
  }
}

export function Home({ profile, onStart, onOpenMishnah, onOpenPerek, onBack, gate }: Props) {
  const v = gate?.verified;
  const due = (v ? gatedDueReviews(profile, v) : dueReviews(profile)).length;
  const next = v ? gatedNextLearning(profile, v) : nextLearning(profile);
  const f = v ? frontier(v) : null;
  const testPerek = v && f !== null && perekPhase(profile, v, f) === "test" ? f : null;
  const label = gate
    ? gatedSubLabel(due, next, testPerek, testPerek !== null && gate.sent(testPerek))
    : due > 0 ? `${reviews(due)}, then new learning` : next ? nextSubLabel(next) : "All caught up!";
  const phaseOf = (perek: number): PerekPhase | null => (v ? perekPhase(profile, v, perek) : null);
  /** The gold row: verified when signed in, finished on this device in guest mode. */
  const gold = (perek: number): boolean => (v ? v.has(perek) : perekDone(profile, perek));
  return (
    <div className="home">
      <div className="topbar" dir="ltr">
        {onBack ? <button className="btn ghost-btn small" onClick={onBack}>‹ Switch</button> : <span />}
        <span className="who" style={{ color: profile.color }}>{profile.emoji} {profile.name}</span>
      </div>
      {gate?.intro && <VerifIntroBanner {...gate.intro} />}
      <button className="btn primary huge" onClick={onStart} dir="ltr">
        ▶ Start today's learning
        <span className="sub">{label}</span>
      </button>
      <WeekDots days={profile.days} />
      <h2 className="masechta">מסכת {MASECHTA.masechta}</h2>
      <div className="perek-map">
        {PERAKIM.map((perek, i) => {
          const steps = perekSteps(perek);
          const doneSteps = steps.filter((st) => stepSatisfied(profile, perek, st)).length;
          const done = gold(perek);
          const phase = phaseOf(perek);
          const pct = steps.length ? Math.round((100 * doneSteps) / steps.length) : 0;
          const current = next !== null && next.perek === perek;
          const spine = i > 0 && <div className={`spine${gold(PERAKIM[i - 1] ?? 0) ? " done" : ""}`} aria-hidden="true" />;
          const ring = <span className="ring" style={{ background: `conic-gradient(var(--gold) ${pct}%, var(--line) 0)` }} aria-hidden="true"><i /></span>;
          if (phase === "locked" && gate && f !== null) {
            // One button for the whole row: greyed, stars still shown, and the state is in words too.
            return (
              <Fragment key={perek}>
                {spine}
                <button
                  className="perek-row locked"
                  onClick={() => gate.onLocked(perek)}
                  aria-label={`פרק ${hebNum(perek)}, locked until פרק ${hebNum(f)} is tested`}
                >
                  <span className="perek-head" aria-hidden="true">
                    {ring}
                    <span className="perek-label">פרק {hebNum(perek)}</span>
                    <span className="lock">🔒</span>
                  </span>
                  <PerekStrip profile={profile} perek={perek} size="map" />
                </button>
              </Fragment>
            );
          }
          return (
            <Fragment key={perek}>
              {spine}
              <div className={`perek-row${done ? " complete" : ""}${current ? " current" : ""}`}>
                <div className="perek-head-row">
                  <button
                    className="perek-head"
                    onClick={() => onOpenPerek(perek)}
                    aria-label={`Perek ${perek}, ${doneSteps} of ${steps.length} steps${phase === "verified" ? ", tested" : done ? ", finished" : ""}, open perek`}
                  >
                    {ring}
                    <span className="perek-label">פרק {hebNum(perek)}</span>
                    {done && !v && <span className="perek-done" aria-hidden="true">✓</span>}
                    {phase === "verified" && <span className="seal" dir="ltr">✔ tested</span>}
                    <span className="chev" aria-hidden="true">›</span>
                  </button>
                  {phase === "test" && gate && (
                    <button className={`badge${gate.sent(perek) ? " sent" : " pulse"}`} dir="ltr" onClick={() => gate.onOpenTest(perek)}>
                      {gate.sent(perek) ? "📬 Waiting" : "🙋 Test me!"}
                    </button>
                  )}
                </div>
                <PerekStrip profile={profile} perek={perek} size="map" next={next} onOpenMishnah={(m) => onOpenMishnah(perek, m)} />
              </div>
            </Fragment>
          );
        })}
      </div>
    </div>
  );
}

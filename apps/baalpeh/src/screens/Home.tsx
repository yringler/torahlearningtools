import { Fragment } from "react";
import { PerekStrip } from "../components/PerekStrip";
import { hebNum, MASECHTA, PERAKIM } from "../data";
import { perekSteps } from "../perekSteps";
import { dueReviews, nextLearning, perekDone, stepSatisfied, type Task } from "../progress";
import { addDays, today } from "../srs";
import type { Profile } from "../types";

interface Props {
  profile: Profile;
  onStart: () => void;
  onOpenMishnah: (perek: number, mishnah: number) => void;
  onOpenPerek: (perek: number) => void;
  /** Back to the picker. Omitted in guest mode (one learner, nothing to switch to). */
  onBack?: () => void;
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

export function Home({ profile, onStart, onOpenMishnah, onOpenPerek, onBack }: Props) {
  const due = dueReviews(profile).length;
  const next = nextLearning(profile);
  const label = due > 0 ? `${due} review${due > 1 ? "s" : ""}, then new learning` : next ? nextSubLabel(next) : "All caught up!";
  return (
    <div className="home">
      <div className="topbar" dir="ltr">
        {onBack ? <button className="btn ghost-btn small" onClick={onBack}>‹ Switch</button> : <span />}
        <span className="who" style={{ color: profile.color }}>{profile.emoji} {profile.name}</span>
      </div>
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
          const done = perekDone(profile, perek);
          const pct = steps.length ? Math.round((100 * doneSteps) / steps.length) : 0;
          const current = next !== null && next.perek === perek;
          return (
            <Fragment key={perek}>
              {i > 0 && <div className={`spine${perekDone(profile, PERAKIM[i - 1] ?? 0) ? " done" : ""}`} aria-hidden="true" />}
              <div className={`perek-row${done ? " complete" : ""}${current ? " current" : ""}`}>
                <button
                  className="perek-head"
                  onClick={() => onOpenPerek(perek)}
                  aria-label={`Perek ${perek}, ${doneSteps} of ${steps.length} steps${done ? ", finished" : ""}, open perek`}
                >
                  <span className="ring" style={{ background: `conic-gradient(var(--gold) ${pct}%, var(--line) 0)` }} aria-hidden="true"><i /></span>
                  <span className="perek-label">פרק {hebNum(perek)}</span>
                  {done && <span className="perek-done" aria-hidden="true">✓</span>}
                  <span className="chev" aria-hidden="true">›</span>
                </button>
                <PerekStrip profile={profile} perek={perek} size="map" next={next} onOpenMishnah={(m) => onOpenMishnah(perek, m)} />
              </div>
            </Fragment>
          );
        })}
      </div>
    </div>
  );
}

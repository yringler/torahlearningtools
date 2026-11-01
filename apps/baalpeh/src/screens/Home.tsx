import { hebNum, MASECHTA, mishnayosOf, PERAKIM } from "../data";
import { dueReviews, isKnown, mp, nextLearning, pp } from "../progress";
import { addDays, today } from "../srs";
import type { Profile } from "../types";

interface Props {
  profile: Profile;
  onStart: () => void;
  onOpenMishnah: (perek: number, mishnah: number) => void;
  onBack: () => void;
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

export function Home({ profile, onStart, onOpenMishnah, onBack }: Props) {
  const due = dueReviews(profile).length;
  const next = nextLearning(profile);
  const label = due > 0 ? `${due} review${due > 1 ? "s" : ""}, then new learning` : next ? "Continue learning" : "All caught up!";
  return (
    <div className="home">
      <div className="topbar" dir="ltr">
        <button className="btn ghost-btn small" onClick={onBack}>‹ Switch</button>
        <span className="who" style={{ color: profile.color }}>{profile.emoji} {profile.name}</span>
      </div>
      <button className="btn primary huge" onClick={onStart} dir="ltr">
        ▶ Start today's learning
        <span className="sub">{label}</span>
      </button>
      <WeekDots days={profile.days} />
      <h2 className="masechta">מסכת {MASECHTA.masechta}</h2>
      <div className="perek-map">
        {PERAKIM.map((perek) => {
          const pr = pp(profile, perek);
          const list = mishnayosOf(perek);
          return (
            <div key={perek} className={`perek-row ${pr.complete ? "complete" : ""}`}>
              <div className="perek-label">פרק {hebNum(perek)}</div>
              <div className="circles">
                {list.map((m) => {
                  const st = mp(profile, perek, m.mishnah);
                  const chained = pr.chainedThrough >= m.mishnah && m.mishnah > 1;
                  return (
                    <button
                      key={m.mishnah}
                      className={`circle ${st.state}`}
                      onClick={() => onOpenMishnah(perek, m.mishnah)}
                      title={`${perek}:${m.mishnah} — ${st.state}`}
                    >
                      {hebNum(m.mishnah).replace("׳", "")}
                      {isKnown(st) && <span className="star">{st.state === "solid" ? "★★" : "★"}</span>}
                      {chained && <span className="link" aria-hidden="true" />}
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

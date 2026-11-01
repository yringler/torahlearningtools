import { useEffect, useState } from "react";
import type { ChildStatsResponse, LearningEvent } from "../../shared/api";
import { api, ApiFailure, NetworkFailure } from "../api/client";
import { dueReviews } from "../progress";
import { addDays, today } from "../srs";
import type { Profile } from "../types";

interface Props {
  profile: Profile;
  online: boolean;
}

type Load<T> = { s: "loading" } | { s: "ok"; v: T } | { s: "offline" } | { s: "notSynced" } | { s: "error" };

const failState = (e: unknown): Load<never> =>
  e instanceof NetworkFailure ? { s: "offline" } : e instanceof ApiFailure && e.status === 404 ? { s: "notSynced" } : { s: "error" };

const gradeWord = { pass: "perfect", help: "with a little help", notyet: "needs more practice" } as const;

const where = (perek: number, mishnah: number | null) => (mishnah === null ? `Perek ${perek}` : `${perek}:${mishnah}`);

export function describeEvent(e: LearningEvent): string {
  switch (e.type) {
    case "recite": {
      const what = e.task === "learn" ? `Learned a piece of ${where(e.perek, e.mishnah)}`
        : e.task === "chain" ? `Said pieces of ${where(e.perek, e.mishnah)} together`
        : e.task === "detour" ? `Extra practice on ${where(e.perek, e.mishnah)}`
        : e.task === "review-m" ? `Reviewed ${where(e.perek, e.mishnah)}`
        : e.task === "perek-chain" ? `Said Perek ${e.perek} in a row`
        : `Reviewed Perek ${e.perek}`;
      return `${what} — ${gradeWord[e.grade]}${e.peeks ? `, ${e.peeks} peek${e.peeks === 1 ? "" : "s"}` : ""}`;
    }
    case "check": {
      const what = e.scope === "mishnah" ? `Parent check of ${where(e.perek, e.mishnah)}`
        : e.scope === "chain" ? `Parent check of Perek ${e.perek}, mishnayos 1–${e.through ?? "?"}`
        : `Parent check of the Perek ${e.perek} review`;
      return `${what}: ${gradeWord[e.grade]}${e.slipWords ? ` (${e.slipWords} word${e.slipWords === 1 ? "" : "s"} slipped)` : ""}`;
    }
    case "session":
      return `Learning session, ${e.ms < 60000 ? "under 1" : Math.round(e.ms / 60000)} min, ${e.steps} step${e.steps === 1 ? "" : "s"}`;
    case "reset":
      return `Parent reset ${e.perek}:${e.mishnah}`;
  }
}

const when = (at: number) => new Date(at).toLocaleString([], { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

/** Parent-only view of one child's practice, from the server's event log. */
export function ChildHistory({ profile, online }: Props) {
  const [stats, setStats] = useState<Load<ChildStatsResponse>>({ s: "loading" });
  const [events, setEvents] = useState<LearningEvent[]>([]);
  const [nextBefore, setNextBefore] = useState<number | null>(null);
  const [moreBusy, setMoreBusy] = useState(false);
  const due = dueReviews(profile);

  useEffect(() => {
    if (!online) return;
    let cancelled = false;
    Promise.all([api.stats(profile.id, 30), api.events(profile.id)]).then(
      ([st, ev]) => {
        if (cancelled) return;
        setStats({ s: "ok", v: st });
        setEvents(ev.events);
        setNextBefore(ev.nextBefore);
      },
      (e: unknown) => { if (!cancelled) setStats(failState(e)); },
    );
    return () => { cancelled = true; };
  }, [profile.id, online]);

  const loadMore = async () => {
    if (nextBefore === null) return;
    setMoreBusy(true);
    try {
      const ev = await api.events(profile.id, nextBefore);
      setEvents((list) => [...list, ...ev.events]);
      setNextBefore(ev.nextBefore);
    } catch {
      /* keep what we have */
    }
    setMoreBusy(false);
  };

  const dueList = (
    <div>
      <h4>Due now</h4>
      {due.length === 0 ? <p className="hint">Nothing due.</p> : (
        <ul>
          {due.map((t) => (
            <li key={JSON.stringify(t)}>{t.type === "review-p" ? `Perek ${t.perek} review` : "mishnah" in t ? `Review ${t.perek}:${t.mishnah}` : `Perek ${t.perek}`}</li>
          ))}
        </ul>
      )}
    </div>
  );

  const state: Load<ChildStatsResponse> = online ? stats : { s: "offline" };
  if (state.s !== "ok") {
    return (
      <div className="history">
        {dueList}
        <p className="hint">
          {state.s === "loading" ? "Loading history…"
            : state.s === "offline" ? "Connect to the internet to see history."
            : state.s === "notSynced" ? "History appears after this child's progress reaches the server."
            : "Couldn't load history. Try again later."}
        </p>
      </div>
    );
  }

  const st = state.v;
  const attention = st.items.filter((i) => i.struggle > 0).slice(0, 5);
  const minutesByDay = new Map(st.days.map((d) => [d.day, d.minutes] as const));
  const now = today();
  const last14 = Array.from({ length: 14 }, (_, i) => addDays(now, i - 13));
  const maxMin = Math.max(1, ...last14.map((d) => minutesByDay.get(d) ?? 0));

  return (
    <div className="history">
      {dueList}
      <div>
        <h4>Needs attention</h4>
        {attention.length === 0 ? <p className="hint">Nothing stands out in the last 30 days.</p> : (
          <ul>
            {attention.map((i) => (
              <li key={`${i.perek}:${i.mishnah ?? "p"}`}>
                {i.mishnah === null ? `Perek ${i.perek} in a row` : `Perek ${i.perek} · Mishnah ${i.mishnah}`} — {i.attempts} tr{i.attempts === 1 ? "y" : "ies"}
                {i.notyet > 0 && `, ${i.notyet} needed more practice`}{i.peeks > 0 && `, ${i.peeks} peek${i.peeks === 1 ? "" : "s"}`}
              </li>
            ))}
          </ul>
        )}
      </div>
      <div>
        <h4>Last 14 days</h4>
        <div className="bars" dir="ltr">
          {last14.map((d) => {
            const m = minutesByDay.get(d) ?? 0;
            const shabbos = new Date(`${d}T12:00:00`).getDay() === 6;
            return (
              <div key={d} className={`bar-col ${shabbos ? "shabbos" : ""}`} title={`${d}: ${m} min`}>
                <div className="bar" style={{ height: `${Math.round((m / maxMin) * 100)}%` }} />
                <span className="bar-label">{Number(d.slice(8))}</span>
              </div>
            );
          })}
        </div>
      </div>
      <div>
        <h4>Recent activity</h4>
        {events.length === 0 ? <p className="hint">No activity yet.</p> : (
          <ul className="activity">
            {events.map((e) => <li key={e.id}><span className="when">{when(e.at)}</span> {describeEvent(e)}</li>)}
          </ul>
        )}
        {nextBefore !== null && <button className="btn ghost-btn small" disabled={moreBusy} onClick={() => void loadMore()}>Load more</button>}
      </div>
    </div>
  );
}

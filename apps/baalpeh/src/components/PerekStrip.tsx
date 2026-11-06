import { hebNum, mishnayosOf } from "../data";
import { isKnown, joined, mp, type Task } from "../progress";
import type { Profile } from "../types";

interface Props {
  profile: Profile;
  perek: number;
  /** "map": the home map's tappable circles. "big": a larger, read-only strip (perek screen, celebrations). */
  size: "map" | "big";
  /** What comes next (the map passes nextLearning, the perek screen nextInPerek): marks "you are here". */
  next?: Task | null | undefined;
  /** Joins (by their later mishnah m, for the join m-1 → m) that were just made: they snap in. */
  justJoined?: number[] | undefined;
  /** Map only: tapping a circle opens that mishnah. */
  onOpenMishnah?: ((mishnah: number) => void) | undefined;
}

/**
 * A perek's mishnayos as circles, right to left, joined by golden threads: a join m-1 → m is gold once those two
 * have been said together. Colour is never the only signal: a done join is thick and solid, a todo join dotted.
 */
export function PerekStrip({ profile, perek, size, next, justJoined, onOpenMishnah }: Props) {
  const list = mishnayosOf(perek);
  const here = next && next.perek === perek ? next : null;
  const interactive = size === "map" && onOpenMishnah !== undefined;

  const circle = (m: number) => {
    const st = mp(profile, perek, m);
    const isHere = here?.type === "learn" && here.mishnah === m;
    const cls = `circle ${st.state}${isHere ? " here" : ""}`;
    const body = (
      <>
        {hebNum(m).replace("׳", "")}
        {isKnown(st) && <span className="star">{st.state === "solid" ? "★★" : "★"}</span>}
      </>
    );
    if (!interactive) return <span className={cls}>{body}</span>;
    return (
      <button
        className={cls}
        onClick={() => onOpenMishnah?.(m)}
        title={`${perek}:${m} — ${st.state}`}
        aria-label={`Mishnah ${m}, ${st.state}${isHere ? ", you are here" : ""}`}
      >
        {body}
      </button>
    );
  };

  const joinCls = (m: number): string => {
    const done = joined(profile, perek, m);
    const isHere = !done && here?.type === "perek-chain" && here.from < m && m <= here.to;
    const just = done && justJoined?.includes(m);
    return `join${done ? " done" : ""}${isHere ? " here" : ""}${just ? " just" : ""}`;
  };

  return (
    <div className={`strip ${size}`} {...(interactive ? {} : { "aria-hidden": true })}>
      {list.map(({ mishnah: m }) =>
        m === list[0]?.mishnah ? (
          <span key={m} className="mseg first">{circle(m)}</span>
        ) : (
          <span key={m} className="mseg">
            <span className={joinCls(m)} aria-hidden="true" />
            {circle(m)}
          </span>
        ),
      )}
    </div>
  );
}

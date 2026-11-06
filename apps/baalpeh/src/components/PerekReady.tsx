import { hebNum, MASECHTA } from "../data";
import { perekPhrases } from "../perekSteps";
import type { Profile } from "../types";
import { PerekStrip } from "./PerekStrip";

interface Props {
  profile: Profile;
  perek: number;
  /**
   * "I'm ready to be tested". Today the session shows the in-app parent check; roadmap item 2 replaces this with
   * the parent's email request (and a waiting state here).
   */
  onReady: () => void;
  onPracticeMore: () => void;
}

/** The end of the perek build-up: every step is done, and the whole perek can be looked over before the test. */
export function PerekReady({ profile, perek, onReady, onPracticeMore }: Props) {
  const text = perekPhrases(perek);
  return (
    <div className="perek-ready">
      <div className="celebrate" dir="ltr">
        <div className="big-emoji">🎯</div>
        <h2>You built the whole perek, {profile.name}!</h2>
        <p><bdi>{MASECHTA.masechta} פרק {hebNum(perek)}</bdi></p>
      </div>
      <PerekStrip profile={profile} perek={perek} size="big" />
      <details className="look-over">
        <summary dir="ltr">Look it over first</summary>
        {text.map(({ mishnah, phrases }) => (
          <section key={mishnah} className="mcard">
            <div className="mcard-label">משנה {hebNum(mishnah)}</div>
            <div className="cards compact">
              {phrases.map((he, i) => <span key={i} className="card cue-0">{he}</span>)}
            </div>
          </section>
        ))}
      </details>
      <div className="actions" dir="ltr">
        <button className="btn primary big" onClick={onReady}>🎯 I'm ready to be tested</button>
        <button className="btn secondary" onClick={onPracticeMore}>Practice more first</button>
      </div>
    </div>
  );
}

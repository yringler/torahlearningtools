import { hebNum, MASECHTA, PERAKIM } from "../data";
import { GUEST_BODY, GUEST_BUTTON, GUEST_LEAD } from "../perekTest";

/**
 * The kind pieces of the parent-verification gate (docs/PARENT_VERIFICATION.md §9, §10.2, §10.3): the "Continue as a
 * guest" offer, the locked-perek sheet, and the one-time banner. Copy never says "blocked" or "denied", and every
 * locked message names the one next action.
 */

/** "Want to keep going? Continue as a guest…" with its button (exact copy, §9). */
export function GuestOffer({ onGuest }: { onGuest: () => void }) {
  return (
    <div className="guest-offer" dir="ltr">
      <p><b>{GUEST_LEAD}</b> {GUEST_BODY}</p>
      <button className="btn secondary" onClick={onGuest}>{GUEST_BUTTON}</button>
    </div>
  );
}

interface LockedProps {
  perek: number;
  /** The frontier: the perek a parent tests next. */
  frontier: number;
  /** The locked perek already has saved progress. */
  saved: boolean;
  /** The frontier is learned (its next task is the test). */
  testReady: boolean;
  onGoFrontier: () => void;
  onGuest: () => void;
  onClose: () => void;
}

/** A bottom sheet for a tapped locked perek. Never a scolding modal. */
export function LockedSheet({ perek, frontier, saved, testReady, onGoFrontier, onGuest, onClose }: LockedProps) {
  const n = hebNum(perek);
  const f = hebNum(frontier);
  return (
    <div className="sheet-backdrop" role="dialog" aria-modal="true" aria-labelledby="locked-title" onClick={onClose}>
      <div className="sheet locked-sheet" dir="ltr" onClick={(e) => e.stopPropagation()}>
        {saved ? (
          <>
            <h3 id="locked-title">⭐ You already learned some of <bdi>פרק {n}</bdi>, and it's all saved!</h3>
            <p>It opens after you show Abba or Ima <bdi>פרק {f}</bdi>.</p>
          </>
        ) : (
          <>
            <h3 id="locked-title">🔒 <bdi>פרק {n}</bdi> is waiting for you!</h3>
            <p>First show Abba or Ima that you know <bdi>פרק {f}</bdi>. Then this one opens.</p>
          </>
        )}
        <button className="btn primary big" onClick={onGoFrontier}>
          {/* Only promise the show step when tapping really opens it (goFrontier); saved progress elsewhere doesn't. */}
          {testReady ? <>Get ready to show <bdi>פרק {f}</bdi> ›</> : <>Go to <bdi>פרק {f}</bdi> ›</>}
        </button>
        <button className="btn ghost-btn" onClick={onClose}>OK</button>
        <GuestOffer onGuest={onGuest} />
      </div>
    </div>
  );
}

/** Shown once per child per device to children who learned perakim before verification existed (§10.3). */
export function VerifIntroBanner({ frontier, testReady, onGo, onClose }: { frontier: number; testReady: boolean; onGo: () => void; onClose: () => void }) {
  return (
    <div className="verif-banner" dir="ltr" role="note">
      <p><b>🎉 Something new!</b> Now, when you finish a perek, you say it for Abba or Ima, and then the next perek opens.</p>
      <p>You already learned a lot, and <b>all your stars are saved.</b> Let's start with <b><bdi>פרק {hebNum(frontier)}</bdi></b>: show them you know it, and your perakim open one by one.</p>
      <div className="row center">
        <button className="btn primary" onClick={onGo}>{testReady ? "Get ready to show Abba or Ima ›" : <>Go to <bdi>פרק {hebNum(frontier)}</bdi> ›</>}</button>
        <button className="btn ghost-btn" onClick={onClose}>OK</button>
      </div>
    </div>
  );
}

/** The perek after this one, or null on the last perek. */
export const nextPerekOf = (perek: number): number | null => {
  const i = PERAKIM.indexOf(perek);
  return i >= 0 ? PERAKIM[i + 1] ?? null : null;
};

/** "It's official!" (§10.1 verified state), shown in the test step and, as a sheet, on Home when a row arrives there. */
export function OfficialBody({ name, perek, nextLabel, onNext, onMap }: {
  name: string; perek: number; nextLabel?: string | undefined; onNext?: (() => void) | undefined; onMap: () => void;
}) {
  const np = nextPerekOf(perek);
  return (
    <div className="celebrate official" dir="ltr">
      <div className="big-emoji">⭐⭐⭐</div>
      <h2>Mazel tov, {name}! It's official!</h2>
      <p>
        Abba or Ima tested you on <bdi>מסכת {MASECHTA.masechta} פרק {hebNum(perek)}</bdi>.
        <br />
        {np !== null ? <><bdi>פרק {hebNum(np)}</bdi> is open!</> : <>You finished <bdi>מסכת {MASECHTA.masechta}</bdi>! 🏆</>}
      </p>
      {np !== null && onNext && <button className="btn primary big" onClick={onNext}>{nextLabel ?? <>Start <bdi>פרק {hebNum(np)}</bdi> ›</>}</button>}
      <button className={np !== null && onNext ? "btn secondary" : "btn primary big"} onClick={onMap}>🗺️ See my map</button>
    </div>
  );
}

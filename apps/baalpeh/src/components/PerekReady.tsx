import { useEffect, useMemo, useRef, useState } from "react";
import { PEREK_TEST, type LearningEventBody, type Ms } from "../../shared/api";
import { hebNum, MASECHTA, DEFAULT_MASECHTA_ID } from "../data";
import { kv } from "../kv";
import { perekPhrases } from "../perekSteps";
import { agoText, markCelebrated, minutesLeft, wasCelebrated, type RequestResult } from "../perekTest";
import type { LastTest } from "../sync/store";
import type { Cue, Profile } from "../types";
import { GuestOffer, nextPerekOf, OfficialBody } from "./PerekGate";
import { PerekStrip } from "./PerekStrip";
import { Recite, type ReciteCard, type ReciteSection } from "./Recite";

/**
 * What the signed-in app gives the test step (docs/PARENT_VERIFICATION.md §10.1). Guest mode passes none, so this
 * component (and Session) never need the API client.
 */
export interface PerekTestApi {
  /** When a parent verified this perek (server data), or null. */
  verifiedAt(perek: number): Ms | null;
  /** Past the frontier (e.g. after a sync moved the gate back). */
  locked(perek: number): boolean;
  /** This device's live request for this perek. */
  lastTest(perek: number): LastTest | null;
  serverNow(): Ms;
  /** Sync, then ask the server to email the test. */
  request(perek: number): Promise<RequestResult>;
  /** Sync now (polling for the parent's tap). */
  refresh(): void;
  online: boolean;
  devEmail: boolean;
  /** Open the in-memory guest at this perek ("Continue as a guest"). */
  onGuest(perek: number): void;
  onParentArea(): void;
}

interface Props {
  profile: Profile;
  perek: number;
  onPracticeMore: () => void;
  onMap: () => void;
  /** Signed in: the email test. Absent in guest mode. */
  test?: PerekTestApi | undefined;
  /** Guest mode: finish the perek on this device (never official). */
  onFinishGuest?: (() => void) | undefined;
  /** After "It's official!": start the next learning (absent when there is none). */
  onNext?: (() => void) | undefined;
  nextLabel?: string | undefined;
  onEvent?: ((e: LearningEventBody) => void) | undefined;
}

type View =
  | { v: "ready"; note?: string }
  | { v: "say" }
  | { v: "confirm" }
  | { v: "sending" }
  | { v: "waiting"; cooldown?: boolean }
  | { v: "read"; back: "ready" | "waiting" }
  | { v: "official" }
  | { v: "already" }
  | { v: "failed" }
  | { v: "signedOut" };

const POLL_MS = 30_000;

/** The perek as phrase cards, one section per mishnah (the same pieces as the email). */
function perekCards(perek: number): { cards: ReciteCard[]; sections: ReciteSection[] } {
  const cards: ReciteCard[] = [];
  const sections: ReciteSection[] = [];
  for (const { mishnah, phrases } of perekPhrases(perek)) {
    const start = cards.length;
    for (const he of phrases) cards.push({ he });
    sections.push({ label: `משנה ${hebNum(mishnah)}`, start, end: cards.length });
  }
  return { cards, sections };
}

function WholePerek({ perek }: { perek: number }) {
  return (
    <>
      {perekPhrases(perek).map(({ mishnah, phrases }) => (
        <section key={mishnah} className="mcard">
          <div className="mcard-label">משנה {hebNum(mishnah)}</div>
          <div className="cards compact">
            {phrases.map((he, i) => <span key={i} className="card cue-0">{he}</span>)}
          </div>
        </section>
      ))}
    </>
  );
}

/**
 * The end of the perek build-up, merged with the test step: look the whole perek over, optionally say it once, then
 * "I'm ready to be tested" → a confirm sheet → the email to Abba or Ima → waiting (polled) → "It's official!".
 * Nothing on this screen can mark a perek done: only the parent's tap on the emailed link does, on the server.
 */
export function PerekReady({ profile, perek, onPracticeMore, onMap, test, onFinishGuest, onNext, nextLabel, onEvent }: Props) {
  const name = profile.name;
  const verifiedAt = test?.verifiedAt(perek) ?? null;
  const [view, setView] = useState<View>(() => {
    if (!test) return { v: "ready" };
    if (verifiedAt !== null) return wasCelebrated(kv, profile.id, DEFAULT_MASECHTA_ID, perek, verifiedAt) ? { v: "already" } : { v: "official" };
    return test.lastTest(perek) ? { v: "waiting" } : { v: "ready" };
  });
  const [, setTick] = useState(0);
  const sayStart = useRef(Date.now());

  // The parent's tap arrives through sync: celebrate (once per verification per device).
  useEffect(() => {
    if (verifiedAt === null) return;
    if (view.v !== "official" && view.v !== "already") setView({ v: "official" });
  }, [verifiedAt, view.v]);
  useEffect(() => {
    if (view.v === "official" && verifiedAt !== null) markCelebrated(kv, profile.id, DEFAULT_MASECHTA_ID, perek, verifiedAt);
  }, [view.v, verifiedAt, profile.id, perek]);

  // While waiting is on screen: sync on mount, when visible again, on focus, and every 30 s; tick the countdown.
  const waiting = view.v === "waiting" || (view.v === "read" && view.back === "waiting");
  const refresh = test?.refresh;
  useEffect(() => {
    if (!waiting || !refresh) return;
    const poll = () => { if (document.visibilityState === "visible") refresh(); };
    poll();
    const onVis = () => poll();
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("focus", onVis);
    const id = setInterval(poll, POLL_MS);
    const tick = setInterval(() => setTick((t) => t + 1), 15_000);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("focus", onVis);
      clearInterval(id);
      clearInterval(tick);
    };
  }, [waiting, refresh]);

  const { cards, sections } = useMemo(() => perekCards(perek), [perek]);
  const np = nextPerekOf(perek);
  const heading = (
    <div className="celebrate" dir="ltr">
      <div className="big-emoji">🎯</div>
      <h2>You built the whole perek, {name}!</h2>
      <p><bdi>{MASECHTA.masechta} פרק {hebNum(perek)}</bdi></p>
    </div>
  );

  // ── guest mode: ungated, never counts ──
  if (!test) {
    return (
      <div className="perek-ready">
        {heading}
        <PerekStrip profile={profile} perek={perek} size="big" />
        <details className="look-over">
          <summary dir="ltr">Look it over first</summary>
          <WholePerek perek={perek} />
        </details>
        <div className="actions" dir="ltr">
          <button className="btn primary big" onClick={onFinishGuest}>⭐ Finish the perek</button>
          <button className="btn secondary" onClick={onPracticeMore}>Practice more first</button>
          <p className="hint">In your own profile, Abba or Ima test you before the next perek opens.</p>
        </div>
      </div>
    );
  }

  const send = async () => {
    setView({ v: "sending" });
    const r = await test.request(perek);
    switch (r.kind) {
      case "sent": setView({ v: "waiting" }); break;
      case "already": setView({ v: "official" }); break;
      case "cooldown":
        // The per-child cooldown (≤ 10 min) means a test is already on its way; a longer wait is the account's cap.
        setView(r.retryAfterSec <= PEREK_TEST.COOLDOWN_SEC
          ? { v: "waiting", cooldown: true }
          : { v: "ready", note: `Lots of test emails were sent today. You can send yours in ${Math.ceil(r.retryAfterSec / 60)} min.` });
        break;
      case "offline": setView({ v: "ready", note: "You're offline. Your test needs the internet to send. Ask a grown-up to connect, then try again." }); break;
      case "signedOut": setView({ v: "signedOut" }); break;
      case "failed": setView({ v: "failed" }); break;
      case "notFrontier": setView({ v: "ready" }); break;
    }
  };

  if (test.locked(perek) && verifiedAt === null) {
    return (
      <div className="celebrate" dir="ltr">
        <div className="big-emoji">🔒</div>
        <h2><bdi>פרק {hebNum(perek)}</bdi> is waiting for you!</h2>
        <p>First show Abba or Ima that you know the perek before it. Your stars here are all saved.</p>
        <button className="btn primary big" onClick={onMap}>🗺️ See my map</button>
      </div>
    );
  }

  if (view.v === "official") {
    return <OfficialBody name={name} perek={perek} nextLabel={nextLabel} onNext={onNext} onMap={onMap} />;
  }
  if (view.v === "already") {
    return (
      <div className="celebrate" dir="ltr">
        <div className="big-emoji">✔</div>
        <h2>Abba or Ima already tested you on this perek!</h2>
        <p><bdi>{MASECHTA.masechta} פרק {hebNum(perek)}</bdi> is officially done.</p>
        {onNext && <button className="btn primary big" onClick={onNext}>{nextLabel ?? "Keep going ›"}</button>}
        <button className={onNext ? "btn secondary" : "btn primary big"} onClick={onMap}>🗺️ See my map</button>
      </div>
    );
  }
  if (view.v === "signedOut") {
    return (
      <div className="celebrate" dir="ltr">
        <div className="big-emoji">🔑</div>
        <h2>Ask Abba or Ima to sign in again, then you can send your test.</h2>
        <button className="btn primary big" onClick={test.onParentArea}>Go to parent area</button>
        <button className="btn ghost-btn" onClick={() => setView({ v: "ready" })}>‹ Back</button>
      </div>
    );
  }
  if (view.v === "failed") {
    return (
      <div className="celebrate" dir="ltr">
        <div className="big-emoji">📮</div>
        <h2>Oops, the email didn't go through.</h2>
        <p>Let's try again in a minute.</p>
        <button className="btn primary big" disabled={!test.online} onClick={() => void send()}>Try again</button>
        <button className="btn ghost-btn" onClick={onMap}>My map</button>
      </div>
    );
  }
  if (view.v === "sending") {
    return (
      <div className="celebrate" dir="ltr" aria-live="polite">
        <div className="big-emoji spin" aria-hidden="true">📬</div>
        <h2>Sending…</h2>
      </div>
    );
  }
  if (view.v === "read") {
    return (
      <div className="perek-ready">
        <h2 className="task-title" dir="ltr">Read it through · <bdi>{MASECHTA.masechta} פרק {hebNum(perek)}</bdi></h2>
        <WholePerek perek={perek} />
        <div className="actions" dir="ltr">
          <button className="btn primary big" onClick={() => setView({ v: view.back })}>I read it ›</button>
        </div>
      </div>
    );
  }
  if (view.v === "say") {
    return (
      <div className="task">
        <h2 className="task-title" dir="ltr">Say it once by yourself</h2>
        <p className="task-sub" dir="ltr">Now say the whole perek by heart, like you will for Abba or Ima.</p>
        <Recite
          cards={cards}
          sections={sections}
          phases={[cards.map(() => 4 as Cue)]}
          prompts={["The whole perek, without looking! Tap a piece if you get stuck."]}
          onDone={(g, peeks) => {
            const n = peeks.reduce((a, b) => a + b, 0);
            onEvent?.({ type: "recite", task: "pre-test", perek, mishnah: null, step: null, grade: g, peeks: Math.min(10_000, n),
              ms: Math.min(3 * 3600_000, Math.max(0, Date.now() - sayStart.current)) });
            setView({ v: "ready", note: n <= 1 ? "Sounds ready! 🌟" : `You peeked ${n} times. Want to practice a little more first?` });
          }}
        />
      </div>
    );
  }

  if (view.v === "waiting") {
    const t = test.lastTest(perek);
    const now = test.serverNow();
    const left = t ? minutesLeft(t.nextAllowedAt, now) : 0;
    return (
      <div className="perek-ready waiting" dir="ltr">
        <div className="celebrate">
          <div className="big-emoji">📬</div>
          <h2>{view.cooldown ? "Your test was already sent a few minutes ago!" : "We sent your test to Abba or Ima!"}</h2>
          <p>
            When they test you and tap the link in the email,{" "}
            {np !== null ? <><bdi>פרק {hebNum(np)}</bdi> opens.</> : <><bdi>מסכת {MASECHTA.masechta}</bdi> is all done!</>}
            {t && <> Sent {agoText(t.sentAt, now)}.</>}
          </p>
          {!test.online && <p className="hint">Connect to the internet to see if Abba or Ima tested you.</p>}
          {test.devEmail && <p className="hint">(Dev: the link is in the Worker log.)</p>}
        </div>
        <div className="actions">
          <button className="btn primary big" onClick={() => setView({ v: "read", back: "waiting" })}>Practice while you wait</button>
          <button className="btn secondary" onClick={onMap}>My map</button>
          <button className="btn ghost-btn" disabled={left > 0 || !test.online} onClick={() => setView({ v: "confirm" })}>
            {left > 0 ? `You can send it again in ${left} min` : "Didn't get it? Send it again"}
          </button>
        </div>
        <GuestOffer onGuest={() => test.onGuest(np ?? perek)} />
      </div>
    );
  }

  // ready (and the confirm sheet over it)
  const note = view.v === "ready" ? view.note : undefined;
  return (
    <div className="perek-ready">
      {heading}
      <p className="hint" dir="ltr">You learned every mishnah. Let's get ready for your test.</p>
      <PerekStrip profile={profile} perek={perek} size="big" />
      <details className="look-over">
        <summary dir="ltr">Look it over first</summary>
        <WholePerek perek={perek} />
      </details>
      <div className="actions" dir="ltr">
        {note && <p className="ready-note" role="status">{note}</p>}
        <button className="btn primary big" disabled={!test.online} onClick={() => setView({ v: "confirm" })}>🎯 I'm ready to be tested</button>
        {!test.online && <p className="hint">Connect to the internet to send your test.</p>}
        <button className="btn secondary" onClick={() => { sayStart.current = Date.now(); setView({ v: "say" }); }}>Say it once by yourself</button>
        <button className="btn ghost-btn" onClick={onPracticeMore}>Practice more first</button>
      </div>
      {!test.online && <GuestOffer onGuest={() => test.onGuest(np ?? perek)} />}
      {view.v === "confirm" && (
        <div className="sheet-backdrop" role="dialog" aria-modal="true" aria-labelledby="send-title" onClick={() => setView({ v: "ready" })}>
          <div className="sheet" dir="ltr" onClick={(e) => e.stopPropagation()}>
            <h3 id="send-title">Send your test to Abba or Ima?</h3>
            <p>We'll email them the perek so they can listen to you say it. When they say you know it, the next perek opens!</p>
            <button className="btn primary big" disabled={!test.online} onClick={() => void send()}>📬 Yes, send it!</button>
            <button className="btn ghost-btn" onClick={() => setView({ v: "ready" })}>Not yet, I'll practice</button>
          </div>
        </div>
      )}
    </div>
  );
}

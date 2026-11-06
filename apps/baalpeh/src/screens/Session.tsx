import { useEffect, useMemo, useRef, useState } from "react";
import type { LearningEventBody, ReciteTask } from "../../shared/api";
import { ParentCheck } from "../components/ParentCheck";
import { PerekPath, perekGroups } from "../components/PerekPath";
import { PerekReady } from "../components/PerekReady";
import { PerekStrip } from "../components/PerekStrip";
import { ReadPhase } from "../components/ReadPhase";
import { Recite, type ReciteCard, type ReciteSection } from "../components/Recite";
import { StepPath } from "../components/StepPath";
import { getMishnah, hebNum, mishnayosOf, MASECHTA } from "../data";
import { partOf, perekParts, perekSteps, stepSelKey } from "../perekSteps";
import {
  checkPerek, completeStep, markDay, mp, nextInPerek, nextLearning, parentCheckMishnah, passPerekChain, perekDone, perekStage,
  reviewMishnah, reviewPerek, setStep, type Task,
} from "../progress";
import { isDue } from "../srs";
import { buildSteps, groupIndexOf } from "../steps";
import type { Cue, Grade, Profile, Step } from "../types";

interface Props {
  profile: Profile;
  tasks: Task[];
  onProfile: (p: Profile) => void;
  /** ✕: back to where the session was started from. */
  onExit: () => void;
  /** Go to the perek map (the end of a session, or the child chooses to stop). */
  onMap: () => void;
  /** Called when the queue runs out; may return more tasks (e.g. next learning). */
  more?: (p: Profile) => Task | null;
  /** What "keep going" offers after a celebration when the queue is empty (default nextLearning; the perek screen scopes it). */
  upNextOf?: (p: Profile) => Task | null;
  /** Practice log (instrumentation only; no effect on the screens). */
  onEvent?: (e: LearningEventBody) => void;
}

type Emit = (e: LearningEventBody) => void;

const MAX_MS = 3 * 60 * 60 * 1000;
const elapsed = (since: number): number => Math.min(MAX_MS, Math.max(0, Math.round(Date.now() - since)));
const sum = (xs: number[]): number => Math.min(10_000, xs.reduce((a, b) => a + b, 0));

function recite(
  task: ReciteTask, perek: number, mishnah: number | null, step: number | null, grade: Grade, peeks: number[], since: number,
  range?: { from: number; to: number },
): LearningEventBody {
  return { type: "recite", task, perek, mishnah, step, grade, peeks: sum(peeks), ms: elapsed(since), ...(range ? { from: range.from, to: range.to } : {}) };
}

const mishnayosWord = (from: number, to: number): string => (from === to ? `mishnah ${from}` : `mishnayos ${from}–${to}`);

const ref = (perek: number, mishnah?: number) =>
  `${MASECHTA.masechta} ${hebNum(perek)}${mishnah !== undefined ? `:${hebNum(mishnah)}` : ""}`;

/** "mishnah": a mishnah was just learned. "chain": perek mishnayos were said together. "perek": a whole perek was finished. */
type Milestone = "mishnah" | "chain" | "perek";
interface Celebration {
  title: string; sub: string; stars: number; milestone?: Milestone;
  /** A natural stopping point (a part of the perek done): the map is the main button. */
  stop?: boolean;
  /** Show the perek strip, with these joins snapping in. */
  strip?: { perek: number; justJoined: number[] };
}

type View =
  | { v: "task" }
  | ({ v: "celebrate" } & Celebration)
  | { v: "break" }
  /** A practice run of a known mishnah finished. */
  | { v: "practiced" }
  | { v: "empty" };

export function Session({ profile, tasks, onProfile, onExit, onMap, more, upNextOf, onEvent }: Props) {
  const [queue, setQueue] = useState<Task[]>(tasks);
  const [view, setView] = useState<View>(tasks.length ? { v: "task" } : { v: "empty" });
  /** Bumped by "Practice it again" to restart a practice run. */
  const [round, setRound] = useState(0);
  /** Where a practice run is, kept here so the break screen doesn't lose it. Null = its first step. */
  const [practiceAt, setPracticeAt] = useState<number | null>(null);
  const started = useRef(Date.now());
  const stepsThisSession = useRef(0);
  const breakShown = useRef(false);
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;
  const emit: Emit = (e) => onEventRef.current?.(e);

  const task = queue[0];
  const taskStart = useRef(Date.now());
  useEffect(() => { taskStart.current = Date.now(); }, [task, view.v]);

  // One session event when the session screen closes (ignores very short visits).
  useEffect(() => {
    const startedAt = started.current;
    return () => {
      const ms = Date.now() - startedAt;
      if (ms >= 5000) onEventRef.current?.({ type: "session", startedAt, ms: Math.min(ms, MAX_MS), steps: stepsThisSession.current });
    };
  }, []);

  const save = (p: Profile) => onProfile(markDay(p));

  const finishTask = (p: Profile, celebrate?: Celebration) => {
    save(p);
    const rest = queue.slice(1);
    const extra = rest.length === 0 && more ? more(p) : null;
    setQueue(extra ? [extra] : rest);
    if (celebrate) setView({ v: "celebrate", ...celebrate });
    else setView(rest.length || extra ? { v: "task" } : { v: "empty" });
  };

  /** Shows the break screen once per session, only if the parent turned break suggestions on. */
  const showBreakIfDue = (): boolean => {
    const after = profile.settings.breakMinutes;
    if (after === undefined || breakShown.current) return false;
    if ((Date.now() - started.current) / 60000 < after) return false;
    breakShown.current = true;
    setView({ v: "break" });
    return true;
  };

  /** What "keep going" leads to after a celebration: the queued task, or else the next new learning. */
  const upNext: Task | null = queue[0] ?? (upNextOf ?? nextLearning)(profile);

  const afterCelebrate = () => {
    if (!queue.length && upNext) setQueue([upNext]);
    if (showBreakIfDue()) return;
    setView(queue.length || upNext ? { v: "task" } : { v: "empty" });
  };

  const mapBtn = (primary: boolean) => (
    <button className={primary ? "btn primary big" : "btn ghost-btn"} onClick={onMap}>
      {primary ? "🗺️ See my map" : "My map"}
    </button>
  );
  const nextLabel = (t: Task): string =>
    t.type === "learn" ? `Next: mishnah ${t.mishnah} ›`
      : t.type === "perek-chain" ? `Say ${mishnayosWord(t.from, t.to)} together ›`
      : t.type === "perek-finish" ? "Finish the perek ›"
      : "Keep going ›";

  const onStepPassed = () => {
    stepsThisSession.current += 1;
    showBreakIfDue();
  };

  let body: JSX.Element;
  if (view.v === "celebrate") {
    const nextBtn = (primary: boolean) => upNext && (
      <button className={primary ? "btn primary big" : "btn secondary"} onClick={afterCelebrate}>{nextLabel(upNext)}</button>
    );
    body = (
      <div className="celebrate" dir="ltr">
        <div className="big-emoji">{view.stars === 0 ? "💪" : "⭐".repeat(view.stars)}</div>
        <h2>{view.title}</h2>
        <p>{view.sub}</p>
        {view.strip && (
          <div dir="rtl" className="celebrate-strip">
            <PerekStrip profile={profile} perek={view.strip.perek} size="big" next={upNext} justJoined={view.strip.justJoined} />
          </div>
        )}
        {view.milestone === "perek" || !upNext ? (
          // A finished perek (or nothing left): the map is where the new gold row is.
          mapBtn(true)
        ) : view.milestone === "chain" && !view.stop ? (
          // Mid-perek chain: keep building is primary.
          <>
            {nextBtn(true)}
            {mapBtn(false)}
          </>
        ) : view.milestone === "mishnah" || view.milestone === "chain" || !queue.length ? (
          // A finished mishnah (or part) is a natural stop: the map first, the next one second.
          <>
            {mapBtn(true)}
            {nextBtn(false)}
          </>
        ) : (
          // Mid-queue (today's reviews still waiting): keep going is primary.
          <>
            <button className="btn primary big" onClick={afterCelebrate}>Continue</button>
            {mapBtn(false)}
          </>
        )}
      </div>
    );
  } else if (view.v === "break") {
    body = (
      <div className="celebrate" dir="ltr">
        <div className="big-emoji">🌙</div>
        <h2>Great work, {profile.name}!</h2>
        <p>You learned for {profile.settings.breakMinutes} minutes. Time for a break.</p>
        <button className="btn primary big" onClick={onMap}>Take a break</button>
        <button className="btn ghost-btn" onClick={() => setView(queue.length ? { v: "task" } : { v: "empty" })}>Keep going</button>
      </div>
    );
  } else if (view.v === "practiced" && task?.type === "practice") {
    const st = mp(profile, task.perek, task.mishnah);
    const reviewDue = isDue(st.review) && !perekDone(profile, task.perek);
    const back = <button className={reviewDue ? "btn secondary" : "btn primary big"} onClick={onExit}>‹ Back to the mishnah</button>;
    body = (
      <div className="celebrate" dir="ltr">
        <div className="big-emoji">👍</div>
        <h2>Nice practice!</h2>
        <p>{task.label} · <bdi>{ref(task.perek, task.mishnah)}</bdi></p>
        {reviewDue ? (
          // The real test is waiting today: offer it first.
          <>
            <button className="btn primary big" onClick={() => { setQueue([{ type: "review-m", perek: task.perek, mishnah: task.mishnah }]); setView({ v: "task" }); }}>
              🔁 Review it now
            </button>
            {back}
          </>
        ) : back}
        <button className="btn ghost-btn" onClick={() => { setPracticeAt(null); setRound((r) => r + 1); setView({ v: "task" }); }}>Practice it again</button>
      </div>
    );
  } else if (view.v === "practiced" && task?.type === "perek-practice") {
    body = (
      <div className="celebrate" dir="ltr">
        <div className="big-emoji">👍</div>
        <h2>Nice practice!</h2>
        <p>{task.label} · <bdi>{ref(task.perek)}</bdi></p>
        <button className="btn primary big" onClick={onExit}>‹ Back to the perek</button>
        <button className="btn ghost-btn" onClick={() => { setRound((r) => r + 1); setView({ v: "task" }); }}>Practice it again</button>
      </div>
    );
  } else if (view.v === "empty" || !task) {
    body = (
      <div className="celebrate" dir="ltr">
        <div className="big-emoji">🎉</div>
        <h2>All done!</h2>
        <p>Nothing else to do right now.</p>
        {mapBtn(true)}
      </div>
    );
  } else if (task.type === "learn") {
    body = (
      <LearnTask
        key={`${task.perek}:${task.mishnah}`}
        profile={profile}
        perek={task.perek}
        mishnah={task.mishnah}
        onProfile={save}
        onStepPassed={onStepPassed}
        onEvent={emit}
        onFinished={(p, g) =>
          g === "notyet"
            ? save(p)
            : finishTask(p, {
              title: `You know ${ref(task.perek, task.mishnah)}!`, sub: "It goes on your perek map. We'll review it soon so it stays strong.",
              stars: 1, milestone: "mishnah", strip: { perek: task.perek, justJoined: [] },
            })
        }
      />
    );
  } else if (task.type === "practice") {
    body = (
      <PracticeTask
        key={`${task.perek}:${task.mishnah}:${task.from}-${task.to}:${round}`}
        profile={profile}
        perek={task.perek}
        mishnah={task.mishnah}
        from={task.from}
        to={task.to}
        label={task.label}
        at={practiceAt}
        onAt={setPracticeAt}
        onProfile={save}
        onStepPassed={onStepPassed}
        onEvent={emit}
        onDone={() => setView({ v: "practiced" })}
      />
    );
  } else if (task.type === "review-m") {
    const m = getMishnah(task.perek, task.mishnah);
    body = (
      <TaskFrame title={`Review · ${ref(task.perek, task.mishnah)}`}>
        <Recite
          key={`r${task.perek}:${task.mishnah}`}
          cards={m.chunks}
          phases={[m.chunks.map(() => 4 as Cue)]}
          prompts={["Say the whole mishnah by heart."]}
          onDone={(g, peeks) => {
            emit(recite("review-m", task.perek, task.mishnah, null, g, peeks, taskStart.current));
            finishTask(reviewMishnah(profile, task.perek, task.mishnah, g), g === "notyet"
            ? { title: "Let's practice this one again", sub: "It will come back tomorrow.", stars: 0 }
            : { title: "Still strong!", sub: ref(task.perek, task.mishnah), stars: g === "pass" ? 2 : 1 });
          }}
        />
      </TaskFrame>
    );
  } else if (task.type === "perek-chain" || task.type === "perek-practice") {
    const practice = task.type === "perek-practice";
    const { perek, from, to } = task;
    body = (
      <PerekStepTask
        key={`${task.type}${perek}:${from}-${to}:${round}`}
        profile={profile}
        perek={perek}
        from={from}
        to={to}
        label={practice ? task.label : perekSteps(perek).find((s) => s.kind === "chain" && s.from === from && s.to === to)?.label ?? `Mishnayos ${from}–${to} together`}
        practice={practice}
        onEvent={emit}
        onPassed={() => {
          stepsThisSession.current += 1;
          if (practice) { save(profile); setView({ v: "practiced" }); return; }
          const p2 = passPerekChain(profile, perek, from, to);
          if (perekStage(p2, perek) === "ready") {
            // The whole perek is built: straight on to "ready to be tested".
            save(p2);
            setQueue([{ type: "perek-finish", perek }, ...queue.slice(1)]);
            setView({ v: "task" });
            return;
          }
          const n = mishnayosOf(perek).length;
          const parts = perekParts(n);
          const part = partOf(n, from, to);
          const partNo = part ? parts.findIndex(([a]) => a === part[0]) + 1 : 0;
          const partEnd = parts.length > 1 && part !== null && part[0] === from && part[1] === to;
          const justJoined = Array.from({ length: to - from }, (_, i) => from + 1 + i);
          finishTask(p2, {
            title: partEnd ? `Part ${partNo} of the perek — done!` : `${from === to ? `Mishnah ${from}` : `Mishnayos ${from}–${to}`} together!`,
            sub: ref(perek), stars: 1, milestone: "chain", stop: partEnd, strip: { perek, justJoined },
          });
        }}
      />
    );
  } else if (task.type === "perek-finish") {
    const { perek } = task;
    body = perekStage(profile, perek) === "building" ? (
      <div className="celebrate" dir="ltr">
        <div className="big-emoji">🧱</div>
        <h2>Finish every step first</h2>
        <p><bdi>{ref(perek)}</bdi></p>
        {(() => {
          const t = nextInPerek(profile, perek);
          return t ? <button className="btn primary big" onClick={() => setQueue([t, ...queue.slice(1)])}>{nextLabel(t)}</button> : mapBtn(true);
        })()}
      </div>
    ) : (
      <PerekFinishTask
        key={`finish${perek}`}
        profile={profile}
        perek={perek}
        onEvent={emit}
        onPracticeMore={onExit}
        onChecked={(g) => {
          // The one place the in-app check makes a perek complete. Roadmap item 2 replaces it with email verification.
          const p2 = checkPerek(profile, perek, g);
          finishTask(p2, g === "notyet"
            ? { title: "Almost!", sub: "Practice the whole perek and try again.", stars: 0 }
            : { title: `You finished ${ref(perek)}!`, sub: "You can say the whole perek in one shot. Mazel tov!", stars: 3, milestone: "perek" });
        }}
      />
    );
  } else {
    body = (
      <PerekReviewTask
        key={`review-p${task.perek}`}
        perek={task.perek}
        onEvent={emit}
        onDone={(g, slippedMishnayos) =>
          finishTask(reviewPerek(profile, task.perek, g, slippedMishnayos), { title: g === "notyet" ? "Good try!" : "The whole perek — still strong!", sub: ref(task.perek), stars: g === "pass" ? 2 : 1 })}
      />
    );
  }

  return (
    <div className="session">
      <div className="topbar" dir="ltr">
        <button className="btn ghost-btn small" onClick={onExit}>✕</button>
        <span className="who" style={{ color: profile.color }}>{profile.emoji} {profile.name}</span>
      </div>
      {body}
    </div>
  );
}

function TaskFrame({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="task">
      <h2 className="task-title">{title}</h2>
      {children}
    </div>
  );
}

/** Runs the chaining steps of one mishnah from where the child left off, then a parent check. */
function LearnTask({ profile, perek, mishnah, onProfile, onStepPassed, onFinished, onEvent }: {
  profile: Profile; perek: number; mishnah: number;
  onProfile: (p: Profile) => void; onStepPassed: () => void;
  onFinished: (p: Profile, g: Grade) => void;
  onEvent: Emit;
}) {
  const m = getMishnah(perek, mishnah);
  const steps = useMemo(() => buildSteps(m.chunks), [m]);
  const stepIndex = mp(profile, perek, mishnah).stepIndex;
  /** Bumped on every jump, so tapping the current step starts it over. */
  const [visit, setVisit] = useState(0);

  /** Free navigation: any step, back or forward (steps.length = the parent check). */
  const goTo = (i: number) => {
    setVisit((v) => v + 1);
    onProfile(setStep(profile, perek, mishnah, i));
  };
  const path = <StepPath steps={steps} chunks={m.chunks} current={stepIndex} onJump={goTo} />;

  if (stepIndex >= steps.length) {
    return (
      <div className="task">
        {path}
        {/* Right to left like the Hebrew: Back on the right, Next on the left (as in the word panel). */}
        <div className="step-nav">
          <button className="btn ghost-btn small" dir="ltr" onClick={() => goTo(steps.length - 1)}>Back ›</button>
          <div className="step-label" dir="ltr">Show Abba or Ima</div>
          <span className="btn small" aria-hidden="true" style={{ visibility: "hidden" }}>‹ Next</span>
        </div>
        <ParentCheck
          title={`${ref(perek, mishnah)} — the whole mishnah`}
          cards={m.chunks}
          onDone={(g, slipped, slipWords) => {
            onEvent({ type: "check", scope: "mishnah", perek, mishnah, through: null, grade: g, slipped, slipWords });
            const p = parentCheckMishnah(profile, perek, mishnah, g);
            onProfile(p);
            onFinished(p, g);
          }}
        />
      </div>
    );
  }

  return (
    <StepRunner
      key={`${stepIndex}:${visit}`}
      profile={profile}
      perek={perek}
      mishnah={mishnah}
      steps={steps}
      index={stepIndex}
      title={ref(perek, mishnah)}
      path={path}
      atStart={stepIndex === 0}
      onBack={() => goTo(stepIndex - 1)}
      onNext={() => goTo(stepIndex + 1)}
      onPassed={() => {
        onProfile(completeStep(profile, perek, mishnah).profile);
        onStepPassed();
      }}
      onProfile={onProfile}
      onEvent={onEvent}
    />
  );
}

/**
 * Extra practice of steps from..to of a known mishnah. Same screens as learning, but the position lives
 * here, not in the profile: practice never changes the mishnah's step, state or review, and has no parent check.
 */
function PracticeTask({ profile, perek, mishnah, from, to, label, at, onAt, onProfile, onStepPassed, onDone, onEvent }: {
  profile: Profile; perek: number; mishnah: number; from: number; to: number; label: string;
  at: number | null; onAt: (i: number) => void;
  onProfile: (p: Profile) => void; onStepPassed: () => void; onDone: () => void; onEvent: Emit;
}) {
  const m = getMishnah(perek, mishnah);
  const steps = useMemo(() => buildSteps(m.chunks), [m]);
  const lo = Math.max(0, Math.min(from, steps.length - 1));
  const hi = Math.max(lo, Math.min(to, steps.length - 1));
  const index = at === null ? lo : Math.max(lo, Math.min(hi, at));
  const [visit, setVisit] = useState(0);
  const goTo = (i: number) => {
    if (i > hi) { onDone(); return; }
    onAt(Math.max(lo, i));
    setVisit((v) => v + 1);
  };
  const path = <StepPath steps={steps} chunks={m.chunks} current={index} finished caption={hi > lo ? `Step ${index - lo + 1} of ${hi - lo + 1}` : ""} />;
  return (
    <StepRunner
      key={`${index}:${visit}`}
      profile={profile}
      perek={perek}
      mishnah={mishnah}
      steps={steps}
      index={index}
      title={`${ref(perek, mishnah)} · Practice`}
      subtitle={label}
      path={path}
      atStart={index === lo}
      onBack={() => goTo(index - 1)}
      onNext={() => goTo(index + 1)}
      onPassed={() => {
        onProfile(profile); // marks the day; nothing else changes
        onStepPassed();
        goTo(index + 1);
      }}
      onProfile={onProfile}
      onEvent={onEvent}
      practice
    />
  );
}

/**
 * One step of a mishnah: read then recall a new piece, or say a range together (with a detour on the
 * hardest piece after "not yet"). Keyed by the caller per visit, so a new step starts fresh.
 */
function StepRunner({ profile, perek, mishnah, steps, index, title, subtitle, path, atStart, onBack, onNext, onPassed, onProfile, onEvent, practice = false }: {
  profile: Profile; perek: number; mishnah: number; steps: Step[]; index: number;
  title: string; subtitle?: string; path: React.ReactNode; atStart: boolean;
  onBack: () => void; onNext: () => void; onPassed: () => void;
  onProfile: (p: Profile) => void; onEvent: Emit; practice?: boolean;
}) {
  const m = getMishnah(perek, mishnah);
  const [phase, setPhase] = useState<"read" | "recall">("read");
  const [detour, setDetour] = useState<Step | null>(null);
  const [attempt, setAttempt] = useState(0);

  const step: Step | undefined = detour ?? steps[index];
  const stepStart = useRef(Date.now());
  useEffect(() => { stepStart.current = Date.now(); }, [phase, attempt, detour]);
  if (!step) return null;

  const restart = () => { setPhase("read"); setAttempt((a) => a + 1); };
  const passed = () => {
    if (detour) { setDetour(null); restart(); return; }
    onPassed();
  };
  const taskOf = (kind: "learn" | "chain"): ReciteTask => (detour ? "detour" : practice ? "practice" : kind);

  const header = (
    <>
      <h2 className="task-title">{title}</h2>
      {subtitle && <p className="task-sub" dir="ltr">{subtitle}</p>}
      {path}
      {/* Right to left like the Hebrew: Back on the right, Next on the left (as in the word panel). */}
      <div className="step-nav">
        <button className="btn ghost-btn small" dir="ltr" disabled={atStart && !detour} onClick={() => (detour ? (setDetour(null), restart()) : onBack())}>Back ›</button>
        {/* The part pill and "Piece k of n" counter above say which part; the label just names the task. */}
        <div className="step-label" dir="ltr">{detour ? "Extra practice" : step.label.replace(/^Part \d+ · /, "")}</div>
        <button className="btn ghost-btn small" dir="ltr" onClick={onNext}>‹ Next</button>
      </div>
    </>
  );

  if (step.kind === "learn") {
    const chunk = m.chunks[step.chunk];
    if (!chunk) return null;
    return (
      <div className="task">
        {header}
        {phase === "read" ? (
          <ReadPhase
            key={`read${attempt}`}
            chunk={chunk}
            perek={perek}
            mishnah={mishnah}
            view={profile.settings.meaningView ?? "simple"}
            onView={(v) => onProfile({ ...profile, settings: { ...profile.settings, meaningView: v } })}
            onDone={() => setPhase("recall")}
          />
        ) : (
          <Recite
            key={`rec${attempt}`}
            cards={[chunk]}
            phases={[[2], [4]]}
            prompts={["Say it. The first letters will help.", "Now say it without looking!"]}
            newest={0}
            onDone={(g, peeks) => {
              onEvent(recite(taskOf("learn"), perek, mishnah, index, g, peeks, stepStart.current));
              if (g === "notyet") { restart(); return; }
              passed();
            }}
          />
        )}
      </div>
    );
  }

  const range = m.chunks.slice(step.from, step.to + 1);
  const newestIdx = step.newest - step.from;
  return (
    <div className="task">
      {header}
      <Recite
        key={`chain${attempt}`}
        cards={range}
        phases={[range.map((_, i) => (i === newestIdx ? 2 : 3) as Cue), range.map(() => 4 as Cue)]}
        prompts={["Say it all from the beginning.", "Now all of it — without looking!"]}
        newest={newestIdx}
        onDone={(g, peeks) => {
          onEvent(recite(taskOf("chain"), perek, mishnah, index, g, peeks, stepStart.current));
          if (g !== "notyet") { passed(); return; }
          // Detour: drill the hardest piece with the one before it, then come back.
          let worst = 0;
          peeks.forEach((v, i) => { if (v > (peeks[worst] ?? 0)) worst = i; });
          const to = step.from + worst;
          const from = Math.max(step.from, to - 1);
          setDetour({ kind: "chain", from, to, newest: to, label: "Extra practice" });
          setAttempt((a) => a + 1);
        }}
      />
    </div>
  );
}

/** The mishnayos from..to of a perek as phrase cards, one section per mishnah. */
function perekCards(perek: number, from: number, to: number): { cards: ReciteCard[]; sections: ReciteSection[]; mishnayos: number[] } {
  const cards: ReciteCard[] = [];
  const sections: ReciteSection[] = [];
  const mishnayos: number[] = [];
  for (const m of mishnayosOf(perek)) {
    if (m.mishnah < from || m.mishnah > to) continue;
    const start = cards.length;
    for (const c of m.chunks) cards.push({ he: c.he });
    sections.push({ label: `משנה ${hebNum(m.mishnah)}`, start, end: cards.length });
    mishnayos.push(m.mishnah);
  }
  return { cards, sections, mishnayos };
}

/**
 * A perek build-up chain step (or practice of a range of known mishnayos): say mishnayos from..to together,
 * phrase by phrase, warm-up then test. Self-checked like a chain step inside a mishnah: "not yet" detours to the
 * hardest mishnah with the one before it, then retries. No Back/Next here; free navigation is on the perek screen.
 */
function PerekStepTask({ profile, perek, from, to, label, practice, onPassed, onEvent }: {
  profile: Profile; perek: number; from: number; to: number; label: string; practice: boolean;
  onPassed: () => void; onEvent: Emit;
}) {
  const [detour, setDetour] = useState<{ from: number; to: number } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const start = useRef(Date.now());
  useEffect(() => { start.current = Date.now(); }, [attempt, detour]);

  const n = mishnayosOf(perek).length;
  const steps = perekSteps(perek);
  const stepIndex = steps.findIndex((s) => (from === to ? s.kind === "mishnah" && s.mishnah === from : s.kind === "chain" && s.from === from && s.to === to));
  const groups = perekGroups(perek);
  const group = stepIndex >= 0 ? groupIndexOf(groups, stepIndex) : -1;
  const step = steps[stepIndex];

  const r = detour ?? { from, to };
  const { cards, sections, mishnayos } = useMemo(() => perekCards(perek, r.from, r.to), [perek, r.from, r.to]);
  const join = !detour && r.from !== r.to && (partOf(n, r.from, r.to) === null || (r.from === 1 && r.to === n));
  const newestSec = sections[sections.length - 1];
  const firsts = new Set(sections.map((s) => s.start));
  const warm: Cue[] = cards.map((_, i): Cue => {
    if (r.from === r.to) return detour ? 2 : 3;
    if (join) return firsts.has(i) ? 3 : 4;
    return newestSec && i >= newestSec.start ? 2 : 3;
  });
  const newest = !join && r.from !== r.to && newestSec
    ? Array.from({ length: newestSec.end - newestSec.start }, (_, i) => newestSec.start + i)
    : undefined;
  const what = mishnayosWord(r.from, r.to);

  return (
    <div className="task">
      <h2 className="task-title">{ref(perek)} · <bdi dir="ltr">{label}</bdi></h2>
      {(practice || detour) && <p className="task-sub" dir="ltr">{detour ? "Extra practice" : "Practice"}</p>}
      <div dir="rtl">
        <PerekPath profile={profile} perek={perek} group={group >= 0 ? group : undefined} sel={step ? stepSelKey(step) : null} caption={detour ? `Extra practice: ${what}` : ""} />
      </div>
      <Recite
        key={`perek${attempt}`}
        cards={cards}
        sections={sections}
        phases={[warm, cards.map(() => 4 as Cue)]}
        prompts={[
          `Say ${what} from the beginning. The first word of each ${join ? "mishnah" : "piece"} will help.`,
          "Now all of it, without looking! Tap a piece if you get stuck.",
        ]}
        newest={newest}
        onDone={(g, peeks) => {
          const task: ReciteTask = detour ? "detour" : practice ? "practice" : "perek-chain";
          onEvent(recite(task, perek, null, detour || practice || stepIndex < 0 ? null : stepIndex, g, peeks, start.current, r));
          if (g !== "notyet") {
            if (detour) { setDetour(null); setAttempt((a) => a + 1); return; }
            onPassed();
            return;
          }
          // Detour: the mishnah with the most peeks, with the one before it; then the original step again.
          let worst = mishnayos[0] ?? r.from;
          let most = -1;
          sections.forEach((s, i) => {
            const total = peeks.slice(s.start, s.end).reduce((a, b) => a + b, 0);
            if (total > most) { most = total; worst = mishnayos[i] ?? worst; }
          });
          setDetour({ from: Math.max(r.from, worst - 1), to: worst });
          setAttempt((a) => a + 1);
        }}
      />
    </div>
  );
}

/** "I'm ready to be tested": the end of the build-up, then (today) the in-app parent check of the whole perek. */
function PerekFinishTask({ profile, perek, onChecked, onPracticeMore, onEvent }: {
  profile: Profile; perek: number; onChecked: (g: Grade) => void; onPracticeMore: () => void; onEvent: Emit;
}) {
  const [stage, setStage] = useState<"ready" | "check">("ready");
  const list = mishnayosOf(perek);
  if (stage === "ready") {
    return <PerekReady profile={profile} perek={perek} onReady={() => setStage("check")} onPracticeMore={onPracticeMore} />;
  }
  const cards = list.map((m) => ({ he: m.chunks.map((c) => c.he).join(" "), label: `משנה ${hebNum(m.mishnah)}` }));
  return (
    <div className="task">
      <ParentCheck
        title={`${ref(perek)} — the whole perek`}
        cards={cards}
        onDone={(g, slippedCards, slipWords) => {
          const slipped = slippedCards.map((i) => list[i]?.mishnah ?? 0).filter(Boolean);
          onEvent({ type: "check", scope: "chain", perek, mishnah: null, through: list.length, grade: g, slipped, slipWords });
          onChecked(g);
        }}
      />
    </div>
  );
}

/** Perek review: one card per mishnah, said by heart, then the parent check. */
function PerekReviewTask({ perek, onDone, onEvent }: {
  perek: number; onDone: (g: Grade, slipped: number[]) => void; onEvent: Emit;
}) {
  const list = mishnayosOf(perek);
  const cards = list.map((m) => ({ he: m.chunks.map((c) => c.he).join(" "), label: `משנה ${hebNum(m.mishnah)}` }));
  const [stage, setStage] = useState<"recite" | "check">("recite");
  const start = useRef(Date.now());
  const title = `Perek review · ${ref(perek)}`;
  return (
    <div className="task">
      <h2 className="task-title">{title}</h2>
      {stage === "recite" ? (
        <Recite
          cards={cards}
          phases={[cards.map(() => 4 as Cue)]}
          prompts={["Say the whole perek by heart."]}
          onDone={(g, peeks) => {
            onEvent(recite("review-p", perek, null, null, g, peeks, start.current));
            setStage("check");
          }}
        />
      ) : (
        <ParentCheck
          title={title}
          cards={cards}
          onDone={(g, slippedCards, slipWords) => {
            const slipped = slippedCards.map((i) => list[i]?.mishnah ?? 0).filter(Boolean);
            onEvent({ type: "check", scope: "review-p", perek, mishnah: null, through: null, grade: g, slipped, slipWords });
            onDone(g, slipped);
          }}
        />
      )}
    </div>
  );
}

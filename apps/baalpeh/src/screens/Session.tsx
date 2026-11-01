import { useMemo, useRef, useState } from "react";
import { ParentCheck } from "../components/ParentCheck";
import { ReadPhase } from "../components/ReadPhase";
import { Recite } from "../components/Recite";
import { StepPath } from "../components/StepPath";
import { getMishnah, hebNum, mishnayosOf, MASECHTA } from "../data";
import {
  completeStep, markDay, mp, parentCheckChain, parentCheckMishnah, reviewMishnah, reviewPerek, type Task,
} from "../progress";
import { buildSteps } from "../steps";
import type { Cue, Grade, Profile, Step } from "../types";

interface Props {
  profile: Profile;
  tasks: Task[];
  onProfile: (p: Profile) => void;
  onExit: () => void;
  /** Called when the queue runs out; may return more tasks (e.g. next learning). */
  more?: (p: Profile) => Task | null;
}

const ref = (perek: number, mishnah?: number) =>
  `${MASECHTA.masechta} ${hebNum(perek)}${mishnah !== undefined ? `:${hebNum(mishnah)}` : ""}`;

type View =
  | { v: "task" }
  | { v: "celebrate"; title: string; sub: string; stars: number }
  | { v: "breather" }
  | { v: "timeup" }
  | { v: "empty" };

export function Session({ profile, tasks, onProfile, onExit, more }: Props) {
  const [queue, setQueue] = useState<Task[]>(tasks);
  const [view, setView] = useState<View>(tasks.length ? { v: "task" } : { v: "empty" });
  const started = useRef(Date.now());
  const stepsThisSession = useRef(0);
  const timeUpShown = useRef(false);

  const task = queue[0];

  const save = (p: Profile) => onProfile(markDay(p));

  const finishTask = (p: Profile, celebrate?: { title: string; sub: string; stars: number }) => {
    save(p);
    const rest = queue.slice(1);
    const extra = rest.length === 0 && more ? more(p) : null;
    setQueue(extra ? [extra] : rest);
    if (celebrate) setView({ v: "celebrate", ...celebrate });
    else setView(rest.length || extra ? { v: "task" } : { v: "empty" });
  };

  const afterCelebrate = () => {
    const minutes = (Date.now() - started.current) / 60000;
    if (!timeUpShown.current && minutes >= profile.settings.dailyMinutes) {
      timeUpShown.current = true;
      setView({ v: "timeup" });
      return;
    }
    setView(queue.length ? { v: "task" } : { v: "empty" });
  };

  const onStepPassed = () => {
    stepsThisSession.current += 1;
    const minutes = (Date.now() - started.current) / 60000;
    if (!timeUpShown.current && minutes >= profile.settings.dailyMinutes) {
      timeUpShown.current = true;
      setView({ v: "timeup" });
    } else if (stepsThisSession.current % 4 === 0) {
      setView({ v: "breather" });
    }
  };

  let body: JSX.Element;
  if (view.v === "celebrate") {
    body = (
      <div className="celebrate" dir="ltr">
        <div className="big-emoji">{view.stars === 0 ? "💪" : "⭐".repeat(view.stars)}</div>
        <h2>{view.title}</h2>
        <p>{view.sub}</p>
        <button className="btn primary big" onClick={afterCelebrate}>Continue</button>
        <button className="btn ghost-btn" onClick={onExit}>Done for now</button>
      </div>
    );
  } else if (view.v === "breather") {
    body = (
      <div className="celebrate" dir="ltr">
        <div className="big-emoji">🌬️</div>
        <h2>Great work, {profile.name}!</h2>
        <p>Take a breath. Keep going?</p>
        <button className="btn primary big" onClick={() => setView({ v: "task" })}>Keep going</button>
        <button className="btn ghost-btn" onClick={onExit}>Stop for today</button>
      </div>
    );
  } else if (view.v === "timeup") {
    body = (
      <div className="celebrate" dir="ltr">
        <div className="big-emoji">🌙</div>
        <h2>That's today's learning!</h2>
        <p>You did {profile.settings.dailyMinutes} minutes. Stopping now helps you remember better tomorrow.</p>
        <button className="btn primary big" onClick={onExit}>Finish</button>
        <button className="btn ghost-btn" onClick={() => setView(queue.length ? { v: "task" } : { v: "empty" })}>A little more</button>
      </div>
    );
  } else if (view.v === "empty" || !task) {
    body = (
      <div className="celebrate" dir="ltr">
        <div className="big-emoji">🎉</div>
        <h2>All done!</h2>
        <p>Nothing else to do right now.</p>
        <button className="btn primary big" onClick={onExit}>Back home</button>
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
        onFinished={(p, g) =>
          g === "notyet"
            ? save(p)
            : finishTask(p, { title: `You know ${ref(task.perek, task.mishnah)}!`, sub: "It goes on your perek map. We'll review it soon so it stays strong.", stars: 1 })
        }
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
          onDone={(g) => finishTask(reviewMishnah(profile, task.perek, task.mishnah, g), g === "notyet"
            ? { title: "Let's practice this one again", sub: "It will come back tomorrow.", stars: 0 }
            : { title: "Still strong!", sub: ref(task.perek, task.mishnah), stars: g === "pass" ? 2 : 1 })}
        />
      </TaskFrame>
    );
  } else {
    body = (
      <PerekChainTask
        key={`${task.type}${task.perek}`}
        perek={task.perek}
        through={task.type === "perek-chain" ? task.through : mishnayosOf(task.perek).length}
        review={task.type === "review-p"}
        onDone={(g, slippedMishnayos) => {
          if (task.type === "review-p") {
            finishTask(reviewPerek(profile, task.perek, g, slippedMishnayos), { title: g === "notyet" ? "Good try!" : "The whole perek — still strong!", sub: ref(task.perek), stars: g === "pass" ? 2 : 1 });
            return;
          }
          const through = task.through;
          const count = mishnayosOf(task.perek).length;
          if (g === "notyet") { finishTask(profile, { title: "Almost!", sub: "We'll try the chain again next time.", stars: 0 }); return; }
          const p2 = parentCheckChain(profile, task.perek, through, g);
          finishTask(p2, through >= count
            ? { title: `You finished ${ref(task.perek)}!`, sub: "You can say the whole perek in one shot. Mazel tov!", stars: 3 }
            : { title: `Mishnayos 1–${through} in a row!`, sub: ref(task.perek), stars: 1 });
        }}
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
function LearnTask({ profile, perek, mishnah, onProfile, onStepPassed, onFinished }: {
  profile: Profile; perek: number; mishnah: number;
  onProfile: (p: Profile) => void; onStepPassed: () => void;
  onFinished: (p: Profile, g: Grade) => void;
}) {
  const m = getMishnah(perek, mishnah);
  const steps = useMemo(() => buildSteps(m.chunks), [m]);
  const stepIndex = mp(profile, perek, mishnah).stepIndex;
  const [phase, setPhase] = useState<"read" | "recall">("read");
  const [detour, setDetour] = useState<Step | null>(null);
  const [attempt, setAttempt] = useState(0);

  const step: Step | undefined = detour ?? steps[stepIndex];

  if (!step) {
    return (
      <ParentCheck
        title={`${ref(perek, mishnah)} — the whole mishnah`}
        cards={m.chunks}
        onDone={(g) => {
          const p = parentCheckMishnah(profile, perek, mishnah, g);
          onProfile(p);
          onFinished(p, g);
        }}
      />
    );
  }

  const next = () => {
    setPhase("read");
    setAttempt((a) => a + 1);
    if (detour) { setDetour(null); return; }
    const { profile: p } = completeStep(profile, perek, mishnah);
    onProfile(p);
    onStepPassed();
  };

  const header = (
    <>
      <h2 className="task-title">{ref(perek, mishnah)}</h2>
      <StepPath steps={steps} chunks={m.chunks} current={stepIndex} />
      <div className="step-label" dir="ltr">{detour ? "Extra practice" : step.label}</div>
    </>
  );

  if (step.kind === "learn") {
    const chunk = m.chunks[step.chunk];
    if (!chunk) return null;
    return (
      <div className="task">
        {header}
        {phase === "read" ? (
          <ReadPhase key={`read${attempt}`} chunk={chunk} tts={profile.settings.tts} onDone={() => setPhase("recall")} />
        ) : (
          <Recite
            key={`rec${attempt}`}
            cards={[chunk]}
            phases={[[2], [4]]}
            prompts={["Say it. The first letters will help.", "Now say it without looking!"]}
            newest={0}
            onDone={(g) => {
              if (g === "notyet") { setPhase("read"); setAttempt((a) => a + 1); return; }
              next();
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
          if (g !== "notyet") { next(); return; }
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

/** Whole-perek chain (or perek review): one card per mishnah, opening word → hidden, then parent check. */
function PerekChainTask({ perek, through, review, onDone }: {
  perek: number; through: number; review: boolean; onDone: (g: Grade, slipped: number[]) => void;
}) {
  const list = mishnayosOf(perek).filter((m) => m.mishnah <= through);
  const cards = list.map((m) => ({ he: m.chunks.map((c) => c.he).join(" "), label: `משנה ${hebNum(m.mishnah)}` }));
  const [stage, setStage] = useState<"recite" | "check">("recite");
  const title = review ? `Perek review · ${ref(perek)}` : `${ref(perek)} · mishnayos 1–${through} in a row`;
  return (
    <div className="task">
      <h2 className="task-title">{title}</h2>
      {stage === "recite" ? (
        <Recite
          cards={cards}
          phases={review ? [cards.map(() => 4 as Cue)] : [cards.map(() => 3 as Cue), cards.map(() => 4 as Cue)]}
          prompts={review ? ["Say the whole perek by heart."] : ["Say them all in a row. The first word of each mishnah is there to help.", "Now all of them, without looking!"]}
          onDone={() => setStage("check")}
        />
      ) : (
        <ParentCheck
          title={title}
          cards={cards}
          onDone={(g, slippedCards) => onDone(g, slippedCards.map((i) => list[i]?.mishnah ?? 0).filter(Boolean))}
        />
      )}
    </div>
  );
}

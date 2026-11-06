import type { ReactNode } from "react";
import { hebNum } from "../data";
import { perekPathSteps, perekSegs, perekSteps, stepSelKey, type PerekStep } from "../perekSteps";
import { canStartPerekStep, mp, perekFrontier, perekStage, stepSatisfied } from "../progress";
import { pathGroupsFor, type PathGroup, type PathNode } from "../steps";
import type { Profile } from "../types";

interface Props {
  profile: Profile;
  perek: number;
  /** Which group to show (index into the perek's path groups); defaults to the group holding the frontier. */
  group?: number | undefined;
  /** The selected node: "M3", "C1-3", "G1" (a part pill) or "cap". */
  sel?: string | null | undefined;
  /** When given, nodes, part pills and the cap are buttons that select (nothing starts by itself). */
  onSelect?: ((sel: string, group: number) => void) | undefined;
  /** Replaces the counter line under the path. */
  caption?: string | undefined;
}

type State = "done" | "current" | "partial" | "locked" | "upcoming";

const stateWord: Record<State, string> = { done: "done", current: "now", partial: "started", locked: "locked", upcoming: "not yet" };

export const perekGroupName = (g: PathGroup): string => (g.key === "join" ? "All together" : `Part ${g.key + 1}`);

/** The perek's path groups (one per part, then the join group for 2+ parts). Not memoized (see perekSteps). */
export function perekGroups(perek: number): PathGroup[] {
  return pathGroupsFor(perekPathSteps(perekSteps(perek)), perekSegs(perek));
}

/** The group that holds the frontier (the last group once every step is satisfied). */
export function frontierGroup(profile: Profile, perek: number): number {
  const groups = perekGroups(perek);
  const f = perekFrontier(profile, perek);
  const i = groups.findIndex((g) => g.steps.includes(f));
  return i < 0 ? Math.max(0, groups.length - 1) : i;
}

/** A perek's build-up drawn like a mishnah's step path: round mishnah tiles joined by golden links, then 🎯. */
export function PerekPath({ profile, perek, group: shown, sel, onSelect, caption }: Props) {
  const steps = perekSteps(perek);
  const groups = perekGroups(perek);
  const frontier = perekFrontier(profile, perek);
  const stage = perekStage(profile, perek);
  const curIdx = shown !== undefined && groups[shown] ? shown : frontierGroup(profile, perek);
  const group = groups[curIdx];
  if (!group) return null;

  const stateOf = (i: number): State => {
    const s = steps[i];
    if (!s) return "upcoming";
    if (stepSatisfied(profile, perek, s)) return "done";
    if (i === frontier) return "current";
    if (s.kind === "mishnah" && mp(profile, perek, s.mishnah).state === "learning") return "partial";
    if (!canStartPerekStep(profile, perek, s)) return "locked";
    return "upcoming";
  };
  const groupDone = (g: PathGroup) => g.steps.every((i) => stateOf(i) === "done");

  const node = (key: string, cls: string, label: string, selKey: string | null, body: ReactNode, isCur = false) => {
    const selected = selKey !== null && sel === selKey;
    const full = `hit ${cls}${selected ? " selected" : ""}`;
    if (!onSelect || selKey === null) return <span key={key} className={full} title={label} aria-hidden="true">{body}</span>;
    return (
      <button
        key={key}
        type="button"
        className={full}
        aria-label={label}
        title={label}
        aria-pressed={selected}
        aria-current={isCur ? "step" : undefined}
        onClick={() => onSelect(selKey, curIdx)}
      >
        {body}
      </button>
    );
  };

  const renderNode = (n: PathNode): ReactNode => {
    if (n.type === "partTile") {
      const g = groups[n.part - 1];
      const st: State = g && groupDone(g) ? "done" : g?.steps.includes(frontier) ? "current" : "upcoming";
      return node(`p${n.part}`, `tile part-tile ${st}`, `Part ${n.part}, ${stateWord[st]}`, onSelect ? `G${n.part - 1}` : null,
        <span className="face">{n.part}</span>);
    }
    const s: PerekStep | undefined = steps[n.step];
    if (!s) return null;
    const st = stateOf(n.step);
    const label = `${s.label}, ${stateWord[st]}`;
    if (n.type === "tile" && s.kind === "mishnah") {
      return node(`s${n.step}`, `tile ${st}`, label, stepSelKey(s), <span className="face">{hebNum(s.mishnah).replace("׳", "")}</span>, st === "current");
    }
    const lock = st === "locked" ? <span className="lock" aria-hidden="true">🔒</span> : null;
    return node(`s${n.step}`, `link ${st}${n.type === "link" && n.final ? " final" : ""}`, label, stepSelKey(s),
      <><span className="bar" />{lock}</>, st === "current");
  };

  const lastGroup = curIdx === groups.length - 1;
  const capState: State = lastGroup
    ? stage === "complete" ? "done" : stage === "ready" ? "current" : "upcoming"
    : groupDone(group) ? "done" : "upcoming";
  const cap = lastGroup
    ? node("cap", `cap end target ${capState}`, `Ready to be tested, ${stateWord[capState]}`, "cap", <span className="face">🎯</span>, capState === "current")
    : node("cap", `cap ${capState}`, `${perekGroupName(group)} finished, ${stateWord[capState]}`, null, <span className="face">✓</span>);

  const doneCount = steps.filter((_, i) => stateOf(i) === "done").length;
  const count = caption ?? (stage === "complete" ? "All done ✓" : stage === "ready" ? "Ready to be tested!" : `Step ${Math.min(frontier + 1, steps.length)} of ${steps.length}`);
  const navLabel = `${groups.length > 1 ? `${perekGroupName(group)}: ` : ""}${count}, ${doneCount} of ${steps.length} steps done`;

  return (
    <div className="step-path-wrap">
      {groups.length > 1 && (
        <div className="parts">
          {groups.map((g, gi) => {
            const doneSteps = g.steps.filter((i) => stateOf(i) === "done").length;
            const done = g.steps.length > 0 && doneSteps === g.steps.length;
            const isCur = gi === curIdx;
            const selected = sel === `G${gi}`;
            const cls = `part${done ? " done" : ""}${isCur ? " current" : ""}${selected ? " selected" : ""}`;
            const pct = g.steps.length ? Math.round((100 * doneSteps) / g.steps.length) : 0;
            const body = (
              <>
                <span className="part-name" dir="ltr">
                  {g.key === "join" ? <>All<span className="part-word"> together</span></> : <><span className="part-word">Part </span>{g.key + 1}</>}
                  {done ? " ✓" : ""}
                </span>
                <span className="part-bar" aria-hidden="true"><i style={{ width: `${pct}%` }} /></span>
              </>
            );
            if (!onSelect) return <span key={String(g.key)} className={cls}>{body}</span>;
            return (
              <button
                key={String(g.key)}
                type="button"
                className={cls}
                aria-label={`${perekGroupName(g)}, ${done ? "done" : doneSteps > 0 ? "started" : "not yet"}`}
                aria-pressed={selected}
                onClick={() => onSelect(`G${gi}`, gi)}
              >
                {body}
              </button>
            );
          })}
        </div>
      )}
      {onSelect ? (
        <nav className="chain perek" aria-label={navLabel}>
          {group.nodes.map(renderNode)}
          {cap}
        </nav>
      ) : (
        <div className="chain perek" role="img" aria-label={navLabel}>
          {group.nodes.map(renderNode)}
          {cap}
        </div>
      )}
      <div className="chain-count" dir="ltr" aria-live="polite">{count}</div>
    </div>
  );
}

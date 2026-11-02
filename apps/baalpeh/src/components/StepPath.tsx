import type { ReactNode } from "react";
import type { Chunk, Step } from "../types";
import { pathGroups, stepPosition, type PathGroup, type PathNode } from "../steps";

interface Props {
  steps: Step[];
  chunks: Chunk[];
  /** Current step index; steps.length means the parent check (or a known mishnah). */
  current: number;
  /** When given, part pills and path nodes are buttons that jump to that step. */
  onJump?: (index: number) => void;
}

type State = "done" | "current" | "upcoming";

const stateOf = (step: number, current: number): State =>
  step < current ? "done" : step === current ? "current" : "upcoming";

const stateWord: Record<State, string> = { done: "done", current: "now", upcoming: "not yet" };

const groupName = (g: PathGroup): string => (g.key === "join" ? "All together" : `Part ${g.key + 1}`);

/**
 * The step path as a "piece chain": one numbered tile per new piece, a link between tiles for each
 * "together" step, drawn right to left like the Hebrew. Part pills above (2+ parts) show each part's
 * progress; the counter below says "Piece k of n".
 */
export function StepPath({ steps, chunks, current, onJump }: Props) {
  const groups = pathGroups(steps, chunks);
  const finished = current >= steps.length;
  const pos = stepPosition(groups, current);
  const curIdx = pos?.group ?? groups.length - 1;
  const group = groups[curIdx];
  if (!group) return null;

  // The step being said "together" brackets the tiles it covers.
  const curNode = group.nodes.find((n) => n.type !== "partTile" && n.step === current);
  const bracketThrough = curNode?.type === "link" ? curNode.through : 0;

  const node = (key: string, cls: string, label: string, target: number | undefined, isCur: boolean, body: ReactNode) => {
    if (!onJump || target === undefined) {
      return <span key={key} className={`hit ${cls}`} title={label} aria-hidden="true">{body}</span>;
    }
    return (
      <button
        key={key}
        type="button"
        className={`hit ${cls}`}
        aria-label={label}
        title={label}
        aria-current={isCur ? "step" : undefined}
        onClick={() => onJump(target)}
      >
        {body}
      </button>
    );
  };

  const renderNode = (n: PathNode): ReactNode => {
    if (n.type === "partTile") {
      const st: State = n.lastStep < current ? "done" : n.firstStep <= current ? "current" : "upcoming";
      const inChain = n.part <= bracketThrough ? " in-chain" : "";
      return node(`p${n.part}`, `tile part-tile ${st}${inChain}`, `Part ${n.part}, ${stateWord[st]}`, n.firstStep, false,
        <span className="face">{n.part}</span>);
    }
    const st = stateOf(n.step, current);
    const just = n.step === current - 1 ? " just" : "";
    const label = steps[n.step]?.label ?? "";
    if (n.type === "tile") {
      const inChain = n.n <= bracketThrough ? " in-chain" : "";
      return node(`s${n.step}`, `tile ${st}${just}${inChain}`, `${label}, ${stateWord[st]}`, n.step, st === "current",
        <span className="face">{n.n}</span>);
    }
    const linkIn = n.through < bracketThrough ? " in-chain" : "";
    return node(`s${n.step}`, `link ${st}${just}${linkIn}${n.final ? " final" : ""}`, `${label}, ${stateWord[st]}`, n.step,
      st === "current", <span className="bar" />);
  };

  // A cap after the group's final link: ✓ for a part, or the parent check at the end of the mishnah.
  const lastGroup = curIdx === groups.length - 1;
  const lastStep = group.steps[group.steps.length - 1];
  const capState: State = lastGroup
    ? (finished && onJump ? (current === steps.length ? "current" : "done") : finished ? "done" : "upcoming")
    : lastStep !== undefined && lastStep < current ? "done" : "upcoming";
  const cap = node("cap", `cap ${capState}${lastGroup ? " end" : ""}`,
    lastGroup ? `Show Abba or Ima, ${stateWord[capState]}` : `${groupName(group)} finished, ${stateWord[capState]}`,
    lastGroup ? steps.length : undefined, capState === "current", <span className="face">✓</span>);

  const count = finished
    ? "All done ✓"
    : !pos
      ? ""
      : pos.kind === "join"
        ? pos.piece === pos.of ? "Last step!" : `Step ${pos.piece - 1} of ${pos.of - 1}`
        : `Piece ${pos.piece} of ${pos.of}`;
  const navLabel = `${groups.length > 1 ? `${groupName(group)}: ` : ""}${count}`;

  return (
    <div className="step-path-wrap">
      {groups.length > 1 && (
        <div className="parts">
          {groups.map((g, gi) => {
            const doneSteps = g.steps.filter((i) => i < current).length;
            const done = g.steps.length > 0 && doneSteps === g.steps.length;
            const isCur = gi === curIdx && !finished;
            const last = g.steps[g.steps.length - 1];
            const just = done && last === current - 1 ? " just" : "";
            const cls = `part${done ? " done" : ""}${isCur ? " current" : ""}${just}`;
            const pct = g.steps.length ? Math.round((100 * doneSteps) / g.steps.length) : 0;
            const body = (
              <>
                {/* On a phone only the current part keeps its "Part" word, so the row fits on one line. */}
                <span className="part-name" dir="ltr">
                  {g.key === "join" ? (
                    <>All<span className="part-word"> together</span></>
                  ) : (
                    <><span className="part-word">Part </span>{g.key + 1}</>
                  )}
                  {done ? " ✓" : ""}
                </span>
                <span className="part-bar" aria-hidden="true"><i style={{ width: `${pct}%` }} /></span>
              </>
            );
            const label = `${groupName(g)}, ${done ? "done" : isCur ? "now" : doneSteps > 0 ? "started" : "not yet"}`;
            const first = g.steps[0];
            if (!onJump || first === undefined) return <span key={String(g.key)} className={cls}>{body}</span>;
            return (
              <button
                key={String(g.key)}
                type="button"
                className={cls}
                aria-label={label}
                aria-current={isCur ? "step" : undefined}
                onClick={() => onJump(first)}
              >
                {body}
              </button>
            );
          })}
        </div>
      )}
      {onJump ? (
        <nav className="chain" aria-label={navLabel}>
          {group.nodes.map(renderNode)}
          {cap}
        </nav>
      ) : (
        <div className="chain" role="img" aria-label={navLabel}>
          {group.nodes.map(renderNode)}
          {cap}
        </div>
      )}
      <div className="chain-count" dir="ltr" aria-live="polite">{count}</div>
    </div>
  );
}

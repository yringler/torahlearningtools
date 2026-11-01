import type { Chunk, Step } from "../types";
import { isBigStep, segments } from "../steps";

/** Which group a step belongs to: its segment index, or "join" for steps spanning segments. */
function groupOf(s: Step, segs: Array<[number, number]>): number | "join" {
  const lo = s.kind === "learn" ? s.chunk : s.from;
  const hi = s.kind === "learn" ? s.chunk : s.to;
  const i = segs.findIndex(([a, b]) => lo >= a && hi <= b);
  return i < 0 ? "join" : i;
}

/** Shows part pills (for long mishnayos) and the stones of the current part only. */
export function StepPath({ steps, chunks, current }: { steps: Step[]; chunks: Chunk[]; current: number }) {
  const segs = segments(chunks);
  const groups = steps.map((s) => groupOf(s, segs));
  const curGroup = groups[Math.min(current, steps.length - 1)] ?? 0;
  const shown = steps.map((s, i) => ({ s, i })).filter(({ i }) => groups[i] === curGroup);
  const parts: Array<number | "join"> = [...segs.map((_, i) => i), ...(segs.length > 1 ? ["join" as const] : [])];

  return (
    <div className="step-path-wrap">
      {parts.length > 1 && (
        <div className="parts" dir="ltr">
          {parts.map((g) => {
            const idx = groups.map((x, i) => (x === g ? i : -1)).filter((i) => i >= 0);
            const done = idx.length > 0 && idx.every((i) => i < current);
            const cls = ["part", done ? "done" : "", g === curGroup && current < steps.length ? "current" : ""].join(" ");
            return <span key={String(g)} className={cls}>{g === "join" ? "All together" : `Part ${g + 1}`}</span>;
          })}
        </div>
      )}
      <div className="step-path" aria-label={`Step ${Math.min(current + 1, steps.length)} of ${steps.length}`}>
        {shown.map(({ s, i }) => {
          const cls = ["stone", isBigStep(s, chunks) ? "big" : "", i < current ? "done" : i === current ? "current" : ""].join(" ");
          return <span key={i} className={cls} title={s.label} />;
        })}
      </div>
    </div>
  );
}

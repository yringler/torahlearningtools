import { useMemo, useState } from "react";
import { useMasechta } from "../components/MasechtaGate";
import { MishnahStudy } from "../components/MishnahStudy";
import { StepPath } from "../components/StepPath";
import { getMishnah, hebNum } from "../data";
import { isKnown, mp, perekDone } from "../progress";
import { isDue } from "../srs";
import { buildSteps, groupIndexOf, groupRange, pathGroups, practiceLabel } from "../steps";
import type { Chunk, MeaningView, Profile, Step } from "../types";

interface Props {
  profile: Profile;
  perek: number;
  mishnah: number;
  onPractice: () => void;
  onReview: () => void;
  /** Known mishnah: practice steps from..to (`group` is the part shown, to come back to). */
  onPracticeRange: (r: { from: number; to: number; label: string; group: number }) => void;
  /** Part shown in the practice picker when the screen opens (e.g. coming back from practice). */
  group?: number;
  onBack: () => void;
  /** The back button's text (default "‹ Map"; "‹ Perek" when opened from the perek screen). */
  backLabel?: string;
  onView: (v: MeaningView) => void;
}

export function MishnahScreen({ profile, perek, mishnah, onPractice, onReview, onPracticeRange, group, onBack, backLabel = "‹ Map", onView }: Props) {
  const ms = useMasechta();
  const { translated } = ms;
  const m = getMishnah(perek, mishnah);
  const steps = buildSteps(m.chunks);
  const st = mp(profile, ms.shape, perek, mishnah);
  const view = profile.settings.meaningView ?? "simple";

  return (
    <div className="mishnah-screen">
      <div className="topbar" dir="ltr">
        <button className="btn ghost-btn small" onClick={onBack}>{backLabel}</button>
        <span className="who" style={{ color: profile.color }}>{profile.emoji} {profile.name}</span>
      </div>
      <h2 className="task-title">{ms.he} {hebNum(perek)}:{hebNum(mishnah)}</h2>
      {translated && m.summary && <p className="summary" dir="ltr">{m.summary}</p>}
      {!isKnown(st) && <StepPath steps={steps} chunks={m.chunks} current={st.stepIndex} />}
      <div className="actions" dir="ltr">
        {isKnown(st) ? (
          <button className="btn primary big" onClick={onReview}>
            🔁 Review it
            {isDue(st.review) && !perekDone(profile, ms.shape, perek) && <span className="sub">due today</span>}
          </button>
        ) : (
          <button className="btn primary big" onClick={onPractice}>
            {st.stepIndex > 0 ? "▶ Keep learning" : "▶ Start learning"}
          </button>
        )}
      </div>
      {isKnown(st) && (
        <PracticePicker key={`${perek}:${mishnah}`} steps={steps} chunks={m.chunks} initialGroup={group} onStart={onPracticeRange} />
      )}
      <MishnahStudy m={m} perek={perek} mishnah={mishnah} view={view} onView={onView} />
    </div>
  );
}

/**
 * "Practice a piece" for a known mishnah: the step path, all done, where a tap only selects a step
 * (part pills switch the part shown). One button runs the selection, or the whole part shown.
 */
function PracticePicker({ steps, chunks, initialGroup, onStart }: {
  steps: Step[]; chunks: Chunk[]; initialGroup: number | undefined;
  onStart: (r: { from: number; to: number; label: string; group: number }) => void;
}) {
  const groups = useMemo(() => pathGroups(steps, chunks), [steps, chunks]);
  const [group, setGroup] = useState(() => (initialGroup !== undefined && groups[initialGroup] ? initialGroup : 0));
  const [selected, setSelected] = useState<number | null>(null);
  const shown = groups[group];
  const range = shown ? groupRange(shown) : null;
  if (!shown || !range) return null;

  const label = practiceLabel(groups, selected === null ? { group } : { step: selected });
  const sel = selected === null ? null : steps[selected];
  const cue = sel
    ? chunks.slice(sel.kind === "learn" ? sel.chunk : sel.from, (sel.kind === "learn" ? sel.chunk : sel.to) + 1)
      .map((c) => c.he.split(/\s+/)[0] ?? "").join(" … ")
    : "";
  const caption = sel
    ? label.charAt(0).toUpperCase() + label.slice(1)
    : groups.length === 1
      ? "Tap a piece, or practice all the steps."
      : shown.key === "join"
        ? "Tap a part to see its pieces, or a link to say parts together."
        : `Tap a piece, or practice all of Part ${shown.key + 1}.`;
  const start = () => {
    const [from, to] = selected === null ? range : [selected, selected];
    onStart({ from, to, label: label.charAt(0).toUpperCase() + label.slice(1), group });
  };

  return (
    <section className="practice-panel" dir="ltr" aria-label="Practice a piece">
      <h3 className="practice-head"><span>Practice a piece</span></h3>
      <div dir="rtl">
        <StepPath
          steps={steps}
          chunks={chunks}
          current={selected ?? -1}
          finished
          group={group}
          onGroup={(g) => { setGroup(g); setSelected(null); }}
          onJump={(i) => {
            const g = groupIndexOf(groups, i);
            if (g >= 0 && g !== group) setGroup(g);
            setSelected((s) => (s === i ? null : i));
          }}
          caption={caption}
        />
      </div>
      {cue && <p className="practice-cue" dir="rtl">{cue}</p>}
      <button className="btn secondary practice-go" onClick={start}>▶ Practice {label}</button>
    </section>
  );
}

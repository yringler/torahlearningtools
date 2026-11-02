import type { Profile } from "../types";

export const DEFAULT_BREAK_MINUTES = 15;

/**
 * Break reminders are off unless the parent turns them on. When on, the child is shown a
 * "time for a break" screen once per session after `breakMinutes`.
 */
export function BreakSetting({ p, onChange }: { p: Profile; onChange: (p: Profile) => void }) {
  const { breakMinutes, ...rest } = p.settings;
  const on = breakMinutes !== undefined;
  const setMinutes = (m: number | undefined) =>
    onChange({ ...p, settings: m === undefined ? rest : { ...rest, breakMinutes: m } });
  return (
    <div className="break-setting">
      <label>
        <input type="checkbox" checked={on} onChange={(e) => setMinutes(e.target.checked ? DEFAULT_BREAK_MINUTES : undefined)} />
        Suggest a break
      </label>
      {on && (
        <label>after <input type="number" min={5} max={60} value={breakMinutes}
          onChange={(e) => setMinutes(Math.round(Number(e.target.value)) || DEFAULT_BREAK_MINUTES)} /> minutes</label>
      )}
    </div>
  );
}

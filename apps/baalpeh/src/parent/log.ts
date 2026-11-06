import type { AuditEntry } from "../../shared/api";
import { deviceLabel } from "../../shared/device";
import { hebNum } from "../../shared/hebrew";

/** Pure text for the parent-mode change log (docs/PARENT_MODE.md §9.9). */

const nums = (x: unknown): number[] => (Array.isArray(x) ? x.filter((n): n is number => typeof n === "number" && Number.isInteger(n)) : []);
const strs = (x: unknown): string[] => (Array.isArray(x) ? x.filter((s): s is string => typeof s === "string") : []);
const nameIn = (x: unknown): string | null => {
  if (typeof x !== "object" || x === null) return null;
  const n = (x as { name?: unknown }).name;
  return typeof n === "string" ? n : null;
};
const hebList = (ps: number[]): string => [...ps].sort((a, b) => a - b).map((p) => hebNum(p)).join(", ");

/**
 * "פרק ב׳" inside an English sentence, wrapped in a right-to-left isolate (U+2067 … U+2069) so the geresh stays with
 * its letter instead of jumping to the other end of the phrase.
 */
export const perekHe = (ps: number | number[]): string => `\u2067פרק ${hebList(typeof ps === "number" ? [ps] : ps)}\u2069`;

/** "פרק ב׳ reset" and "2:3, 2:4 marked not known" from progress_edited keys ("p:2", "m:2:3"). */
function progressText(keys: string[], count: number): string {
  const reset = new Set<number>();
  for (const k of keys) {
    const m = /^p:(\d+)$/.exec(k);
    if (m) reset.add(Number(m[1]));
  }
  const notKnown: string[] = [];
  for (const k of keys) {
    const m = /^m:(\d+):(\d+)$/.exec(k);
    if (m && !reset.has(Number(m[1]))) notKnown.push(`${m[1]}:${m[2]}`);
  }
  const parts: string[] = [];
  if (reset.size) parts.push(`${perekHe([...reset])} reset`);
  if (notKnown.length) parts.push(`${notKnown.join(", ")} marked not known`);
  if (parts.length === 0) parts.push("progress changed");
  return parts.join("; ") + (count > keys.length ? " (and more)" : "");
}

export function describeEntry(e: AuditEntry): string {
  const name = e.childName ?? "A child";
  const d = e.detail;
  switch (e.action) {
    case "pin_set": return "Parent PIN set";
    case "pin_changed": return "Parent PIN changed";
    case "pin_reset": return "Parent PIN reset with an email link";
    case "pin_locked": return "PIN locked after 5 wrong tries";
    case "perek_verified": {
      const ps = nums(d["perakim"]);
      if (e.via === "test_link") {
        return `${name}: ${perekHe(ps)} confirmed from the test email${d["pinUsed"] === true ? " · PIN entered" : ""}`;
      }
      return `${name}: ${perekHe(ps)} marked verified`;
    }
    case "perek_unverified":
      return `${name}: verification of ${perekHe(nums(d["perakim"]))} removed`;
    case "progress_edited": {
      const keys = strs(d["keys"]);
      const count = typeof d["count"] === "number" ? d["count"] : keys.length;
      return `${name}: ${progressText(keys, count)}`;
    }
    case "child_added":
      return d["imported"] === true ? `Child added from this device's saved progress: ${name}` : `Child added: ${name}`;
    case "child_removed":
      return `Child removed: ${name}`;
    case "child_edited": {
      const from = nameIn(d["from"]);
      const to = nameIn(d["to"]);
      return from !== null && to !== null && from !== to ? `${from} renamed to ${to}` : `${name}: settings changed`;
    }
  }
}

/** The grey second line: who did it, and from where. */
export function actorLine(e: AuditEntry): string {
  const who = e.actorEmail ?? "Unknown login";
  if (e.via === "test_link") return `${who} · test email link`;
  if (e.via === "pin_reset_link") return `${who} · PIN reset email link`;
  return `${who} · ${deviceLabel(e.actorDevice)}`;
}

export const whenText = (at: number): string =>
  new Date(at).toLocaleString([], { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

export interface Word {
  he: string;
  en: string;
  note?: string;
}

export type Source = "steinsaltz" | "bartenura";

export interface Chunk {
  he: string;
  /** Simple kid-level meaning, based on the sources in `basis`. */
  en: string;
  /** Optional minimal explanation (rare). */
  explain?: string;
  /** Verbatim Steinsaltz excerpt: <b>translation</b> + plain explanation. */
  st?: string;
  /** Verbatim continuation of Steinsaltz's longer explanation (behind "more"). */
  stMore?: string;
  basis?: Source[];
  basisNote?: string;
  words: Word[];
}

export interface Mishnah {
  perek: number;
  mishnah: number;
  summary: string;
  chunks: Chunk[];
  stIntro?: string;
}

export interface Masechta {
  masechta: string;
  masechtaEn: string;
  mishnayos: Mishnah[];
}

/** Cue level: 0 full text … 4 empty card. */
export type Cue = 0 | 1 | 2 | 3 | 4;

/** A step in the chaining sequence of one mishnah. Ranges are inclusive chunk indices. */
export type Step =
  | { kind: "learn"; chunk: number; label: string }
  | { kind: "chain"; from: number; to: number; newest: number; label: string };

export type Grade = "pass" | "help" | "notyet";

export type MishnahState = "new" | "learning" | "known" | "solid";

export interface ReviewItem {
  box: number; // 0-based index into INTERVALS
  due: string; // ISO date (yyyy-mm-dd)
  passes: number;
}

export interface MishnahProgress {
  stepIndex: number; // next step to do
  state: MishnahState;
  review?: ReviewItem;
  fails: Record<string, number>; // step key -> consecutive fails
}

export interface PerekProgress {
  /** Highest mishnah k for which the chain [1..k] has been parent-checked. */
  chainedThrough: number;
  complete: boolean;
  review?: ReviewItem;
}

export interface Settings {
  fontScale: number;
  tts: boolean;
  dailyMinutes: number;
  /** Which meaning view to show while learning (optional for older saved profiles). */
  meaningView?: MeaningView;
}

export type MeaningView = "simple" | "steinsaltz";

export interface Profile {
  id: string;
  name: string;
  color: string;
  emoji: string;
  settings: Settings;
  mishnayos: Record<string, MishnahProgress>; // key "p:m"
  perakim: Record<string, PerekProgress>; // key "p"
  days: string[]; // ISO dates with any learning (last ~60)
}

export interface AppState {
  version: 1;
  profiles: Profile[];
}

import type { ChildSettings, MishnahProgressData, PerekProgressData } from "../shared/api";
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
export const _typesMatchShared: [Same<MishnahProgress, MishnahProgressData>, Same<PerekProgress, PerekProgressData>,
  Same<Settings, ChildSettings>] = [true, true, true];

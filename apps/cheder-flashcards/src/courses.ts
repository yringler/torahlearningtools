// Courses: the 300-shorashim list and the cheder-paper weeks, both as weeks of cards.
// Every two weeks form one test unit.
import shorashim from "./data/shorashim.json";
import { WEEKS } from "./words";

export interface Card {
  /** Big Hebrew shown on the card. */
  hebrew: string;
  /** Optional smaller Hebrew under it (e.g. an example form of the root). */
  sub?: string;
  /** Accepted English answers; the first is shown as the answer. */
  english: string[];
}

export interface CourseWeek {
  label: string;
  cards: Card[];
}

export interface TestUnit {
  /** 0-based index of the test within its course. */
  index: number;
  label: string;
  /** 0-based indices into Course.weeks. */
  weeks: number[];
}

export type CourseId = "shorashim" | "cheder";

export interface Course {
  id: CourseId;
  title: string;
  weeks: CourseWeek[];
}

export const WEEKS_PER_TEST = 2;

interface ShorashJson {
  weeks: { week: number; words: { root: string; example: string; english: string[] }[] }[];
}

const shorashimData: ShorashJson = shorashim;

export const COURSES: readonly Course[] = [
  {
    id: "shorashim",
    title: "300 Shorashim",
    weeks: shorashimData.weeks.map((w) => ({
      label: `Week ${w.week}`,
      cards: w.words.map((s) => ({
        // Always show Hebrew with nikud: the voweled example form, not the bare root.
        hebrew: s.example,
        english: s.english,
      })),
    })),
  },
  {
    id: "cheder",
    title: "Cheder papers",
    weeks: WEEKS.map((w) => ({
      label: w.label,
      cards: w.words.map((x) => ({ hebrew: x.hebrew, english: x.english })),
    })),
  },
];

export function courseById(id: string): Course | undefined {
  return COURSES.find((c) => c.id === id);
}

/** Group a course's weeks into tests of WEEKS_PER_TEST weeks (the last may be shorter). */
export function testsFor(course: Course): TestUnit[] {
  const tests: TestUnit[] = [];
  for (let start = 0; start < course.weeks.length; start += WEEKS_PER_TEST) {
    const weeks: number[] = [];
    for (let i = start; i < Math.min(start + WEEKS_PER_TEST, course.weeks.length); i++) weeks.push(i);
    const first = weeks[0] ?? start;
    const last = weeks[weeks.length - 1] ?? start;
    const range = first === last ? `week ${first + 1}` : `weeks ${first + 1}–${last + 1}`;
    tests.push({ index: tests.length, label: `Test ${tests.length + 1} (${range})`, weeks });
  }
  return tests;
}

export function cardsForTest(course: Course, test: TestUnit): Card[] {
  return test.weeks.flatMap((i) => course.weeks[i]?.cards ?? []);
}

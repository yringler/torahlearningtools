// The one course: the cheder Word List pages, one column (א/ב/ג) per week.
// Every two weeks form one test unit.
import { COLUMN_LETTERS, WORD_LISTS } from "./words";

export interface Card {
  /** Big Hebrew shown on the card. */
  hebrew: string;
  /** Optional smaller Hebrew under it. */
  sub?: string;
  /** Accepted English answers; the first is shown as the answer. */
  english: string[];
}

export interface CourseWeek {
  /** e.g. "List 3 א" */
  label: string;
  list: number;
  column: string;
  cards: Card[];
}

export interface TestUnit {
  /** 0-based index of the test within its course. */
  index: number;
  label: string;
  /** 0-based indices into Course.weeks. */
  weeks: number[];
}

export type CourseId = "wordlists";

export interface Course {
  id: CourseId;
  title: string;
  weeks: CourseWeek[];
}

export const WEEKS_PER_TEST = 2;

/** Wrap a Hebrew letter in a bidi isolate so it sits in place inside English text. */
function heb(s: string): string {
  return `⁨${s}⁩`;
}

export const COURSE: Course = {
  id: "wordlists",
  title: "Word Lists",
  weeks: WORD_LISTS.flatMap((l) =>
    l.columns.map((words, i) => {
      const column = COLUMN_LETTERS[i] ?? "";
      return {
        label: `List ${l.list} ${heb(column)}`,
        list: l.list,
        column,
        cards: words.map((x) => ({ hebrew: x.hebrew, english: x.english })),
      };
    }),
  ),
};

/** "List 3 א–ב", or "List 3 ג – List 4 א" when a test spans two pages. */
function rangeLabel(first: CourseWeek, last: CourseWeek): string {
  if (first === last) return first.label;
  if (first.list === last.list) return `List ${first.list} ${heb(first.column)}–${heb(last.column)}`;
  return `${first.label} – ${last.label}`;
}

/** Group a course's weeks into tests of WEEKS_PER_TEST weeks (the last may be shorter). */
export function testsFor(course: Course): TestUnit[] {
  const tests: TestUnit[] = [];
  for (let start = 0; start < course.weeks.length; start += WEEKS_PER_TEST) {
    const weeks: number[] = [];
    for (let i = start; i < Math.min(start + WEEKS_PER_TEST, course.weeks.length); i++) weeks.push(i);
    const first = course.weeks[weeks[0] ?? start];
    const last = course.weeks[weeks[weeks.length - 1] ?? start];
    const range = first && last ? ` (${rangeLabel(first, last)})` : "";
    tests.push({ index: tests.length, label: `Test ${tests.length + 1}${range}`, weeks });
  }
  return tests;
}

export function cardsForTest(course: Course, test: TestUnit): Card[] {
  return test.weeks.flatMap((i) => course.weeks[i]?.cards ?? []);
}

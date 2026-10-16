// The one course: the cheder Word List pages, one column (א/ב/ג) per week.
// Each list (page) is one test unit: learn its columns, then take its test.
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
  /** Stable id for saved progress, e.g. "3א". */
  key: string;
  /** e.g. "List 3 א" */
  label: string;
  list: number;
  /** "" only for a list with a single column */
  column: string;
  cards: Card[];
}

export interface TestUnit {
  /** Stable id for saved scores, e.g. "list3". */
  key: string;
  /** The Word List number this test covers. */
  list: number;
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

/** Wrap a Hebrew letter in a bidi isolate so it sits in place inside English text. */
function heb(s: string): string {
  return `⁨${s}⁩`;
}

export function weekKey(list: number, column: string): string {
  return `${list}${column}`;
}

export function testKey(list: number): string {
  return `list${list}`;
}

export const COURSE: Course = {
  id: "wordlists",
  title: "Word Lists",
  weeks: WORD_LISTS.flatMap((l) =>
    l.columns.map((words, i) => {
      const column = l.columns.length > 1 ? (COLUMN_LETTERS[i] ?? "") : "";
      return {
        key: weekKey(l.list, column),
        label: column ? `List ${l.list} ${heb(column)}` : `List ${l.list}`,
        list: l.list,
        column,
        cards: words.map((x) => ({ hebrew: x.hebrew, english: x.english })),
      };
    }),
  ),
};

/** One test per Word List, covering all of that list's columns. */
export function testsFor(course: Course): TestUnit[] {
  const tests: TestUnit[] = [];
  course.weeks.forEach((week, i) => {
    const last = tests[tests.length - 1];
    if (last && last.list === week.list) last.weeks.push(i);
    else tests.push({ key: testKey(week.list), list: week.list, label: `List ${week.list} Test`, weeks: [i] });
  });
  return tests;
}

export function cardsForTest(course: Course, test: TestUnit): Card[] {
  return test.weeks.flatMap((i) => course.weeks[i]?.cards ?? []);
}

/** The test (Word List) a week belongs to. */
export function testForWeek(course: Course, weekIndex: number): TestUnit | undefined {
  return testsFor(course).find((t) => t.weeks.includes(weekIndex));
}

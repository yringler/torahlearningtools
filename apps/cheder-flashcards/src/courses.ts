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

/** Saved score key for the test on one column (week), e.g. "test:3א". */
export function weekTestKey(weekKey: string): string {
  return `test:${weekKey}`;
}

export function shuffle<T>(items: readonly T[], rand: () => number = Math.random): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    const tmp = a[i] as T;
    a[i] = a[j] as T;
    a[j] = tmp;
  }
  return a;
}

/**
 * Split a whole list's test into short parts, one per column, each a mix of every column:
 * each column is shuffled and dealt out like cards, so every part gets an even share of
 * א, ב and ג (4 + 4 + 4 for a 36-word list).
 */
export function dealParts(course: Course, test: TestUnit, rand: () => number = Math.random): Card[][] {
  const parts: Card[][] = test.weeks.map(() => []);
  for (const wi of test.weeks) {
    shuffle(course.weeks[wi]?.cards ?? [], rand).forEach((card, i) => parts[i % parts.length]?.push(card));
  }
  return parts.map((p) => shuffle(p, rand));
}

/**
 * Rebuild a saved mix (Hebrew words per part). Undefined if it no longer matches the list
 * exactly, e.g. after a word was fixed in words.ts, so a fresh mix gets dealt instead.
 */
export function partsFromSaved(course: Course, test: TestUnit, saved: unknown): Card[][] | undefined {
  if (!Array.isArray(saved) || saved.length !== test.weeks.length) return undefined;
  const byHebrew = new Map(cardsForTest(course, test).map((c) => [c.hebrew, c]));
  const used = new Set<string>();
  const parts: Card[][] = [];
  for (const part of saved) {
    if (!Array.isArray(part) || part.length === 0) return undefined;
    const cards: Card[] = [];
    for (const h of part) {
      const card = typeof h === "string" ? byHebrew.get(h) : undefined;
      if (!card || used.has(card.hebrew)) return undefined;
      used.add(card.hebrew);
      cards.push(card);
    }
    parts.push(cards);
  }
  return used.size === byHebrew.size ? parts : undefined;
}

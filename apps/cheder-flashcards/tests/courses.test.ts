import { describe, expect, it } from "vitest";
import { COURSE, cardsForTest, dealParts, partsFromSaved, testForWeek, testsFor } from "../src/courses";
import { isCorrect } from "../src/check";
import { WORD_LISTS } from "../src/words";
import { legacyWeekKey, migrateLearned } from "../src/progress";

const strip = (s: string): string => s.replace(/[⁦-⁩]/g, "");

describe("word lists course", () => {
  it("is Word Lists 1–8 in book order: three columns each, 12 words a week", () => {
    expect(WORD_LISTS.map((l) => l.list)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(WORD_LISTS.map((l) => l.columns.length)).toEqual([3, 3, 3, 3, 3, 3, 3, 3]);
    expect(COURSE.weeks).toHaveLength(24);
    for (const w of COURSE.weeks) expect(w.cards).toHaveLength(12);
    expect(COURSE.weeks.slice(0, 4).map((w) => strip(w.label))).toEqual(["List 1 א", "List 1 ב", "List 1 ג", "List 2 א"]);
    expect(COURSE.weeks.map((w) => w.key).slice(0, 4)).toEqual(["1א", "1ב", "1ג", "2א"]);
    expect(COURSE.weeks[0]?.cards[0]?.hebrew).toBe("כָּל");
    expect(COURSE.weeks[2]?.cards[0]?.hebrew).toBe("רַק");
    expect(COURSE.weeks[5]?.cards[11]?.hebrew).toBe("וְהָיָה");
    expect(COURSE.weeks[6]?.cards[0]?.english[0]).toBe("slave");
    expect(COURSE.weeks[23]?.cards[11]?.hebrew).toBe("זָקֵן");
  });

  it("every card has Hebrew with nikud and an English answer", () => {
    for (const card of COURSE.weeks.flatMap((w) => w.cards)) {
      expect(card.hebrew).toMatch(/^[ְ-ת ,]+$/);
      expect(card.hebrew).toMatch(/[ְ-ׇ]/);
      expect(card.english.length).toBeGreaterThan(0);
      for (const e of card.english) expect(e.trim().length).toBeGreaterThan(0);
    }
  });

  it("no Hebrew word repeats inside a test (each answer is unambiguous)", () => {
    for (const t of testsFor(COURSE)) {
      const words = cardsForTest(COURSE, t).map((c) => c.hebrew);
      expect(new Set(words).size).toBe(words.length);
    }
  });

  it("one test per list, covering its three columns", () => {
    const tests = testsFor(COURSE);
    expect(tests).toHaveLength(8);
    expect(tests.flatMap((t) => t.weeks)).toEqual(COURSE.weeks.map((_, i) => i));
    expect(tests[0]!.weeks).toEqual([0, 1, 2]);
    expect(tests[0]!.label).toBe("List 1 Test");
    expect(tests.map((t) => t.key)).toEqual(["list1", "list2", "list3", "list4", "list5", "list6", "list7", "list8"]);
    for (const t of tests) expect(cardsForTest(COURSE, t)).toHaveLength(36);
  });

  it("moves old saved checkmarks (week numbers) to the same words", () => {
    // old course: 0 = old list 1 (now 1א), 1 = old list 2 (now 1ב), 2 = 3א, …
    expect(migrateLearned([0, 1, 2, 4, 5, 19])).toEqual(["1א", "1ב", "3א", "3ג", "4א", "8ג"]);
    expect(migrateLearned(["2ב", 0, "2ב"])).toEqual(["2ב", "1א"]);
    expect(migrateLearned("junk")).toEqual([]);
    expect(legacyWeekKey(-1)).toBeUndefined();
    const keys = new Set(COURSE.weeks.map((w) => w.key));
    for (let i = 0; i < 20; i++) expect(keys.has(legacyWeekKey(i)!)).toBe(true);
  });

  it("accepts the short form of 'and he …' and plain 'you' for plurals", () => {
    const find = (h: string) => COURSE.weeks.flatMap((w) => w.cards).find((c) => c.hebrew === h)!;
    expect(isCorrect("he said", find("וַיֹּאמֶר").english)).toBe(true);
    expect(isCorrect("and he said", find("וַיֹּאמֶר").english)).toBe(true);
    expect(isCorrect("you", find("אַתֶּם").english)).toBe(true);
    expect(isCorrect("with you", find("אִתְּכֶם").english)).toBe(true);
  });

  it("finds the whole list a week belongs to, for View all", () => {
    expect(testForWeek(COURSE, 0)?.key).toBe("list1");
    expect(testForWeek(COURSE, 4)?.weeks).toEqual([3, 4, 5]);
    expect(testForWeek(COURSE, 99)).toBeUndefined();
  });

  it("deals a big test into 3 parts of 12, with 4 words from each column in every part", () => {
    const test = testsFor(COURSE)[2]!;
    const parts = dealParts(COURSE, test);
    expect(parts.map((p) => p.length)).toEqual([12, 12, 12]);
    const all = parts.flat().map((c) => c.hebrew);
    expect(new Set(all)).toEqual(new Set(cardsForTest(COURSE, test).map((c) => c.hebrew)));
    for (const part of parts) {
      for (const wi of test.weeks) {
        const col = new Set(COURSE.weeks[wi]!.cards.map((c) => c.hebrew));
        expect(part.filter((c) => col.has(c.hebrew))).toHaveLength(4);
      }
    }
  });

  it("restores a saved mix, and refuses one that no longer matches the list", () => {
    const test = testsFor(COURSE)[0]!;
    const saved = dealParts(COURSE, test).map((p) => p.map((c) => c.hebrew));
    expect(partsFromSaved(COURSE, test, saved)?.map((p) => p.map((c) => c.hebrew))).toEqual(saved);
    expect(partsFromSaved(COURSE, test, undefined)).toBeUndefined();
    expect(partsFromSaved(COURSE, test, saved.slice(0, 2))).toBeUndefined();
    const dup = saved.map((p) => [...p]);
    dup[1]![0] = dup[0]![0]!;
    expect(partsFromSaved(COURSE, test, dup)).toBeUndefined();
    const changed = saved.map((p) => [...p]);
    changed[2]![3] = "שָׁלוֹם";
    expect(partsFromSaved(COURSE, test, changed)).toBeUndefined();
  });
});

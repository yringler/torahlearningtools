import { describe, expect, it } from "vitest";
import { COURSE, cardsForTest, testsFor } from "../src/courses";
import { isCorrect } from "../src/check";
import { WORD_LISTS } from "../src/words";

const strip = (s: string): string => s.replace(/[⁦-⁩]/g, "");

describe("word lists course", () => {
  it("is Word Lists 1–8 in book order: lists 1–2 one week, then three columns each, 12 words a week", () => {
    expect(WORD_LISTS.map((l) => l.list)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(WORD_LISTS.map((l) => l.columns.length)).toEqual([1, 1, 3, 3, 3, 3, 3, 3]);
    expect(COURSE.weeks).toHaveLength(20);
    for (const w of COURSE.weeks) expect(w.cards).toHaveLength(12);
    expect(COURSE.weeks.slice(0, 5).map((w) => strip(w.label))).toEqual(["List 1", "List 2", "List 3 א", "List 3 ב", "List 3 ג"]);
    expect(COURSE.weeks[0]?.cards[0]?.hebrew).toBe("כָּל");
    expect(COURSE.weeks[2]?.cards[0]?.english[0]).toBe("slave");
    expect(COURSE.weeks[19]?.cards[11]?.hebrew).toBe("זָקֵן");
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

  it("tests every two weeks, labelled by list and column", () => {
    const tests = testsFor(COURSE);
    expect(tests).toHaveLength(10);
    expect(tests.flatMap((t) => t.weeks)).toEqual(COURSE.weeks.map((_, i) => i));
    expect(strip(tests[0]!.label)).toBe("Test 1 (List 1 – List 2)");
    expect(strip(tests[1]!.label)).toBe("Test 2 (List 3 א–ב)");
    expect(strip(tests[2]!.label)).toBe("Test 3 (List 3 ג – List 4 א)");
    expect(cardsForTest(COURSE, tests[0]!)).toHaveLength(24);
  });

  it("accepts the short form of 'and he …' and plain 'you' for plurals", () => {
    const find = (h: string) => COURSE.weeks.flatMap((w) => w.cards).find((c) => c.hebrew === h)!;
    expect(isCorrect("he said", find("וַיֹּאמֶר").english)).toBe(true);
    expect(isCorrect("and he said", find("וַיֹּאמֶר").english)).toBe(true);
    expect(isCorrect("you", find("אַתֶּם").english)).toBe(true);
    expect(isCorrect("with you", find("אִתְּכֶם").english)).toBe(true);
  });
});

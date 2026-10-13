import { describe, expect, it } from "vitest";
import { COURSE, cardsForTest, testsFor } from "../src/courses";
import { isCorrect } from "../src/check";
import { WORD_LISTS } from "../src/words";

const strip = (s: string): string => s.replace(/[⁦-⁩]/g, "");

describe("word lists course", () => {
  it("is Word Lists 3–8, three columns of 12 each, in book order", () => {
    expect(WORD_LISTS.map((l) => l.list)).toEqual([3, 4, 5, 6, 7, 8]);
    expect(COURSE.weeks).toHaveLength(18);
    for (const w of COURSE.weeks) expect(w.cards).toHaveLength(12);
    expect(COURSE.weeks.slice(0, 4).map((w) => strip(w.label))).toEqual(["List 3 א", "List 3 ב", "List 3 ג", "List 4 א"]);
    expect(COURSE.weeks[0]?.cards[0]?.english[0]).toBe("slave");
    expect(COURSE.weeks[17]?.cards[11]?.hebrew).toBe("זָקֵן");
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
    expect(tests).toHaveLength(9);
    expect(tests.flatMap((t) => t.weeks)).toEqual(COURSE.weeks.map((_, i) => i));
    expect(strip(tests[0]!.label)).toBe("Test 1 (List 3 א–ב)");
    expect(strip(tests[1]!.label)).toBe("Test 2 (List 3 ג – List 4 א)");
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

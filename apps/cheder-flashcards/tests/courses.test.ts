import { describe, expect, it } from "vitest";
import { COURSES, cardsForTest, courseById, testsFor } from "../src/courses";
import type { Course } from "../src/courses";

function course(id: string): Course {
  const c = courseById(id);
  if (!c) throw new Error(`missing course ${id}`);
  return c;
}

describe("shorashim course", () => {
  const c = course("shorashim");
  it("has 25 weeks of 12 = 300 unique roots", () => {
    expect(c.weeks).toHaveLength(25);
    for (const w of c.weeks) expect(w.cards).toHaveLength(12);
    const roots = c.weeks.flatMap((w) => w.cards.map((x) => x.hebrew));
    expect(new Set(roots).size).toBe(300);
  });
  it("every card has Hebrew letters and an English answer", () => {
    for (const card of c.weeks.flatMap((w) => w.cards)) {
      expect(card.hebrew).toMatch(/^[א-ת]+$/);
      expect(card.english.length).toBeGreaterThan(0);
      for (const e of card.english) expect(e.trim().length).toBeGreaterThan(0);
    }
  });
  it("groups into 13 tests of 2 weeks (last has 1)", () => {
    const tests = testsFor(c);
    expect(tests).toHaveLength(13);
    expect(tests[0]?.weeks).toEqual([0, 1]);
    expect(tests[0]?.label).toBe("Test 1 (weeks 1–2)");
    expect(tests[12]?.weeks).toEqual([24]);
    expect(tests[12]?.label).toBe("Test 13 (week 25)");
    expect(cardsForTest(c, tests[0]!)).toHaveLength(24);
  });
});

describe("cheder course", () => {
  it("tests every two paper weeks", () => {
    const c = course("cheder");
    const tests = testsFor(c);
    expect(tests.flatMap((t) => t.weeks)).toEqual(c.weeks.map((_, i) => i));
    expect(tests.every((t) => t.weeks.length <= 2)).toBe(true);
  });
});

it("course ids are unique", () => {
  expect(new Set(COURSES.map((c) => c.id)).size).toBe(COURSES.length);
});

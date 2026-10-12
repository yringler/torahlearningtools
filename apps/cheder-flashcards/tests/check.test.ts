import { describe, expect, it } from "vitest";
import { isCorrect, normalize } from "../src/check";

describe("normalize", () => {
  it("lowercases, trims, collapses whitespace, drops apostrophes", () => {
    expect(normalize("  Don't   GO ")).toBe("dont go");
  });
  it("strips a leading 'to '", () => {
    expect(normalize("to eat")).toBe("eat");
  });
  it("keeps bare 'to'", () => {
    expect(normalize("to")).toBe("to");
    expect(normalize(" To ")).toBe("to");
  });
});

describe("isCorrect", () => {
  it("accepts any listed meaning", () => {
    expect(isCorrect("every", ["all", "every"])).toBe(true);
    expect(isCorrect("all", ["all", "every"])).toBe(true);
    expect(isCorrect("when", ["because", "that", "when"])).toBe(true);
    expect(isCorrect("banana", ["all", "every"])).toBe(false);
  });
  it("accepts dont for don't", () => {
    expect(isCorrect("dont", ["not", "don't"])).toBe(true);
    expect(isCorrect("don't", ["not", "don't"])).toBe(true);
    expect(isCorrect("DON’T", ["don't"])).toBe(true);
  });
  it("ignores case and whitespace", () => {
    expect(isCorrect("  ALSO  ", ["also"])).toBe(true);
    expect(isCorrect("  Until\t", ["until"])).toBe(true);
  });
  it("rejects blank input", () => {
    expect(isCorrect("   ", ["to"])).toBe(false);
    expect(isCorrect("", ["all"])).toBe(false);
  });
  it("short words (<4) need exact match", () => {
    expect(isCorrect("on", ["on"])).toBe(true);
    expect(isCorrect("no", ["on"])).toBe(false);
    expect(isCorrect("of", ["if"])).toBe(false);
  });
  it("length 4 boundary", () => {
    expect(isCorrect("hnd", ["hand"])).toBe(true); // distance 1
    expect(isCorrect("hnad", ["hand"])).toBe(false); // distance 2
    expect(isCorrect("nme", ["name"])).toBe(true);
  });
  it("length 8+ allows 2 typos, not 3", () => {
    expect(isCorrect("mountin", ["mountain"])).toBe(true); // 1
    expect(isCorrect("mountan", ["mountain"])).toBe(true); // 1
    expect(isCorrect("mounton", ["mountain"])).toBe(true); // 2
    expect(isCorrect("mounton ", ["mountain"])).toBe(true);
    expect(isCorrect("mntn", ["mountain"])).toBe(false);
  });
  it("length 4-7 allows only 1 typo", () => {
    expect(isCorrect("pleaze", ["please"])).toBe(true); // len 6, d1
    expect(isCorrect("plaaze", ["please"])).toBe(false); // d2
    expect(isCorrect("becausx", ["because"])).toBe(true); // len 7, d1
    expect(isCorrect("becaxsx", ["because"])).toBe(false); // len 7, d2
  });
  it("strips leading 'to' on either side", () => {
    expect(isCorrect("to eat", ["eat"])).toBe(true);
    expect(isCorrect("eat", ["to eat"])).toBe(true);
  });
  it("'to' itself is only matched by 'to'", () => {
    expect(isCorrect("to", ["to"])).toBe(true);
    expect(isCorrect("two", ["to"])).toBe(false);
    expect(isCorrect("", ["to"])).toBe(false);
  });
  it("accepts comma / or / and separated meanings if one matches", () => {
    expect(isCorrect("banana, every", ["all", "every"])).toBe(true);
    expect(isCorrect("all or every", ["all"])).toBe(true);
    expect(isCorrect("cat and all", ["all"])).toBe(true);
    expect(isCorrect("cat, dog", ["all", "every"])).toBe(false);
    expect(isCorrect("not,dont", ["don't"])).toBe(true);
  });
  it("'or' as an answer works alone", () => {
    expect(isCorrect("or", ["or"])).toBe(true);
    expect(isCorrect("and", ["or"])).toBe(false);
  });
});

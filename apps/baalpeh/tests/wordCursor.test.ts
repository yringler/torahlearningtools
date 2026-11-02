import { describe, expect, it } from "vitest";
import { stepWord, wordAvail, wordOrdinal, type WordAvail } from "../src/wordCursor";

// chunk 0: 3 words, middle one unglossed; chunk 1: 2 words
const avail: WordAvail = [[true, false, true], [true, true]];

describe("stepWord", () => {
  it("Next with no selection starts at the first word; Back does nothing", () => {
    expect(stepWord(avail, null, 1, true)).toEqual({ chunk: 0, word: 0 });
    expect(stepWord(avail, null, -1, true)).toBeNull();
  });

  it("skips words without a gloss", () => {
    expect(stepWord(avail, { chunk: 0, word: 0 }, 1, true)).toEqual({ chunk: 0, word: 2 });
    expect(stepWord(avail, { chunk: 0, word: 2 }, -1, true)).toEqual({ chunk: 0, word: 0 });
  });

  it("crosses chunks only when allowed, and never wraps", () => {
    expect(stepWord(avail, { chunk: 0, word: 2 }, 1, true)).toEqual({ chunk: 1, word: 0 });
    expect(stepWord(avail, { chunk: 0, word: 2 }, 1, false)).toBeNull();
    expect(stepWord(avail, { chunk: 1, word: 0 }, -1, false)).toBeNull();
    expect(stepWord(avail, { chunk: 1, word: 1 }, 1, true)).toBeNull();
    expect(stepWord(avail, { chunk: 0, word: 0 }, -1, true)).toBeNull();
  });
});

describe("wordOrdinal", () => {
  it("counts within the chunk or across the mishnah", () => {
    expect(wordOrdinal(avail, { chunk: 1, word: 1 }, false)).toEqual({ n: 2, total: 2 });
    expect(wordOrdinal(avail, { chunk: 1, word: 1 }, true)).toEqual({ n: 4, total: 4 });
  });
});

describe("wordAvail", () => {
  it("marks words that have a gloss at the same index", () => {
    expect(wordAvail([{ he: "א ב ג", en: "", words: [{ he: "א", en: "a" }, { he: "ב", en: "b" }] }])).toEqual([[true, true, false]]);
  });
});

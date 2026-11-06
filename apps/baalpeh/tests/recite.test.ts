import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Recite, recitePages, type ReciteSection } from "../src/components/Recite";
import type { Cue } from "../src/types";

const sections = (sizes: number[]): ReciteSection[] => {
  let start = 0;
  return sizes.map((n, i) => {
    const s = { label: `משנה ${i + 1}`, start, end: start + n };
    start += n;
    return s;
  });
};

const render = (sizes: number[]): string => {
  const secs = sections(sizes);
  const total = sizes.reduce((a, b) => a + b, 0);
  const cards = Array.from({ length: total }, (_, i) => ({ he: `מילה${i}` }));
  return renderToStaticMarkup(createElement(Recite, {
    cards, sections: secs, phases: [cards.map(() => 4 as Cue)], prompts: ["Say it."], onDone: () => {},
  }));
};

describe("Recite sections and paging", () => {
  it("pages one section at a time with 3+ sections or more than 24 cards", () => {
    expect(recitePages(6, sections([3, 3]))).toHaveLength(1);
    expect(recitePages(9, sections([3, 3, 3]))).toEqual(sections([3, 3, 3]).map((s) => [s]));
    expect(recitePages(30, sections([10, 20]))).toHaveLength(2);
    expect(recitePages(30, undefined)).toHaveLength(1);
  });

  it("shows only the first mishnah, with Next and no 'I said it', on the first of several pages", () => {
    const html = render([2, 2, 2]);
    expect(html).toContain("Mishnah 1 of 3");
    expect(html).toContain("Next mishnah");
    expect(html).not.toContain("I said it");
    expect(html.match(/class="mcard"/g)).toHaveLength(1);
  });

  it("shows every section and 'I said it' when it fits on one page", () => {
    const html = render([2, 3]);
    expect(html).toContain("I said it");
    expect(html).not.toContain("Next mishnah");
    expect(html.match(/class="mcard"/g)).toHaveLength(2);
    expect(html).toContain("cards compact");
  });
});

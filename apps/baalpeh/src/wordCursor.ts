import { useCallback, useEffect, useState } from "react";
import { words } from "./hebrew";
import type { Chunk } from "./types";

/** A selected word: chunk index and word index within that chunk. */
export interface WordPos {
  chunk: number;
  word: number;
}

/** Which words can be selected, per chunk: a word needs a gloss at the same index. */
export type WordAvail = readonly (readonly boolean[])[];

export function wordAvail(chunks: readonly Chunk[]): boolean[][] {
  return chunks.map((c) => words(c.he).map((_, i) => c.words[i] !== undefined));
}

/** Every selectable position in reading order. */
export function positions(avail: WordAvail, crossChunks: boolean, chunk: number): WordPos[] {
  const out: WordPos[] = [];
  avail.forEach((row, c) => {
    if (!crossChunks && c !== chunk) return;
    row.forEach((ok, w) => {
      if (ok) out.push({ chunk: c, word: w });
    });
  });
  return out;
}

const same = (a: WordPos, b: WordPos): boolean => a.chunk === b.chunk && a.word === b.word;

/**
 * Step from `pos` by `dir` (+1 = next word, -1 = previous). With no selection, Next starts at the
 * first word and Prev does nothing. Returns null at either end (no wrap-around).
 */
export function stepWord(
  avail: WordAvail,
  pos: WordPos | null,
  dir: 1 | -1,
  crossChunks: boolean,
): WordPos | null {
  const list = positions(avail, crossChunks, pos?.chunk ?? 0);
  if (!pos) return dir === 1 ? (list[0] ?? null) : null;
  const at = list.findIndex((p) => same(p, pos));
  if (at < 0) return null;
  return list[at + dir] ?? null;
}

/** 1-based place of `pos` among the selectable words, and how many there are. */
export function wordOrdinal(avail: WordAvail, pos: WordPos, crossChunks: boolean): { n: number; total: number } {
  const list = positions(avail, crossChunks, pos.chunk);
  return { n: list.findIndex((p) => same(p, pos)) + 1, total: list.length };
}

function isTypingTarget(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  return t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName);
}

export interface WordCursor {
  sel: WordPos | null;
  /** Tap: select the word, or clear the selection if it is already selected. */
  tap: (chunk: number, word: number) => void;
  next: () => void;
  prev: () => void;
  clear: () => void;
  canNext: boolean;
  canPrev: boolean;
}

/**
 * Selected-word state for the word panel. Hebrew reads right to left, so the next word is to the
 * left: ArrowLeft = next, ArrowRight = previous. Keys are active only while `keys` is true.
 * The selection resets whenever `resetKey` changes (e.g. a new chunk).
 */
export function useWordCursor(avail: WordAvail, crossChunks: boolean, keys: boolean, resetKey: unknown): WordCursor {
  const [sel, setSel] = useState<WordPos | null>(null);

  useEffect(() => setSel(null), [resetKey]);

  const tap = useCallback((chunk: number, word: number) => {
    setSel((s) => (s && s.chunk === chunk && s.word === word ? null : { chunk, word }));
  }, []);
  const move = useCallback(
    (dir: 1 | -1) => setSel((s) => stepWord(avail, s, dir, crossChunks) ?? s),
    [avail, crossChunks],
  );
  const next = useCallback(() => move(1), [move]);
  const prev = useCallback(() => move(-1), [move]);
  const clear = useCallback(() => setSel(null), []);

  useEffect(() => {
    if (!keys) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey || isTypingTarget(e.target)) return;
      if (e.key === "ArrowLeft") { e.preventDefault(); next(); }
      else if (e.key === "ArrowRight") { e.preventDefault(); prev(); }
      else if (e.key === "Escape" && sel) clear();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [keys, next, prev, clear, sel]);

  return {
    sel,
    tap,
    next,
    prev,
    clear,
    canNext: stepWord(avail, sel, 1, crossChunks) !== null,
    canPrev: stepWord(avail, sel, -1, crossChunks) !== null,
  };
}

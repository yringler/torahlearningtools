/** Hebrew combining marks: cantillation, nikud, shin/sin dots, dagesh, rafe, meteg (U+0591–U+05C7 except punctuation). */
const MARK = /[֑-ׇֽֿׁׂׅׄ]/;
const LETTER = /[א-ת]/;

/** First letter of a word together with its nikud, e.g. "מֵאֵימָתַי" → "מֵ". Leading punctuation is skipped. */
export function firstLetter(word: string): string {
  const chars = [...word];
  const start = chars.findIndex((c) => LETTER.test(c));
  if (start < 0) return word.slice(0, 1);
  let end = start + 1;
  while (end < chars.length && MARK.test(chars[end] ?? "")) end++;
  return chars.slice(start, end).join("");
}

/** Trailing punctuation (kept visible at every cue level so the rhythm of the phrase stays). */
export function trailingPunct(word: string): string {
  const m = /[.,:;?!)]+$/.exec(word);
  return m ? m[0] : "";
}

export const words = (s: string): string[] => s.split(/\s+/).filter(Boolean);

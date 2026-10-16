# Cheder Flashcards

## Audience
The app is used by a 7–8 year old on their own. Keep it easy for a 7 year old to use:
- Big buttons, few choices per screen, short simple words (no jargon, no long instructions).
- Every screen has an obvious way forward and an obvious way back.
- Be forgiving: typos are accepted, nothing can be broken or lost by tapping the wrong thing.
- Encouraging feedback, never scolding.

## Code
- TypeScript, strict. Vanilla DOM (no framework), Vite build, Vitest tests (`npm test`, `npm run build`).
- Word data: `src/words.ts` — the cheder "Word List" pages (lists 1–8 so far). Each page has columns
  א ב ג, each column one week of 12 words: 1א, 1ב, 1ג, 2א, … This is the only word list.
  The course and the one-test-per-list grouping live in `src/courses.ts`. Progress is saved by stable
  keys ("3א", "list3") in `src/progress.ts`, never by position.
- Hebrew is always displayed with nikud.

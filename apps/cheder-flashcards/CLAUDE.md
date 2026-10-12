# Cheder Flashcards

## Audience
The app is used by a 7–8 year old on their own. Keep it easy for a 7 year old to use:
- Big buttons, few choices per screen, short simple words (no jargon, no long instructions).
- Every screen has an obvious way forward and an obvious way back.
- Be forgiving: typos are accepted, nothing can be broken or lost by tapping the wrong thing.
- Encouraging feedback, never scolding.

## Code
- TypeScript, strict. Vanilla DOM (no framework), Vite build, Vitest tests (`npm test`, `npm run build`).
- Word data: `src/data/shorashim.json` (300 roots, 25 weeks × 12) and `src/words.ts` (cheder-paper weeks).
  Courses and the every-2-weeks test grouping live in `src/courses.ts`.
- Hebrew is always displayed with nikud. For shorashim, show the voweled `example` form
  (Qal 3ms past like אָמַר, or the binyan the root is mostly used in, like דִּבֶּר) — never the bare root.

# Cheder Flashcards

Hebrew to English vocabulary for kids. Pick a list:

- **300 Shorashim** — 300 basic Biblical Hebrew roots, most common first, 12 a week (25 weeks).
- **Cheder papers** — the weekly word sheets from cheder.

Each week has **Learn** (flashcards: flip, then "I knew it" / "Again"). Every two weeks there's a **Test** (type the English). Progress and best scores are saved on the device.

## Run locally

```
npm install
npm run dev      # dev server
npm test         # unit tests for the answer checker
npm run build    # type-check + build to dist/
npm run preview  # serve the built site
```

## Add a cheder week

Open `src/words.ts` and append an entry to `WEEKS`:

```ts
{
  id: 3,
  label: "Week 3",
  words: [
    { hebrew: "בַּיִת", english: ["house", "home"] },
  ],
},
```

`english` lists every accepted answer (the first is shown as the correct answer). No other code changes are needed. Tests are grouped automatically, two weeks each.

The shorashim list lives in `src/data/shorashim.json`.

## Deploy

Pushing to `main` builds and deploys `dist` to GitHub Pages (set Pages source to "GitHub Actions" in repo settings).

# Cheder Flashcards

A simple Hebrew to English vocabulary quiz. Pick a week, pick how many questions, type the English.

## Run locally

```
npm install
npm run dev      # dev server
npm test         # unit tests for the answer checker
npm run build    # type-check + build to dist/
npm run preview  # serve the built site
```

## Add a week

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

`english` lists every accepted answer (the first is shown as the correct answer). No other code changes are needed.

## Deploy

Pushing to `main` builds and deploys `dist` to GitHub Pages (set Pages source to "GitHub Actions" in repo settings).

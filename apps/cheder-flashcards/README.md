# Cheder Flashcards

Hebrew to English vocabulary for kids, from the cheder **Word List** pages. Each page has three columns (א, ב, ג); each column is one week of 12 words, in book order: List 1 א, List 1 ב, List 1 ג, List 2 א, …

Each week has **🔍 All** (see every word of the list with its meaning), **Learn** (flashcards: flip, then "I knew it" / "Again") and **Test** (type the English for that week's 12 words).

Each list also has a big **List Test** covering all three columns. So it isn't 36 questions in a row, it is split into 3 parts of 12, each part a mix of 4 words from each column. The mix is saved on the device, so the parts stay the same until **🔀 New mix** deals them again. Finishing all 3 parts saves the list's total score. Progress, best scores and mixes are saved on the device.

## Run locally

```
npm install
npm run dev      # dev server
npm test         # unit tests for the answer checker
npm run build    # type-check + build to dist/
npm run preview  # serve the built site
npm run test:e2e # build, then check in a real browser that the app works offline
```

## Works offline

Open the app once with internet (and add it to the home screen if you like). After that it works with no internet. When a new version is out, it is installed in the background and switches on by itself after the child leaves the app while on the home screen, never in the middle of a quiz.

To re-make the icons: `node scripts/make-icons.mjs`.

## Add a word list

Open `src/words.ts` and add an entry to `WORD_LISTS` (in page order):

```ts
{
  list: 9,
  columns: [
    [w("בַּיִת", "house", "home"), /* …12 words of column א */],
    [/* column ב */],
    [/* column ג */],
  ],
},
```

`w(hebrew, ...english)` lists every accepted answer (the first is shown as the correct answer). Always include nikud. No other code changes are needed. Tests are grouped automatically, one per list.

## Deploy

Hosted as a static-assets Cloudflare Worker (`cheder-flashcards`), configured in `wrangler.jsonc`.

```
npx wrangler login   # once
npm run deploy       # test, build, upload dist/
```

To deploy on every push instead, connect the repo in the Cloudflare dashboard (Workers & Pages → `cheder-flashcards` → Settings → Builds) with build command `npm run build` and deploy command `npx wrangler deploy`.

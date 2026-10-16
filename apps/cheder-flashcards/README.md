# Cheder Flashcards

Hebrew to English vocabulary for kids, from the cheder **Word List** pages. Each page has three columns (א, ב, ג); each column is one week of 12 words, in book order: List 1 א, List 1 ב, List 1 ג, List 2 א, …

Each week has **Learn** (flashcards: flip, then "I knew it" / "Again"). Each list has one **Test** (type the English) covering all three of its columns. Progress and best scores are saved on the device.

## Run locally

```
npm install
npm run dev      # dev server
npm test         # unit tests for the answer checker
npm run build    # type-check + build to dist/
npm run preview  # serve the built site
```

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

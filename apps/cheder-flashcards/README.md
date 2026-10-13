# Cheder Flashcards

Hebrew to English vocabulary for kids, from the cheder **Word List** pages. Each page has three columns (א, ב, ג); each column is one week of 12 words, in book order: List 1, List 2 (one week each), then List 3 א, List 3 ב, List 3 ג, List 4 א, …

Each week has **Learn** (flashcards: flip, then "I knew it" / "Again"). Every two weeks there's a **Test** (type the English). Progress and best scores are saved on the device.

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

`w(hebrew, ...english)` lists every accepted answer (the first is shown as the correct answer). Always include nikud. No other code changes are needed. Tests are grouped automatically, two weeks (columns) each.

## Deploy

Hosted as a static-assets Cloudflare Worker (`cheder-flashcards`), configured in `wrangler.jsonc`.

```
npx wrangler login   # once
npm run deploy       # test, build, upload dist/
```

To deploy on every push instead, connect the repo in the Cloudflare dashboard (Workers & Pages → `cheder-flashcards` → Settings → Builds) with build command `npm run build` and deploy command `npx wrangler deploy`.

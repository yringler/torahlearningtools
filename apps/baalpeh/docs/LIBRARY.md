# Library mode

The whole Mishnah to read, with the same kid-level meanings, Steinsaltz excerpts and word glosses the learning app
uses. Anyone can open it, from anywhere, and read anything. It is not memorizing, so it tracks no progress.

## What it is

- **Open to everyone.** It needs no account and makes no server requests. It doesn't belong to any child.
- **Remembers only where you were**, never what you know:
  - **Opened for a child** (from the child's perek map or mishnah screen): the last mishnah that child read is kept in
    the child's `settings.libraryPlace` (`"sukkah/2/3"`). It syncs like `lastMasechta`, so it follows the child to
    other devices. The top bar names the child, and "▶ Continue reading" goes back to that place.
  - **Opened any other way** (welcome screen, picker, guest, a link): the last mishnah read is kept on this device
    only (`baalpeh:library:last`).
  - **Either way**, the text size (`baalpeh:library:scale`) and Simple or Steinsaltz (`baalpeh:library:view`) are
    this device's library settings, separate from any child's learning settings.
- **Screens:** Library home (Continue + the six sedarim) → a seder's masechtos → the masechta's perakim, with a
  numbered circle per mishnah, so any mishnah is one tap away → **one mishnah per page**. A page shows the summary,
  each piece with tappable words and its meaning (Simple / Steinsaltz / Hide), the whole-mishnah Steinsaltz, and
  Next / Back. Next and Back cross into the next or previous perek, and the last mishnah links back to the
  masechtos. Hebrew-only masechtos show the text alone, as they do in learning.

  One mishnah per page, rather than a scrolling perek, keeps the word cursor, the summary and the "where am I" exact,
  and avoids a very long scroll for a child.

## Ways in

| From | Control | "‹ Done" / Back returns to |
|---|---|---|
| Welcome screen (signed out) and the offline screen | "📚 Open the Library" under "Continue as guest" | Welcome |
| "Who's learning?" | a dashed 📚 Library tile after Guest (and a button when there are no children yet) | the picker |
| Guest mode (signed out, or the picker's guest) | a "📚 Library" pill beside the guest pill, and a button in the guest sheet | the same guest screen, progress intact |
| A child's perek map | "📚 Library" beside "Choose a different masechta" (opens Library home, with the child's Continue) | the perek map |
| A child's mishnah screen | "📚 Library" in the top bar (opens straight at that mishnah) | the mishnah screen |
| A link `/library/...` | — | the normal start (sign-in or the picker) |

A child can read any perek in the library, including ones still locked for learning. The library is open to
everyone, and reading there never counts as learning.

## URLs

| URL | Opens |
|---|---|
| `/library` | Library home |
| `/library/s:<seder>` | that seder's masechtos |
| `/library/<masechta>` | the perakim |
| `/library/<masechta>/<perek>/<mishnah>` | reading |

The address bar follows the reader (with `replaceState`), so any page can be bookmarked or shared. Opening the
library from inside the app pushes one history entry, so the browser's (or Android's) Back leaves the library in one
step. A link that doesn't name a real place opens the nearest valid place above it.

## How it's built (and why it's in this app)

It's a route of `apps/baalpeh`, not a separate app. A separate Worker would need a shared package (the monorepo has
no npm workspaces), a second copy or cross-origin fetch of the ~20 MB of masechta files, a second offline cache, a
second domain and workflow, and a new Android flavor (the wrapper keeps only its own host in-app). Inside this app it
reuses everything:
- the hashed `/data/m/*.json` files and the service worker's cache, so a masechta downloaded while learning opens
  offline in the library, and the reverse;
- `MishnahStudy` (extracted from `MishnahScreen`), `Meaning`, `WordPanel`, `CueCard` and `TextSizeSheet`;
- the Worker's SPA fallback and the service worker's navigation fallback, which already serve any path.

`wrangler.jsonc` didn't change.

| File | Role |
|---|---|
| `src/library/location.ts` | URL ⇄ place, and the device memory. Pure, and tested in `tests/library.test.ts`. |
| `src/library/LibraryApp.tsx` | The screens. A lazy chunk (~3 kB gzipped); the service worker precaches it with the build. |
| `src/library/LibraryGate.tsx` | Loads a masechta with `readMasechta()`. |
| `src/library/open.ts` | `useOpenLibrary()`, the context the "📚" buttons use. `open({ child, last, onPlace, at })` opens it for a child. |
| `src/App.tsx` (`WithLibrary`) | Opens the library over the auth shell. |

How the pieces fit together:
- **`LibraryGate` and `readMasechta()`.** `readMasechta()` gives the text **without** changing the active masechta
  (the module-level `MASECHTA` in `src/data.ts`), so a learner's screen kept underneath never reads the wrong text.
- **`WithLibrary`.** The auth shell stays mounted but hidden while the library is open. That keeps an in-memory guest,
  the picker and sync alive. A cold `/library` link mounts only the library: no sign-in check and no sync until
  "Done".
- **Import boundary.** A test keeps `src/library/` from importing the API client, sync, auth, parent or progress
  modules. A child's place is saved through the injected `onPlace`: `LearningApp` writes it with
  `withLibraryPlace` (src/nav.ts), only when the place changes.

## Later, if wanted

- Swipe between mishnayos.
- A whole-perek scroll mode.
- Search ("ברכות ב:ג").
- Downloading a whole seder for offline use.
- A separate hostname: make it a Cloudflare redirect rule to `…/library`, not a second app.

**When to split shared code into a package:** when a second deployable needs the reader or the data code, for
example a separate library Worker, or cheder-flashcards reusing the word panel. Then move `src/data.ts`, `types.ts`,
`hebrew.ts`, `wordCursor.ts` and the reader components to `packages/mishnah-reader` as TypeScript source with no
build step. Consumers would use them through a Vite alias plus tsconfig `paths`, and the package path would go into
each consumer's workflow path filter.

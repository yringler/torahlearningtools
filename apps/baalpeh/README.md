# משנה בעל פה — Mishnah Ba'al Peh

A tablet-friendly web app that helps children memorize Mishnayos by heart, starting with **Maseches Brachos**.
It's a static site with no backend; progress is saved in the browser.

## How the learning works

Each mishnah is cut into child-sized **pieces** (2–6 words, split at natural phrase breaks). Pieces are grouped into
**parts** of up to 6. The child goes through a cumulative chain:

```
piece 1 → piece 2 → 1+2 → piece 3 → 1–3 → … → whole part
(long mishnah) part 2 the same way → parts 1+2 → … → whole mishnah → parent check ✓
mishnayos 1–2 in a row → 1–3 in a row → … → whole perek in one shot (parent check) = perek complete
```

Hints fade as the child learns:

| Level | Shows |
|---|---|
| L0 | Full text + simple meaning; tap any word for its meaning |
| L2 | First letter of each word, with its nikud (מֵ·· קוֹ·· אֶ··) |
| L3 | First word of each piece (used in chains) |
| L4 | Empty card, said by heart |

Without speech recognition, honesty comes from **peeks**: tapping a hidden card shows it for 2 seconds and is counted.
A clean round passes. One peek means repeat once. Two or more steps back a hint level, and after three misses the
app runs extra practice on the hardest piece together with the one before it. The "I said it" button is locked for a few seconds so it
can't be tapped through. At the end of every mishnah and every "in a row" chain, a **parent check** screen shows the
parent the full text. The parent taps any words the child slipped on, then grades the recitation.

**Review**: known mishnayos come back after 1, 3, 7, 14, 30, 60 days (Leitner boxes). Once a perek is complete, the
whole perek is reviewed as one item. "Start today's learning" always does due reviews first, then continues new learning,
and suggests stopping after the session length set by the parent (default 15 min).

Other features: a profile for each child, a parent area (hold the lock button for 2 s) with settings, backup
export/import, and per-mishnah reset. Read-aloud is off by default because device voices use Israeli pronunciation
and often ignore nikud.

The design spec this was built from is in [`docs/DESIGN.md`](docs/DESIGN.md).

## Data pipeline

```
scripts/fetch_sefaria.py     → data/raw/berakhot_N.json   (Sefaria v3 API: Hebrew Torat Emet, Steinsaltz, Bartenura/Silverstein)
scripts/chunk.py             → data/chunks.json           (mechanical phrase chunking)
(LLM pass, brief in scripts/GLOSS_PROMPT.md)
                             → data/gloss/perek_N.json    (refined chunks + kid-level meaning per piece and per word)
scripts/validate_gloss.py    checks that the Hebrew matches the source byte for byte, that the Steinsaltz excerpts rebuild
                             Steinsaltz exactly (text and bold), and that every word has a gloss and every piece names its sources
scripts/build_data.py        → src/data/berakhot.json     (what the app bundles)
```

### Meanings and sources

There are two views of each piece's meaning. The child or parent can switch between them, and the parent sets the default.

- **Simple** is one short line for a young reader, sometimes with a short explanation. An AI wrote it by
  simplifying Steinsaltz's bold translation and checking it against Bartenura. Each piece records which source(s) it was
  based on (`basis`), plus a note wherever it follows Bartenura instead of Steinsaltz.
- **Steinsaltz** is quoted word for word from the Koren Noé / William Davidson translation. **Bold** is the
  translation and the lighter text is his explanation. Longer explanations sit behind "more…". The validator
  guarantees the excerpts, put back together, are exactly Steinsaltz's text.

Word meanings (tap a word) follow Steinsaltz's bold translation. Sources show up only through a small ⓘ next to each meaning
(source names and a link to the mishnah on Sefaria), so there are no footnotes.

Translations used: Steinsaltz (primary) and Bartenura translated by R. Shraga Silverstein (secondary).
Not used: Open Mishnah (a community translation), Mishnah Yomit (Kulp), and De Sola & Raphall (on Sefaria it covers
only perek 1 of Brachos).

The simple lines are still AI-written, so **a parent should check them**.

To add another masechta: change `BOOK` in `fetch_sefaria.py`, rerun the pipeline, and generate gloss files.

## Develop

```bash
npm install
npm run dev          # local dev server
npm test             # logic tests (chunking/segments/steps/progress/SRS)
npm run build        # → dist/ (GitHub Pages, base /Baalpeh/)
npm run build:single # → dist-single/index.html, one self-contained file you can open or share
```

**Deploy**: in the repo settings, under Pages, set the source to "GitHub Actions". Each push to `main` then deploys.
On iPad/iPhone, open the site and use "Add to Home Screen". Safari can clear saved data for sites that aren't on the home screen.

## Sources & licenses

Hebrew text: Torat Emet 357 via [Sefaria](https://www.sefaria.org) (public domain). English: William Davidson
Edition (Steinsaltz, CC-BY-NC) and The Mishna with Obadiah Bartenura by R. Shraga Silverstein (CC-BY), via Sefaria. This project is for
non-commercial use, in keeping with the CC-BY-NC source.

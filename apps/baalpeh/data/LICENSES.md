# Text sources and licenses for `data/`

The files in this folder (and the bundled `src/data/berakhot.json` built from them) contain or adapt the texts below,
all downloaded from [Sefaria](https://www.sefaria.org) by `scripts/fetch_sefaria.py`. The app shows the same
attribution at `/licenses`.

| Text | Sefaria version | License | Where it appears |
|---|---|---|---|
| Mishnah, Hebrew with nikud | Torat Emet 357 | [Public domain](https://en.wikipedia.org/wiki/Public_domain) | `raw/*.json` (`he`), `chunks.json`, `gloss/*.json` (`he`) |
| Steinsaltz English, R. Adin Even-Israel Steinsaltz, from The William Davidson digital edition of the Koren Noé Talmud (Koren Publishers Jerusalem) | William Davidson Edition - English | [CC BY-NC 4.0](https://creativecommons.org/licenses/by-nc/4.0/) | `raw/*.json` (`steinsaltz`); verbatim excerpts in `gloss/*.json` (`stIntro`, `st`, `stMore`) |
| The Mishna with Obadiah Bartenura, tr. R. Shraga Silverstein | The Mishna with Obadiah Bartenura by Rabbi Shraga Silverstein | [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/) | `raw/*.json` (`bartenura`) |

## Changes and adaptations

- Markup is stripped, Unicode is NFC-normalized, and the Hebrew is split into short pieces (`chunks.json`, `gloss/`).
- Steinsaltz excerpts in `gloss/` are verbatim, split to line up with the Hebrew pieces.
- The `summary`, `en`, `explain` and word `en`/`note` fields in `gloss/` are AI-written simplifications of Steinsaltz's
  translation, checked against Bartenura (`basis` on each piece lists which). Because they adapt CC BY-NC material,
  they are shared under **CC BY-NC 4.0** and may not be used commercially.

Nothing here is affiliated with or endorsed by Koren, Sefaria, the Steinsaltz Center or the translators.

## Before charging money

Showing the Steinsaltz text or anything adapted from it in a paid product needs one of two things first: written
permission from Koren, or rebuilding the meanings from the CC BY / public-domain sources only. Silverstein's
Bartenura covers every mishnah of Berakhot.

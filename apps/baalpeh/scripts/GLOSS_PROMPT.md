# Gloss brief: sourced, kid-level meanings

The children's meanings must be **grounded in established translations, not invented**.
Sources (all in `data/chunks.json` per mishnah):

- `steinsaltz` — **primary**. William Davidson Edition (Koren Noé, R. Adin Steinsaltz). `<b>bold</b>` is the literal
  translation of the Mishnah's words; plain text is his explanation.
- `bartenura` — **secondary**. R. Shraga Silverstein's translation with Bartenura's explanation in [brackets].
  Use it to check Steinsaltz and to pick explanations a child will understand.
- Don't use any other translation (no Open Mishnah/community translations, no Kulp).

Output: `data/gloss/perek_<N>.json` — array, one object per mishnah:

```json
{
  "perek": 1, "mishnah": 2,
  "summary": "1–2 simple sentences: what this mishnah is about (age ~8).",
  "stIntro": "verbatim Steinsaltz text that comes before the translation of the first chunk (often empty)",
  "chunks": [
    {
      "he": "<exact Hebrew chunk>",
      "en": "Simple meaning of the phrase, grade 2–4 level, following Steinsaltz's bold translation.",
      "explain": "OPTIONAL. ≤ 15 simple words, only when the phrase can't be understood without it.",
      "st": "verbatim Steinsaltz excerpt for this chunk: its <b>bold</b> translation + short plain bridging words",
      "stMore": "OPTIONAL verbatim continuation: Steinsaltz's longer explanatory sentences that follow this chunk",
      "basis": ["steinsaltz"],
      "basisNote": "OPTIONAL one short line, only when en/explain follows Bartenura rather than Steinsaltz or they differ",
      "words": [ { "he": "<exact word>", "en": "1–4 word gloss", "note": "optional: who/what is this" } ]
    }
  ]
}
```

## Hard rules (checked by `python3 scripts/validate_gloss.py data/gloss/perek_<N>.json`)

1. Hebrew: `he` words are exactly the source words. You may move chunk boundaries (2–6 words, max 7) but never
   change a word. `words[].he` == `he.split(" ")`.
2. **Steinsaltz excerpts are verbatim**: `stIntro` + each chunk's `st` + `stMore`, in order, must reproduce the
   mishnah's `steinsaltz` field exactly — same characters, same bold (whitespace is ignored). Each piece needs
   balanced tags. When a `<b>…</b>` span covers two chunks, close it at the end of one piece and reopen it in the
   next one: `"<b>can distinguish between sky-blue and white.</b>"` + `"<b>Rabbi Eliezer says:</b>"`. Every chunk's
   `st` must contain some text. Put long explanations (more than ~1 short clause) into `stMore`, so `st` stays
   short: mostly the bold translation.
3. `basis` lists the sources the kid meaning (`en`/`explain`) is drawn from: a non-empty subset of
   `["steinsaltz","bartenura"]`. Default `["steinsaltz"]`.

## Style
- `en` follows Steinsaltz's bold, simplified. Don't add facts that are in neither source.
- Gloss the whole word, prefixes included (וַחֲכָמִים → "and the Sages"). Keep word glosses consistent with the bold.
- Use the transliterations a frum child knows (Shema, Kohanim, Shabbos, bracha, davening, tefillah).
- `explain` is rare and minimal: a child just learning to read must not be overwhelmed.
- No footnotes, brackets, or HTML in `en`/`explain`/`words`.

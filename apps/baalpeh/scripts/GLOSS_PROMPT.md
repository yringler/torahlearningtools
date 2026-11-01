# Gloss-generation brief (used for the Opus agents)

Input: `data/chunks.json` — array of {perek, mishnah, chunks[] (Hebrew strings), steinsaltz, kulp}.
Output: `data/gloss/perek_<N>.json` — array, one object per mishnah of that perek:

```json
{
  "perek": 1, "mishnah": 1,
  "summary": "1-2 simple sentences: what this mishnah is about, for a 9-year-old.",
  "chunks": [
    { "he": "<exact Hebrew chunk>",
      "en": "Simple meaning of this phrase, grade 2-4 reading level.",
      "words": [ { "he": "<exact word>", "en": "1-4 word gloss", "note": "optional: who/what is this, one short sentence" } ] }
  ]
}
```

Rules
- The Hebrew words must be EXACTLY the source words (same nikud/punctuation), in order. Concatenating all chunks of a
  mishnah must reproduce the source word sequence exactly. You MAY move chunk boundaries to make more natural phrases
  (2-6 words, never more than 7; avoid splitting a phrase like "מַה שֶּׁאָמְרוּ חֲכָמִים"), but never change words.
- `words[].he` must equal `chunk.he.split(" ")` exactly (punctuation stays attached).
- Gloss the whole word including prefixes (מֵאֵימָתַי → "from when?", וַחֲכָמִים → "and the Sages").
- Use Steinsaltz (primary) and Kulp to be accurate; then simplify. Keep "en" for a chunk as a natural English phrase
  that reads well in sequence; bracket nothing, no footnotes, no HTML.
- Use `note` only for terms a child may not know (תְּרוּמָה, כֹּהֲנִים, שְׁלִיחַ צִבּוּר, names of Tannaim: "a great Rabbi of the Mishnah").
- Keep familiar Jewish terms in transliteration where a frum child knows them (Shema, Kohanim, Shabbos, bracha, davening).
- Validate with `python3 scripts/validate_gloss.py data/gloss/perek_<N>.json` until it prints OK.

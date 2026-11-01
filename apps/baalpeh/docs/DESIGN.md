# Ba'al Peh Mishnayos: Design Spec (v1)

## 1. Core model

- **Chunk**: 3–7 words, split at `.` `,` `:` and natural phrase breaks. Precompute these at build time and let the parent edit them later.
- **Segment**: up to 6 chunks. A Mishnah with 6 or fewer chunks is one segment. Longer ones split at the nearest sentence break to the middle (3 segments if more than 12 chunks).
- **Step**: one item in the chaining sequence. The step list is generated, never hand-authored:
  `C1, C2, [1-2], C3, [1-3], C4, [1-4] … [1-n]` for each segment, then `[Seg A+B]` (whole Mishnah), then `[M1..Mk]` (perek chain).
- **Mastery states per Mishnah**: New → Learning → Known (whole Mishnah recited cold) → Solid (passed 2+ spaced reviews).

## 2. Screens and flow (MVP)

1. **Who's learning?** Large avatar tiles, one per child (name plus color/animal). Below them, a small "Parent" button behind a hold-for-2-seconds gate.
2. **Child home ("Today")**: one big button, **"Start today's learning"**. It runs any due reviews first (capped at about 5 minutes), then continues new learning where the child left off. Under it is the perek map: one row per perek (פרק א׳ … ט׳), and each Mishnah is a circle filled to its mastery state.
3. **Mishnah screen** (from the map or the flow). Header: "ברכות א׳:א׳". Under it, a step path drawn right to left: small stones for steps, larger stones for chain steps. The current stone pulses gently. One sentence of "what this Mishnah is about" sits at the top (kid-friendly).
4. **Practice step** (the main screen, described in §3).
5. **Step result**: a short check animation (under 1 second) and an auto-advance to the next step. Every 3–4 steps, a "Take a breath / keep going?" prompt.
6. **Milestone**: segment, Mishnah or perek done. A calm celebration screen. For Mishnah and perek milestones, a "Show Abba/Ima" check (§4).
7. **Parent area**: profiles, chunk-boundary editor, review of glosses, settings (font size, TTS, havara note), export/import progress, and a per-child history view.

**Later:** a printable perek certificate, parent-recorded audio, and a "start from Mishnah N" drill.

## 3. Exactly what the child sees per step

**Learning a new chunk (C_n), in four phases on one screen:**
1. **Read and understand.** The chunk appears in full (cue level L0), with its meaning line beneath in smaller text. A 🔊 button plays it (if enabled). Tapping a word opens its gloss. Prompt: "Read it out loud 2 times." The child taps "Done" twice (a counter shows ○○ → ●●).
2. **Faded.** L2 (first letters). "Say it."
3. **Hidden.** L4. "Say it without looking." Buttons: **"I said it"** / **"Peek"**.
4. A peek re-runs phase 3. Two peeks drop the chunk back to L2 for one more round.

**Chain step [1..n]:** all chunks so far are shown as a row of cards, each at the cue level of that step. The prompt is "Say it all from the beginning." It starts at **L3** (first word of each chunk). The step only counts as passed after one clean recitation at **L4**. The newest chunk can show one level more help than the older ones.

**Cue-fading levels (recommended):**
| Level | Shows | Use |
|---|---|---|
| L0 | Full text with nikud | First exposure |
| L1 | Full text in light grey, no meaning line | Optional re-read |
| L2 | First letter of each word, with its nikud, plus dots for the rest (מֵ··· קוֹ··· אֶת···) | Early recall |
| L3 | First word of each chunk only | Chains |
| L4 | Empty chunk cards (outline only) | The real test |

**Peek** reveals only the *next* chunk, for 2 seconds, then hides it again. Each peek is counted automatically. Grading comes from that count plus a self-report:
- 0 peeks and "I said it" = **pass**.
- 1 peek = **pass with help**. Repeat the step once at the same level.
- 2 or more = **not yet**. Drop one cue level and repeat. After 3 fails, insert a mini-step that practices only the failed chunk plus the one before it.

During recall (L2–L4), tapping a word does nothing, so the child can't "peek" by accident. Meaning lines are hidden in recall.

## 4. Checking recall without speech recognition

- **Self-check (default)**: peek counting plus "I said it", as in §3. Never offer "I said it" without the child having seen the hidden state. Disable the button for about 3 seconds per chunk so it can't be tapped through.
- **Parent check (MVP, required at milestones)**: the screen flips into a "parent view". The parent holds the device and the child recites from memory. The parent sees the full text in large type, and each word is tappable to mark a slip (it turns underlined orange). The parent then picks **Perfect / Small slips / Needed help**:
  - "Needed help" keeps the Mishnah in Learning.
  - Marked words become a targeted re-drill of the chunks that contain them.
- **Perek milestone = parent check only.** It is the stable "one shot" goal, so it must be verified by a person.
- **Later**: optional recording of the child's recitation for the parent to hear afterwards (MediaRecorder, stored in IndexedDB, auto-deleted after 7 days).

## 5. Long Mishnayos and the perek chain

- Segment B runs the same chunk chain from C1. Its steps are labeled "Part 2". Then `[A+B]` at L3 → L4.
- Perek chain: when Mishnah k becomes Known, add the step `[M1..Mk]`. It shows one card per Mishnah carrying only its **opening word** (L3), and passing requires L4.
- When k is 5 or more, a full chain can take 5+ minutes. Allow **one full chain per session**. On other days, do a **rolling pair** `[M(k-1)+Mk]`, which practices the joins between mishnayos. Joins are the most common place kids get stuck.

## 6. Progress and motivation

- The **step path** (stones) and the **perek map** (filling circles) are the main progress display. They show real progress and need no points.
- Use stars only for **Mishnah Known** (1) and **Solid** (a second star). A finished perek gets a gold border on its map row.
- Show a gentle **"days learned this week"** dot row. Don't use a breakable streak counter, because losing a streak punishes a missed Shabbos or Yom Tov. Skip Shabbos/Yom Tov in any day counting.
- Don't use leaderboards or show one child's progress on another child's screen.
- Sessions are short, with a goal of about 10–15 minutes ("2 new chunks + review"). The parent can set this.
- Celebrations are brief: a soft tone, a check, the child's name. The perek siyum (later) is a printable certificate to show the family.

## 7. Meaning

- **Chunk meaning**: one line under the chunk in learn phase, at grade-2 to grade-4 reading level. Example: "From what time can we say Shema at night?"
- **Word tap**: a bottom sheet with the word in large type and a 1–4 word gloss. Gloss the *whole word including prefixes* (מֵאֵימָתַי → "from when?"). An optional "Who/what is this?" line for terms like כֹּהֲנִים or תְּרוּמָה.
- Generate all glosses **at build time** into static JSON, never live. Put them in a parent review screen where uncertain items are flagged. The LLM must produce output keyed to the exact chunk and word indices.
- Optional (later): a picture or emoji for concrete nouns.

## 8. Review / spaced repetition (MVP)

- Each Known Mishnah has a Leitner box with intervals of **1, 3, 7, 14, 30, 60 days**.
- A review is a cold recitation at L4 with peek counting:
  - Pass moves it up one box.
  - Pass-with-help keeps it in the same box.
  - Fail drops it to box 1 and schedules a short relearn at L2 → L4.
- Once a **perek is complete**, schedule the *perek* as one item on the same intervals and suspend its mishnayos' separate reviews. A failed perek review sends only the slipped mishnayos (identified by peeks or parent marks) back to box 1.
- Daily order: due reviews first (oldest first, capped), then new learning. Interleave one older perek when one is due.

## 9. Typography and accessibility

- `<html dir="rtl" lang="he">`. Font: **Taamey Frank CLM** or **Frank Ruhl Libre / Noto Serif Hebrew**, checked so that nikud renders correctly. Body text **36–44px** on a tablet with **line-height ≥ 2.0** so nikud isn't clipped. Not justified, with extra word-spacing.
- Chunks keep fixed line breaks, so the visual shape stays stable from L0 to L4. That shape is itself a memory cue.
- Touch targets ≥ 56px, word tap areas padded, main buttons at the bottom within reach of a thumb. Never rely on color alone (add icons or text). Include a font-size slider and dark mode.
- **TTS caveat**: browser `speechSynthesis` he-IL voices vary by device. Many ignore or mangle nikud and Mishnaic forms, and all of them use modern Israeli pronunciation, which may not match the family's havara (e.g., Ashkenazi). Default TTS to **off** and label it "approximate". **Later, the best option**: the parent records each chunk (stored in IndexedDB), and that recording replaces TTS.

## 10. Multiple children

- Each profile has its own progress, settings and SRS state, stored as `localStorage["baalpeh:v1:profile:<id>"]` plus a profile index. Profiles have no passwords. Each child can learn a different perek.
- The parent area shows each child's status: what's due and the last few sessions.

## 11. Data and robustness

- Bundle the Sefaria text as static JSON at build time. **Pin one vocalized version**, strip HTML and footnote markup, and normalize Unicode (NFC). This avoids runtime API failures and keeps chunk indices stable.
- Prompt the parent to back up with **Export/Import JSON**. Call `navigator.storage.persist()`. Note that **iOS Safari can wipe localStorage after about 7 days without visits** unless the app is added to the Home Screen as a PWA.
- Version the storage schema and migrate on load.

## 12. Pitfalls to avoid

- **Inflated self-reports**: counting peeks automatically, delaying the "I said it" button, and requiring parent checks at milestones keep grading honest.
- **Chains that are too long**: tired kids stop learning. Cap full-perek chains per session and use rolling pairs.
- **Showing meaning or tappable words during recall**: this leaks the answer.
- **Chunks that split mid-phrase**, or split a word from its prefix. Let the parent fix boundaries.
- **Teaching wrong pronunciation** through TTS, or a gloss that is wrong. Use parent review and parent audio.
- **Rushing to the next Mishnah** while earlier ones decay. Reviews always come first.
- **Only ever starting from Mishnah 1**: kids can't start in the middle of a perek. Add a "start from Mishnah N" drill later.
- **Over-gamification**: confetti, coins and sibling rankings take attention away from the learning itself.
- **Losing months of progress** because storage was cleared.

## Priority summary

**MVP**: profiles; perek map; generated chaining steps with L0–L4 cues and peek counting; parent check at milestones; chunk and word meanings from static JSON; Leitner review at Mishnah and perek level; RTL typography; export/import.

**Later**: parent-recorded audio, recitation recording, chunk/gloss editor UI, "start from N" drill, certificates, optional TTS improvements.

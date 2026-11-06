# Perek build-up (roadmap item 1)

This spec covers how a child builds a perek up the same way they build up a mishnah: mishnah 1 → mishnah 2 → 1+2 → mishnah 3 → 1–3 → … → the whole perek. The perek also becomes selectable: tapping it on the map opens a perek screen with its own step path. Email verification (item 2) and parent editing of progress (item 3) are **not** built here. §10 describes the seam that item 2 plugs into.

Two proposals were merged into this spec: a UX one and a progress-model one. Every conflict between them is listed in §11 together with the choice made. Where this spec states a fact about the current code, the code was checked.

## 0. Facts from the current code

- `buildSteps(chunks)` (src/steps.ts) produces the mishnah step list. `MishnahProgress.stepIndex` is a raw index into that list, so **`segments`/`buildSteps` must not change**. This spec does not touch them.
- Berakhot has these perek sizes: `[5, 8, 6, 7, 5, 8, 5, 8, 5]`. The largest perek, 9, has `[5, 20, 15, 8, 44]` pieces, 92 in total.
- `PerekProgress {chainedThrough, complete, review?}` is written only by `parentCheckChain`. `pr.complete` is read in six places: `dueReviews`, `nextLearning`, `Home.tsx` (gold row), `MishnahScreen.tsx` ("due today"), `Session.tsx` (practiced view) and `Parent.tsx` (`perakimDone`).
- Two places rebuild perek data field by field, so they **silently drop unknown fields**: `worker/lib/validate.ts perekData()` and `src/sync/mapping.ts cleanPerek()`. Any new field has to be added to both.
- `src/sync/store.ts` applies pulled `p` records exactly as received. Guest v1 storage is not validated. Readers of `chains` therefore have to be defensive.
- `Task` values live only in in-memory `Screen` state and are never persisted, so the `Task` union can be changed freely.
- Events are stored with selected columns plus the full JSON (`events.data`), so new optional event fields need no migration.
- The `PERAKIM` and `mishnayosOf` bindings change when `setMasechta` runs. **Do not memoize** perek steps across masechtos. With n ≤ 12 they are cheap to recompute.
- Session's `upNext` calls `nextLearning(profile)` directly. `more` is passed only when `continueLearning` is set.

## 1. Step model (new `src/perekSteps.ts`, pure)

```ts
export const MAX_PEREK_PART = 5;
export type PerekStep =
  | { kind: "mishnah"; mishnah: number; label: string }                          // 1-based
  | { kind: "chain"; from: number; to: number; newest: number; label: string };  // 1-based, inclusive
export function perekParts(n: number): Array<[number, number]>   // 1-based inclusive ranges
export function stepsForCount(n: number): PerekStep[]           // pure core (testable for any n)
export function perekSteps(perek: number): PerekStep[]          // = stepsForCount(mishnayosOf(perek).length); not memoized
export const chainKey = (from: number, to: number): string => `${from}-${to}`;
export function parseChainKey(k: unknown): [number, number] | null // null unless /^\d{1,3}-\d{1,3}$/ and 1 <= from <= to
export function perekPathSteps(steps: PerekStep[]): Step[]      // adapter for pathGroups (0-based, see below)
export function perekSegs(perek: number): Array<[number, number]> // perekParts shifted to 0-based
export function perekPracticeLabel(perek: number, from: number, to: number): string
```

- **`perekParts(n)`** splits evenly by count. There are `count = ceil(n / MAX_PEREK_PART)` parts, and the bound for part `s` is `round(n * s / count)`. Nothing is weighted by piece count and there is no sentence heuristic. In Berakhot this gives:
  - 5 → one part
  - 6 → 3+3
  - 7 → 4+3
  - 8 → 4+4
  - For any n ≥ 6, every part has at least 3 mishnayos.
- **`perekSteps`**:
  - For each part `[a..b]`, the steps are `M a, M a+1, C[a..a+1], M a+2, C[a..a+2] … C[a..b]`.
  - A one-mishnah part gets **no** solo chain step, because a known mishnah has already been said by heart. A one-mishnah part can only happen when n = 1.
  - After the parts come the joins `C[1..end of part si]` for si = 2..count.
  - Examples:
    - n=5: `M1 M2 C1-2 M3 C1-3 M4 C1-4 M5 C1-5`
    - n=8: `M1 M2 C1-2 M3 C1-3 M4 C1-4 M5 M6 C5-6 M7 C5-7 M8 C5-8 C1-8`
    - n=1: `[M1]`
  - **Invariant:** for n ≥ 2, the last step is `C[1..n]`. This is the "review the whole perek" step that item 2 puts right before "I'm ready to be tested".
  - `newest` is the chain's `to`.
- **Labels** use Arabic digits. They match the existing in-mishnah labels ("Pieces 1–3 together") and avoid bidi trouble.

  | Step | Label |
  |---|---|
  | Mishnah step | `Mishnah 3` |
  | Chain, one-part perek | `Mishnayos 1–3 together` |
  | Chain, multi-part perek | `Part 2 · Mishnayos 5–7 together` |
  | Non-final join (only with 3+ parts) | `Parts 1–2 together` |
  | `C[1..n]` | `The whole perek!` |

  Hebrew numerals are used only on tiles and circles (`hebNum`).
- **`perekPathSteps`** lets the existing `pathGroups` node model draw perakim:
  - A mishnah step becomes `{kind:"learn", chunk: m-1, label}`.
  - A chain step becomes `{kind:"chain", from: from-1, to: to-1, newest: newest-1, label}`.
- **`src/steps.ts`** changes in one place only. Add `pathGroupsFor(steps, segs)` with the current body of `pathGroups`, and redefine `export const pathGroups = (steps, chunks) => pathGroupsFor(steps, segments(chunks))`. Existing callers and outputs stay the same.
  - Perek callers use `pathGroupsFor(perekPathSteps(s), perekSegs(perek))`.
  - `stepPosition`, `groupRange` and `groupIndexOf` work unchanged.
- **`perekPracticeLabel`** returns:
  - `from === to` → `Mishnah 2`
  - `1..n` with n ≥ 2 → `The whole perek`
  - otherwise → `Mishnayos 1–2 together`

## 2. Data model and migration

### 2.1 Types (`src/types.ts` and `shared/api.ts`, kept identical; `_typesMatchShared` must keep compiling)

```ts
export interface PerekProgress {
  /** Longest passed chain [1..k]. Still maintained, for older clients and as legacy input (see chainSatisfied). */
  chainedThrough: number;
  /** Finished the build-up and passed the end-of-perek gate (today: the in-app parent check).
   *  Read only through perekStage()/perekDone(). */
  complete: boolean;
  review?: ReviewItem;
  /** Passed build-up chain ranges, "from-to" (1-based), sorted, none contained in another. Absent on older data. */
  chains?: string[];
}
```

- Nothing is stored for mishnah steps. `M k` is satisfied iff `isKnown(mp(p, perek, k))`.
- **No perek cursor is stored.** The current step is derived. Because chains are stored as semantic ranges rather than step indices, changing `MAX_PEREK_PART` later cannot misplace saved progress.
- `blankPerek()` is unchanged (`{chainedThrough: 0, complete: false}`, with no `chains` key).
- **No `verified` field** (see §10).

### 2.2 Derived state (`src/progress.ts`)

```ts
function passedRanges(pr: PerekProgress): Array<[number, number]>
// Parses pr.chains defensively: non-array, non-string, bad format, or from > to → ignored.
// Adds [1, chainedThrough] when chainedThrough >= 1.
export function chainSatisfied(p, perek, from, to): boolean   // pr.complete || some [a,b] with a <= from && to <= b
export function stepSatisfied(p, perek, s: PerekStep): boolean // mishnah → isKnown; chain → chainSatisfied
export function perekFrontier(p, perek): number                // index of the first unsatisfied step; steps.length = all satisfied
export type PerekStage = "building" | "ready" | "complete";
export function perekStage(p, perek): PerekStage               // complete if pr.complete === true; ready if frontier === steps.length; else building
export const perekDone = (p, perek) => perekStage(p, perek) === "complete";
export function canStartPerekStep(p, perek, s: PerekStep): boolean // mishnah → true; chain → every mishnah in from..to known
export function joined(p, perek, m: number): boolean           // golden join between m-1 and m: m >= 2 && chainSatisfied(p, perek, m-1, m)
```

**Migration is containment.** Old records are read correctly as they are, with no rewrite, no D1 migration and no version bump:

| Saved state | Result |
|---|---|
| `complete: true` | Every step is satisfied and the stage is "complete". |
| `chainedThrough: k` | Every chain inside 1..k is satisfied. |
| `{chainedThrough: 3}`, M1–M4 known | Frontier `C1-4`. |
| `{chainedThrough: 0}`, M1–M2 known | Frontier `C1-2` (same as the old scheduler). |
| `{chainedThrough: 2}`, M1–M5 known | `C1-3`, then `C1-4`, then `C1-5`. The old scheduler asked for one 1–5 chain. This is accepted: on the perek screen the child can say `C1-5` directly, and containment satisfies the rest. |

### 2.3 Writers (`src/progress.ts`)

- **`passPerekChain(p, perek, from, to): Profile`**
  - If `chainSatisfied` is already true, return `p` itself (same object, so no sync row is created).
  - Otherwise add `chainKey(from, to)` and drop any stored entries contained in the new range.
  - Store the list in canonical order (by `from`, then `to`) so JSON diffs stay stable.
  - Set `chainedThrough = max(cur, from === 1 ? to : 0)`.
  - **Never sets `complete`.**
- **`checkPerek(p, perek, grade): Profile`** is the gate and is the **only** writer of `complete`.
  - No-op unless `perekStage === "ready"`.
  - `notyet` → returns `p` unchanged. The perek stays "ready" and the child can retry. Slips do not demote mishnayos, which is today's behaviour.
  - `pass`/`help` → `{...cur, complete: true, chainedThrough: n, review: cur.review ?? newReview()}`. `chains` is kept.
- **Delete `parentCheckChain`.** Its only caller is Session, and its tests are rewritten.
- `knownPrefix`, `reviewPerek` and `resetMishnah` are unchanged.
  - Resetting mishnah k reopens `M k` as the frontier. The stored chains stay, which the frontier tolerates. Pruning them is item 3.

### 2.4 Readers of `.complete`

All six readers listed in §0 switch to `perekDone(p, perek)`. After this change, `perekStage` is the only function that reads `pr.complete`.

## 3. Scheduling

### 3.1 The Task union (`src/progress.ts`)

```ts
| { type: "learn"; perek; mishnah }                                   // unchanged; also the perek "M k" step
| { type: "review-m"; perek; mishnah }                                // unchanged
| { type: "practice"; perek; mishnah; from; to; label }               // unchanged (mishnah-level)
| { type: "perek-chain"; perek; from: number; to: number }            // CHANGED (was {through}): a build-up chain step
| { type: "perek-finish"; perek }                                     // NEW: end of the build-up → "ready to be tested" (§7)
| { type: "perek-practice"; perek; from: number; to: number; label }  // NEW: practice a range of known mishnayos; changes no progress
| { type: "review-p"; perek }                                         // unchanged
```

### 3.2 `nextInPerek` and `nextLearning`

```ts
export function nextInPerek(p, perek): Task | null {
  const stage = perekStage(p, perek);
  if (stage === "complete") return null;
  if (stage === "ready") return { type: "perek-finish", perek };
  const s = perekSteps(perek)[perekFrontier(p, perek)];
  return s.kind === "mishnah" ? { type: "learn", perek, mishnah: s.mishnah }
                              : { type: "perek-chain", perek, from: s.from, to: s.to };
}
export function nextLearning(p): Task | null {
  for (const perek of PERAKIM) {
    if (perekDone(p, perek)) continue;  // item 2: also stop at a locked perek
    return nextInPerek(p, perek);
  }
  return null;
}
```

- These two functions replace all the old special cases (`prefix >= 2`, in-progress first, first new, the n=1 rule).
- A chain is never scheduled over an unknown mishnah, because every `M` step comes before its chains.
- A mishnah learned out of order is skipped once it is known.
- **Behaviour change (accepted):** a mishnah left "learning" beyond the frontier is no longer resumed first. It waits until the frontier reaches it.
- `dueReviews` keeps the same logic, with `perekDone` in place of `pr.complete`. Passing a chain does **not** count as a mishnah review.
- **No per-session cap on long chains.** DESIGN §6 says the app never tells the child to stop on its own. The longest chains are bounded by parts (at most 5 mishnayos) and by the single `C1..n`.

### 3.3 What passing a chain step means

- A chain step is graded by **self-check only, with no parent check**, the same way an in-mishnah chain step is.
  - `pass`/`help` → `passPerekChain`.
  - `notyet` → a detour and then a retry (§6).
- The one parent check left is at the gate (`perek-finish`), and that gate is what item 2 replaces.
- Owner to confirm: until item 2 ships, intermediate chains are only self-graded.

## 4. Home map: the golden thread (`src/screens/Home.tsx`, new `src/components/PerekStrip.tsx`)

- `Home` gets a new prop `onOpenPerek: (perek: number) => void`.
- Each perek row becomes a centred column:
  1. A **header button** `<button class="perek-head">`. It holds:
     - a 36px conic **ring**, filled to `satisfied steps / total steps`
     - `פרק ב׳`
     - `✓` when `perekDone`
     - a `›`

     Its `aria-label` reads `Perek 2, 9 of 15 steps, open perek`, it is at least 56px tall, and tapping it calls `onOpenPerek`.
  2. A **`<PerekStrip>`** of mishnah circles.
- Between rows there is a vertical **spine**, `<div class="spine" aria-hidden>`. It gets `.spine.done` when the perek above is `perekDone`. `.perek-map` gap becomes 0.
- **`PerekStrip`** (`{profile, perek, size: "map" | "big", justJoined?: number[]}`):
  - It renders, right to left, `circle, join, circle, join, …`. Each join and the circle after it sit together in one `span.seg` (`white-space: nowrap`).
  - **Circles**:
    - They keep the existing `.circle.new/learning/known/solid` classes and stars.
    - On the map, tapping a circle calls `onOpenMishnah`. The `size: "big"` strip is not interactive (`aria-hidden`).
  - **Join `m-1→m`**:
    - `.join.done` if `joined(p, perek, m)`.
    - `.join.here` if `nextLearning`'s task is a `perek-chain` in this perek with `from < m <= to` and the join is not done.
    - `.join.just` if m is in `justJoined` (a snap animation).
    - Otherwise todo (dotted).
  - **"You are here"**: if `nextLearning` is a `learn` task in this perek, that circle gets `.circle.here`, and the row gets `.perek-row.current`.
- **Delete** the old `.circle .link` span and its CSS. Colour is never the only signal: a done join is thick and solid, a todo join is dotted, and a done perek shows ✓.
- CSS goes in `src/styles.css` and follows the UX sketch:
  - `.perek-map`, `.perek-row`, `.perek-row.current`, `.perek-head`, `.perek-head .ring`
  - `.strip`, `.strip .seg`
  - `.join`, `.join.done`, `.join.here`, `.join.just`, `.circle.here`
  - `.spine`, `.spine.done`
  - `@media (max-width: 400px)`: 38px circles and 8px joins, so 8 circles fit about 360px
  - `prefers-reduced-motion`: no animation
  - Use the class name `join`, not `link`, which StepPath already uses.

## 5. Perek screen (new `src/screens/PerekScreen.tsx`, new `src/components/PerekPath.tsx`)

### 5.1 Routing (`src/LearningApp.tsx` and `src/GuestApp.tsx`, wired identically)

- **New Screen variant** `{ s: "perek"; id; perek; group?: number; sel?: string }`. Guest mode uses the same variant without `id`. `sel` is a selection key (§5.3), restored when coming back from a practice run.
- **Mishnah screen**: the `mishnah` Screen gains `from?: "perek"`. `MishnahScreen` gains a prop `backLabel?: string`. When `from === "perek"`, `onBack` goes to `{s: "perek", perek}` and the label reads `‹ Perek`. Otherwise it stays `‹ Map`.
- **Session screen**: the `session` Screen gains `scopePerek?: number`. Session `more` becomes:
  - `scopePerek !== undefined` → `(p) => nextInPerek(p, scopePerek)`
  - `continueLearning` → `nextLearning`
  - otherwise → absent
- **Session props**: `Session` gets a prop `upNextOf?: (p: Profile) => Task | null`. LearningApp passes the same scoped function as `more`, and `upNext = queue[0] ?? (upNextOf ?? nextLearning)(profile)`.
- Sessions started from the perek screen use `back: {...screen, group, sel}`.

### 5.2 Layout, top to bottom

1. **Topbar**: `‹ Map` and the child's name.
2. **Title** `{MASECHTA.masechta} פרק {hebNum(perek)}`, with a subline (ltr) such as `8 mishnayos · 2 parts · 9 of 15 steps`.
3. **`<PerekStrip size="big">`**.
4. **`<PerekPath>`**: the group that holds the frontier (or `group`), with part pills ("Part 1", "Part 2", "All together") that show progress bars.
5. **Action area**: a caption plus one primary button, with an optional secondary button (§5.3).
6. **Mishnah list**: one row per mishnah, showing its circle, its first 3 words (Hebrew) and its `summary` (English). Tapping a row opens the MishnahScreen with `from: "perek"`.

### 5.3 PerekPath and selection

**Drawing and state**
- `PerekPath` is a **new component**. `StepPath` is left untouched to avoid regressions.
  - It reuses `pathGroupsFor`, the `.chain`/`.tile`/`.link`/`.cap`/`.parts` markup and CSS classes, and the variant class `.chain.perek`.
  - Tile faces show `hebNum(mishnah)` without the ׳ and are round.
  - Done links are gold.
  - The cap is 🎯 "Ready to be tested".
- Node state is **not linear**. It comes from `stepSatisfied` and `canStartPerekStep`:

  | State | When |
  |---|---|
  | `done` | `stepSatisfied` |
  | `current` | the frontier |
  | `partial` | a mishnah tile that is `learning`, drawn half-filled |
  | `locked` | a chain that cannot start: dashed, with 🔒 |
  | `upcoming` | everything else |

- The cap is `current` when the stage is "ready" and `done` when it is "complete".
- `aria-label` is `label + state word`, as in StepPath.

**Tapping selects; nothing starts by itself**

`sel` is `"M3"`, `"C1-3"`, `"G1"` (group index) or `"cap"`. The caption and buttons depend on the selection:

| Selection | Caption | Primary | Secondary |
|---|---|---|---|
| Nothing selected | — | the frontier action (below) | — |
| Mishnah tile, not known | `Mishnah 3` | `▶ Learn mishnah 3` → `learn` | `Open mishnah 3 ›` → MishnahScreen |
| Mishnah tile, known | `Mishnah 3 alone` | `▶ Practice mishnah 3` → `perek-practice 3..3` | `Open mishnah 3 ›` |
| Link, satisfied | `Mishnayos 1–3 together` | `▶ Practice mishnayos 1–3` → `perek-practice` | — |
| Link, startable, not satisfied | `Mishnayos 1–3 together` | `▶ Say mishnayos 1–3 together` → `perek-chain` (real; passing it satisfies contained steps) | — |
| Link, locked | `Learn mishnah 4 first` (the first unknown mishnah in the range) | none | — |
| Part pill | "Practice all of Part 1" when all its mishnayos are known | `perek-practice` over the part's range | — |
| Cap, stage "ready" | — | the `perek-finish` action | — |
| Cap, otherwise | `Finish every step first` | none | — |

Notes on the table:
- A part pill also switches the group shown.
- The cap is the only way to reach `perek-finish` by tapping.

**Frontier action** (from `nextInPerek`):
- `learn` → `▶ Learn mishnah 3` (or `▶ Keep learning mishnah 3` if `stepIndex > 0`)
- `perek-chain` → `▶ Say mishnayos 1–3 together`
- `perek-finish` → `🎯 I'm ready to be tested`
- complete → `🔁 Review the perek` (`review-p`, with the sub `due today` when it is due)

The frontier button starts the session with `scopePerek: perek`, so "keep going" stays inside this perek.

**Practice cue**: when a selection is a practice range, show the first word of each mishnah in it below the path (`.practice-cue`), joined with ` … `.

**"Choose your own" two-circle ranges are deferred** (§11). The selection model above already gives "mishnah 2 alone", "1–2 together" and so on.

## 6. Session: chain steps and practice (`src/screens/Session.tsx`)

### 6.1 `PerekStepTask` (handles `perek-chain` and `perek-practice`)

**Header**
- Title: `ref(perek) · {label}`, with a `task-sub` of `Practice` when it is practice.
- A read-only `<PerekPath>` of the step's group, with no taps.
- **No Back/Next.** Free navigation lives on the perek screen, and ✕ exits to `back`.

**Cards**
- One `ReciteCard` per **phrase** (chunk) of mishnayos `from..to`, flattened, passed with `sections` = one `{label: "משנה " + hebNum(m), start, end}` per mishnah.
- A peek on a card reveals that phrase only.

**Cue phases**

| Range | Warm-up | Test |
|---|---|---|
| Within one part (not a join) | phrases of older mishnayos at L3; the newest mishnah's phrases at L2 with `newest` highlight | every phrase at L4 |
| Join or `C1..n` | the first phrase of each mishnah at L3; the rest L4 | every phrase at L4 |
| Practice, `from === to` | L3 | L4 |
| Practice, longer range | the same phases as the matching shape above | L4 |

**Prompts**
- Warm-up: `Say mishnayos 1–3 from the beginning. The first word of each piece will help.`
- Test: `Now all of it, without looking! Tap a piece if you get stuck.`

**Grading** (`onDone(g, peeks)`)
- Emit `recite` with:
  - `task`: `"perek-chain"`, or `"practice"`, or `"detour"` while on a detour
  - `mishnah: null`
  - `step`: the perek step index (null for practice/detour)
  - `from`, `to`
- `pass`/`help`:
  - Chain → `onProfile(passPerekChain(...))`, then the "chain" celebration (§8).
  - Practice → `onProfile(profile)` only (marks the day), then the `practiced` view.
- `notyet` → detour, mirroring StepRunner:
  1. Sum the peeks per section and take the worst mishnah `w`.
  2. Detour over `{from: max(step.from, w-1), to: w}` with the within-part phases and the label `Extra practice`.
  3. Then retry the original step (`attempt + 1`).
  - Practice gets the same detour.

### 6.2 `Recite` changes (`src/components/Recite.tsx`; all props optional, existing callers unchanged)

- **`sections?: Array<{label: string; start: number; end: number}>`**: renders a `<section class="mcard">` with a label per section. Its cards are `.cards.compact`, where each pill is inline-block, `font-size: calc(1.6rem*var(--scale))`, `line-height: 2`, padding `2px 10px`, `flex-wrap` with a 6px row gap, and a dashed outline at L4.
- **Paging**: if `sections` has more than 2 entries **or** more than 24 cards, show one section per page.
  - `‹ Next mishnah` sits bottom-left (RTL), `Back ›` sits on the right, and the counter reads `Mishnah 2 of 4`.
  - `✓ I said it` appears only on the last page.
  - The lock runs per page (`lockMs(cards on page)`).
  - Peeks accumulate across pages, and a phase change resets to page 1.
- Grading logic is unchanged.

### 6.3 `PerekReviewTask`

- This is today's `PerekChainTask`, renamed and limited to `review-p`.
- It keeps one card per mishnah and the ParentCheck, then `reviewPerek`.
- Its behaviour does not change.

## 7. End of the build-up: `perek-finish` (new `src/components/PerekReady.tsx`)

**When it is reached**
- Passing `C1..n` triggers it. Session's chain branch: after `passPerekChain`, if `perekStage === "ready"`, it queues `{type:"perek-finish"}` immediately instead of celebrating.
- "Continue learning" also lands here, through `nextLearning`.
- So does the cap on the perek screen.
- n = 1: when M1 becomes known, the stage is "ready", so `perek-finish` comes next.

**`PerekReady` props**: `{profile, perek, onReady: () => void, onPracticeMore: () => void}`.

**`PerekReady` layout**
- 🎯 and `You built the whole perek, {name}!`
- `<PerekStrip size="big">`, all gold.
- **"Look it over first"**, collapsed (`<details>`): the perek **phrase by phrase** at L0, grouped by mishnah. This is the same split the item-2 email will use, so put it in a helper `perekPhrases(perek): Array<{mishnah: number; phrases: string[]}>` in `perekSteps.ts`.
- **Primary button**: `🎯 I'm ready to be tested`.
- **Secondary button**: `Practice more first` → `onPracticeMore`. Session calls `onExit`, which returns to the perek screen when started from there, or else goes to the map.

**Session wiring, today**
- `onReady` shows the existing `ParentCheck` over one card per mishnah.
- It then emits `check {scope: "chain", through: n}` and calls `checkPerek(grade)`.
- `pass`/`help` → the existing perek celebration (`You finished …!`, 3 stars, milestone "perek", map only).
- `notyet` → `{title: "Almost!", sub: "Practice the whole perek and try again.", stars: 0}`. The stage stays "ready".

**Rule**: no other code treats the in-app check as official completion. `checkPerek`'s call site in the `perek-finish` branch is the single place that changes in item 2.

## 8. Celebrations and labels (`Session.tsx`)

- **`Milestone`** gains `"chain"`.
- **Mishnah learned**: same as today, plus a `<PerekStrip size="big">` with `justJoined` empty. If `upNext` is a `perek-chain`, its joins render `.here`.
- **Chain passed**:
  - Title: `Mishnayos 1–3 together! ⭐` (1 star) and a big PerekStrip with `justJoined` = the joins from..to.
  - When `to` ends a part: title `Part 1 of the perek — done!`, and **map primary** (a natural stopping point).
  - Otherwise the primary is `upNext` (`nextLabel`) and the secondary is `My map`.
- **`nextLabel(t)`**:

  | Task type | Label |
  |---|---|
  | `learn` | `Next: mishnah 4 ›` |
  | `perek-chain` | `Say mishnayos 1–3 together ›` |
  | `perek-finish` | `Finish the perek ›` |
  | otherwise | `Keep going ›` |

- **Practiced view**:
  - Generalize it to `perek-practice`: `‹ Back to the perek` (onExit) and `Practice it again`.
  - There is no "review it now" offer.
  - The `!pp().complete` test becomes `!perekDone()`.
- **Home sub-label**: when nothing is due and `next` is set, show `Next: mishnah 4` / `Next: mishnayos 1–3 together` / `Next: finish Perek 2` instead of `Continue learning`.

## 9. Validation, sync and events

### Perek record (`worker/lib/validate.ts perekData`)
- `if (o.chains !== undefined)` it must be an array with ≤ 64 entries, each a string matching `/^\d{1,3}-\d{1,3}$/` with `1 ≤ from ≤ to`. Anything else throws `Invalid`.
- When `chains` is absent, the output has no `chains` key.

### `src/sync/mapping.ts cleanPerek`
- If `Array.isArray(p.chains)`, copy the valid entries (same rule as the server), deduped, canonical sort, first 64.
- Keep the key even when the result is empty.
- When the input has no array, omit the key, so old-shape rows round-trip byte for byte.
- `cleanPerek` sanitizes client-side so the strict server never rejects a batch.

### Server guard against old cached PWA clients (`worker/routes/sync.ts`, progress upsert; SQL only, no migration)

```sql
data = CASE WHEN excluded.kind = 'p'
             AND json_type(excluded.data, '$.chains') IS NULL
             AND json_type(progress.data, '$.chains') IS NOT NULL
       THEN json_set(excluded.data, '$.chains', json_extract(progress.data, '$.chains'))
       ELSE excluded.data END
```

- With this guard, a push without `chains` keeps the stored chains, and a push with `chains: []` clears them.
- New clients write `chains` once a perek has any chain passed.

### Events (`shared/api.ts` `ReciteEvent`, and the validator)
- Add `from?: number; to?: number`: a 1-based mishnah range for perek-level recites.
- The validator: if present, each is an int 1..999 and `from ≤ to`. Old events stay valid.
- No new `ReciteTask` value, so the `task` column and stats are untouched.

### `src/screens/ChildHistory.tsx`
- `perek-chain` with from/to → `Said Perek 2, mishnayos 1–3 together`.
- `practice` with `mishnah === null` and from/to → `Practiced Perek 2, mishnayos 1–3`.
- `detour` with `mishnah === null` → `Extra practice on Perek 2, mishnayos 3–4`.
- Events without from/to keep the old text.

### Guest mode
- Guest mode uses the same progress functions.
- v1 storage keeps `chains` as stored, `normalizeProfile` keeps perek objects, and import goes through `cleanPerek`. Nothing more is needed beyond the routing in §5.1.

## 10. Seam for email verification (next step)

- **Building up and passing are separate from official completion.**
  - Building up and passing the perek: `passPerekChain` and `perekStage === "ready"`.
  - Official completion: one call, `checkPerek`, in the `perek-finish` branch.
- **What item 2 changes**:
  - It replaces `PerekReady.onReady` with the email request (rate-limited) and adds a `waiting` state to PerekReady ("We sent Abba/Ima your perek! 📨").
  - It sends `perekPhrases(perek)` as the phrase-by-phrase text.
- **Verification belongs on the server, not in `PerekProgress`.** `PerekProgress` is client-written and last-write-wins, and old clients drop unknown fields. Item 2 should add a server-owned record (for example kind `"v"`, written only by the email-link route and refused from `/api/sync`) that is pulled into `Profile.verified?: Record<string, Ms>`.
- **Stages and locking**:
  - `perekStage` gains `"awaiting-test"` / `"verified"`, and is the only function that reads verification.
  - `perekLocked(p, perek)` is true for every perek after the first one that is done but not verified. It feeds:
    - `nextLearning`'s loop (the comment marks the spot)
    - `.perek-row.locked` / `.spine.waiting` on Home
    - PerekScreen
  - `nextInPerek` returns `perek-finish` for a locked-out child's first unverified perek, which is "Continue learning brings them to the end-of-perek review/test".
- **Existing profiles**: `complete: true` profiles keep their progress and lack verification, which is exactly what item 2 expects.

## 11. Conflicts resolved

1. **Part size** (UX: 4 mishnayos, weighted by piece count; model: 5, by count): **5, by count.**
   - A 5-mishnah perek (4 of the 9 in Berakhot) stays the single chain the owner described.
   - Weighting adds code without fixing the real outlier (Berakhot 9:5 has 44 pieces); paging handles that one.
   - The ranges are semantic, so the constant can change later without breaking saved data.
2. **Shared step core in steps.ts** (both proposed refactoring `buildSteps`): **rejected.** `stepIndex` depends on its exact output. Perek generation is a separate small function, and only `pathGroupsFor` is extracted.
3. **Generic ChainPath that replaces StepPath** (UX): **rejected.** `StepPath` stays as it is, and the new `PerekPath` reuses `pathGroupsFor` and the CSS. That costs some duplication but carries no regression risk.
4. **How "not yet" works at the gate** (UX: remove `[1..n]` and demote slipped mishnayos; model: no-op): **no-op.** The child stays at "ready", PerekReady offers practice, and today's no-demotion rule is kept. It is also the simplest thing for item 2 to replace.
5. **`verified` field** (UX: `verified?` on PerekProgress; model: server-owned record): **server-owned, and not added now.** See §10.
6. **Task names**: `perek-finish` (neutral) rather than `perek-check`, because the in-app check is temporary. `perek-chain {from, to}` rather than `{from, through}`.
7. **What practice covers** (UX: perek step indices, which can run several steps; model: a range): **a mishnah range.** A part pill practises the part's full range, which keeps the task a single recitation.
8. **Card shape for multi-mishnah recites** (model: one card per mishnah; UX: phrase cards with sections and paging): **phrase cards.** A peek on a whole-mishnah card would flash 20–44 phrases. `PerekReviewTask` keeps one card per mishnah so `ParentCheck` and `reviewPerek` stay unchanged.
9. **Back/Next inside a perek chain step** (UX): **dropped.** Navigation happens on the perek screen, and the Session does not switch task types mid-step.
10. **The "one long chain per session" cap** (UX, optional): **not built**, per the DESIGN no-stopping policy.
11. **"Choose your own" range picker by tapping two circles** (UX): **deferred.** It is a new interaction for young children, and step selection already covers the owner's examples.
12. **Number style**: Arabic digits in English labels, Hebrew numerals on tiles and circles. This avoids bidi-reversed ranges.
13. **`parentCheckChain`** (UX: keep a wrapper; model: delete): **delete**, and update its two tests.
14. **Server upsert guard** (model: optional): **required.** It is small and stops old cached clients from erasing part-2 ranges.

## 12. File-by-file change list

| File | Change |
|---|---|
| `src/perekSteps.ts` (new) | `MAX_PEREK_PART`, `PerekStep`, `perekParts`, `perekSteps`, `chainKey`, `perekPathSteps`, `perekSegs`, `perekPracticeLabel`, `perekPhrases`, `parseChainKey` |
| `src/steps.ts` | Add `pathGroupsFor(steps, segs)`; `pathGroups` delegates to it. Nothing else changes. |
| `src/types.ts`, `shared/api.ts` | `PerekProgress.chains?` / `PerekProgressData.chains?`; `ReciteEvent.from?/to?`; doc comments as in §2.1 |
| `src/progress.ts` | Task union (§3.1); `passedRanges`, `chainSatisfied`, `stepSatisfied`, `perekFrontier`, `perekStage`, `perekDone`, `canStartPerekStep`, `joined`, `passPerekChain`, `checkPerek`, `nextInPerek`; rewrite `nextLearning`; `dueReviews` uses `perekDone`; delete `parentCheckChain` |
| `src/sync/mapping.ts` | `cleanPerek` copies and sanitizes `chains` |
| `worker/lib/validate.ts` | `perekData.chains`; recite `from/to` |
| `worker/routes/sync.ts` | the progress upsert `CASE` (§9) |
| `src/components/PerekStrip.tsx` (new) | §4 |
| `src/components/PerekPath.tsx` (new) | §5.3 |
| `src/components/PerekReady.tsx` (new) | §7 |
| `src/components/Recite.tsx` | `sections`, paging, compact (§6.2) |
| `src/screens/PerekScreen.tsx` (new) | §5 |
| `src/screens/Home.tsx` | header button, strip, spine, `onOpenPerek`, `perekDone`, next sub-label |
| `src/screens/MishnahScreen.tsx` | `backLabel`; `perekDone` |
| `src/screens/Parent.tsx` | `perekDone` |
| `src/screens/Session.tsx` | `PerekStepTask` (chain, practice, detour); `perek-finish` branch with `PerekReady`, `ParentCheck` and `checkPerek`; `PerekChainTask` → `PerekReviewTask` (review-p only); "chain" milestone; `nextLabel`; practiced view for `perek-practice`; `upNextOf` prop; `perekDone` |
| `src/LearningApp.tsx`, `src/GuestApp.tsx` | `perek` screen; `mishnah.from`; `session.scopePerek`; `more`/`upNextOf` wiring; Home `onOpenPerek` |
| `src/screens/ChildHistory.tsx` | from/to wording |
| `src/styles.css` | §4 map CSS; `.chain.perek` variant (round Hebrew faces, gold done links, `.partial`, `.locked` dashed plus 🔒, 🎯 cap); `.mcard`, `.cards.compact`, pager; delete `.circle .link` |
| `docs/DESIGN.md` | §1 (perek sequence), §5 (parts, containment, no per-chain parent check), §8 (perek practice). This is part of the implementation. |

## 13. Tests (vitest)

### `tests/steps.test.ts`

1. `perekSteps` for a 5-mishnah perek (perek 1) is exactly `M1 M2 C1-2 M3 C1-3 M4 C1-4 M5 C1-5`, with labels.
2. For an 8-mishnah perek (perek 2) the steps are the n=8 sequence in §1. Last label: `The whole perek!`.
3. `perekParts`:
   - `perekParts(1) = [[1,1]]` and `perekSteps` for n=1 gives `[M1]` (test it through a stubbed n, or with `perekParts` plus a pure helper `stepsForCount(n)` that `perekSteps` calls; **add `stepsForCount` as the pure core**)
   - 6 → `[[1,3],[4,6]]`
   - 7 → `[[1,4],[5,7]]`
   - every part ≤ `MAX_PEREK_PART`, and the parts cover 1..n exactly once.
4. For every perek in the data:
   - each mishnah appears exactly once as an `M` step
   - each chain's mishnayos all come earlier as `M` steps
   - for n ≥ 2 the last step is `C1..n`.
5. `pathGroupsFor(perekPathSteps(...), perekSegs(...))` covers every step once and keeps groups contiguous. `pathGroups(steps, chunks)` deep-equals `pathGroupsFor(steps, segments(chunks))` for every mishnah.
6. `perekPracticeLabel`: `Mishnah 2`, `Mishnayos 1–2 together`, `The whole perek`.

### `tests/logic.test.ts`

7. A full walk of perek 1 through `nextLearning`: learn 1 → learn 2 → chain 1–2 → learn 3 → chain 1–3 → … → chain 1–5 → `perek-finish` → `checkPerek(pass)` → complete with a review set → learn 2:1. This replaces "goes mishnah 1 → 2 → chain → 3" and "completes a perek and moves on".
8. The walk of perek 2 includes `C5-6`, `C5-7`, `C5-8` and `C1-8`, in order, after `C1-4`.
9. Legacy profiles:
   - `{chainedThrough:3}` with M1–4 known → chain 1–4
   - `{chainedThrough:0}` with M1–2 known → chain 1–2
   - `{chainedThrough:6}` in perek 2 satisfies `C5-6`
   - `{complete:true}` → skipped by `nextLearning`, and `dueReviews` gives `review-p` when it is due.
10. `passPerekChain`:
    - `(1,4)` satisfies `C1-2` and `C1-3` and sets `chainedThrough` to 4
    - `(5,6)` leaves `chainedThrough` alone
    - stored entries contained in the new range are pruned, and the order is canonical
    - it returns the same object when the range is already satisfied
    - it never sets `complete`.
11. `checkPerek`:
    - no-op while "building"
    - `notyet` is a no-op
    - `pass` sets `complete`, `chainedThrough = n` and a review, and keeps `chains`.
12. `perekStage` goes building → ready → complete. For n=1, M1 known gives "ready".
13. Out of order:
    - M3 known before M2: after M2, the next steps are `C1-2` and then `C1-3`, without relearning M3.
    - A "learning" M5 beyond the frontier is not scheduled first.
14. Robustness: `chains` set to `null`, `[3]` or `["3-1","x"]` counts as none and does not throw.
15. `canStartPerekStep`: a chain over an unknown mishnah → false; a mishnah step → true.
16. `joined` follows containment, including legacy `chainedThrough` and `complete`.
17. `resetMishnah(k)` makes `M k` the frontier again.
18. `nextInPerek` only returns tasks from its own perek.

### `tests/mapping.test.ts`

19. `cleanPerek`:
    - keeps valid `chains`
    - drops malformed entries, entries with from > to, and entries past 64
    - adds no `chains` key for old-shape input, so the existing equality test still passes.
20. A change to `chains` alone produces one `p` record that includes `chains`.

### `tests/store.test.ts`

21. A pulled `p` record with `chains` is applied, and an old-shape record still works.

### `tests/import.test.ts` and `tests/guest.test.ts`

22. `normalizeProfile` keeps `chains`, and `profileToRows` carries them.
23. `saveGuest` → `loadGuest` round-trips a perek with `chains`.

### `worker/test/validate.test.ts`

24. `perekData`:
    - accepts `chains`
    - rejects a non-array, a bad string, from > to, and more than 64 entries
    - leaves an absent `chains` absent.
25. A recite event with `from/to` is accepted; from > to is rejected; an old event without them is still accepted.

### `worker/test/sync.test.ts`

26. A `p` record with `chains` pushed from device A is pulled with its `chains` on device B.
27. A later, newer push without `chains` keeps the stored chains. A push with `chains: []` clears them.

### Component tests (if the suite has a DOM setup; otherwise cover the logic through tests 7–18)

28. `Recite` with `sections` pages one mishnah at a time when there are 3 or more sections, and shows `✓ I said it` only on the last page.

### Overall

`npm test` and `npm run build` must pass. `_typesMatchShared` must still compile.

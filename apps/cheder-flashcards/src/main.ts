import "./style.css";
import { COURSE, dealParts, partsFromSaved, shuffle, testForWeek, testsFor, weekTestKey } from "./courses";
import type { Card, Course, TestUnit } from "./courses";
import { isCorrect } from "./check";
import { bestScore, getMix, isLearned, markLearned, recordScore, setMix } from "./progress";
import type { Score } from "./progress";

interface Answer {
  card: Card;
  typed: string;
  correct: boolean;
  /** Marked right by the kid on the check screen: it only had a spelling mistake. */
  spelling?: boolean;
}

const app = document.getElementById("app");
if (!app) throw new Error("#app missing");
const root: HTMLElement = app;

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<Record<string, string>> = {},
  ...children: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v !== undefined) e.setAttribute(k, v);
  }
  e.append(...children);
  return e;
}

function button(label: string, cls: string, onClick: () => void): HTMLButtonElement {
  const b = el("button", { type: "button", class: cls }, label);
  b.addEventListener("click", onClick);
  return b;
}

function mount(...nodes: Node[]): void {
  root.replaceChildren(...nodes);
  window.scrollTo(0, 0);
}

function hebrewCard(card: Card, ...extra: Node[]): HTMLDivElement {
  const box = el("div", { class: "hebrew", dir: "rtl", lang: "he" }, card.hebrew);
  if (card.sub) box.append(el("div", { class: "hebrew-sub" }, card.sub));
  box.append(...extra);
  return box;
}

function progressBar(done: number, total: number, text: string): HTMLDivElement {
  const pct = total === 0 ? 0 : (done / total) * 100;
  const bar = el(
    "div",
    { class: "bar", role: "progressbar", "aria-valuemin": "0", "aria-valuemax": String(total), "aria-valuenow": String(done) },
    el("div", { style: `width:${pct}%` }),
  );
  return el("div", { class: "progress" }, bar, el("div", { class: "progress-text" }, text));
}

// ---------- Course: weeks + tests ----------
function showCourse(course: Course): void {
  const list = el("div", { class: "stack" });
  let firstOpen: HTMLElement | null = null;

  for (const test of testsFor(course)) {
    const unit = el("section", { class: "unit" });
    for (const wi of test.weeks) {
      const week = course.weeks[wi];
      if (!week) continue;
      const learned = isLearned(course.id, week.key);
      const best = bestScore(course.id, weekTestKey(week.key));
      const name = el("div", { class: "week-name" }, `${week.label}${learned ? " ✅" : ""}`);
      if (best) name.append(el("span", { class: "week-best" }, `🏆 ${best.score} / ${best.total}`));
      unit.append(
        el(
          "div",
          { class: "week" },
          name,
          el(
            "div",
            { class: "week-btns" },
            button("🔍 All", "small view", () => showWordList(course, wi, () => showCourse(course))),
            button("📖 Learn", "small", () => runLearn(course, wi)),
            button("🏆 Test", "small test", () => startWeekTest(course, wi)),
          ),
        ),
      );
      if (!learned && !firstOpen) firstOpen = unit;
    }
    const best = bestScore(course.id, test.key);
    unit.append(button(`🏆 ${test.label}`, "test big-test", () => showMix(course, test)));
    if (best) unit.append(el("div", { class: "best" }, `Best: ${best.score} / ${best.total}`));
    list.append(unit);
  }

  mount(
    el("h1", {}, `${course.title} ⭐`),
    list,
  );
  const target: HTMLElement | null = firstOpen;
  if (target) target.scrollIntoView({ block: "center" });
}

// ---------- View all: the whole Word List, every column ----------
/** Show every word and its meaning for the list that `weekIndex` is in, scrolled to that week. */
function showWordList(course: Course, weekIndex: number, onBack: () => void): void {
  const test = testForWeek(course, weekIndex);
  if (!test) return onBack();

  const sections = test.weeks.map((wi) => {
    const week = course.weeks[wi];
    const section = el("section", { class: wi === weekIndex ? "word-list here" : "word-list" });
    if (!week) return section;
    const rows = el("ul", { class: "words" });
    for (const card of week.cards) {
      rows.append(
        el(
          "li",
          {},
          el("span", { class: "hebrew-sm", dir: "rtl", lang: "he" }, card.hebrew),
          el("span", { class: "meaning" }, card.english.join(", ")),
        ),
      );
    }
    section.append(el("h2", {}, week.label), rows);
    return section;
  });

  mount(
    button("⬅️ Back", "choice back", onBack),
    el("h1", {}, `🔍 List ${test.list}`),
    ...sections,
    button("⬅️ Back", "go", onBack),
  );
  const here = sections[test.weeks.indexOf(weekIndex)];
  if (here && test.weeks[0] !== weekIndex) here.scrollIntoView({ block: "start" });
}

// ---------- Learn: flashcards ----------
function runLearn(course: Course, weekIndex: number): void {
  const week = course.weeks[weekIndex];
  if (!week) return showCourse(course);
  const total = week.cards.length;
  let queue = shuffle(week.cards);
  let known = 0;

  function showCard(): void {
    const card = queue[0];
    if (!card) return finish();
    let flipped = false;

    const back = el("div", { class: "flip-answer" });
    back.hidden = true;
    back.textContent = card.english.join(", ");
    const front = hebrewCard(card, back);
    front.classList.add("flashcard");
    front.setAttribute("role", "button");
    front.setAttribute("tabindex", "0");
    front.setAttribute("aria-label", "Flip card");

    // Peek at the whole list, then come back to this same card.
    const peek = button("🔍", "peek", () => showWordList(course, weekIndex, showCard));
    peek.setAttribute("aria-label", "See all the words");
    peek.addEventListener("click", (e) => e.stopPropagation());
    peek.addEventListener("keydown", (e) => e.stopPropagation());
    front.prepend(peek);

    const flipBtn = button("Flip 🔄", "go flip", () => flip());
    const gotIt = button("I knew it ✅", "go", () => {
      known++;
      queue = queue.slice(1);
      showCard();
    });
    const again = button("Again 🔁", "warn", () => {
      // Put it back a few cards later so it comes around again.
      const rest = queue.slice(1);
      const at = Math.min(rest.length, 3);
      queue = [...rest.slice(0, at), card, ...rest.slice(at)];
      showCard();
    });
    const answerBtns = el("div", { class: "row answer-btns" }, again, gotIt);
    answerBtns.hidden = true;

    function flip(): void {
      if (flipped) return;
      flipped = true;
      back.hidden = false;
      flipBtn.hidden = true;
      answerBtns.hidden = false;
      gotIt.focus();
    }
    front.addEventListener("click", flip);
    front.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        flip();
      }
    });

    mount(
      el("h2", { class: "center" }, `📖 ${week?.label ?? ""}`),
      front,
      flipBtn,
      answerBtns,
      progressBar(known, total, `${known} / ${total} learned`),
      button("Back", "quit", () => showCourse(course)),
    );
    flipBtn.focus();
  }

  function finish(): void {
    if (week) markLearned(course.id, week.key);
    mount(
      el("h1", {}, `${week?.label ?? ""} learned! 🎉`),
      el("p", { class: "msg" }, `You learned all ${total} words.`),
      el(
        "div",
        { class: "stack" },
        button(`🏆 Test ${week?.label ?? ""}`, "go", () => startWeekTest(course, weekIndex)),
        button("Learn again", "", () => runLearn(course, weekIndex)),
        button("Back", "choice", () => showCourse(course)),
      ),
    );
  }

  showCard();
}

// ---------- Tests ----------
interface NextStep {
  label: string;
  go: () => void;
}

/** Everything a quiz needs to know about the test it's running. */
interface QuizContext {
  title: string;
  /** Save the score (not called for practice). */
  record: (s: Score) => void;
  /** Take the same test again. */
  restart: () => void;
  /** Where to go next, worked out after the score is saved. */
  next: () => NextStep | undefined;
  back: () => void;
}

/** Test on one column (week): its 12 words. */
function startWeekTest(course: Course, weekIndex: number): void {
  const week = course.weeks[weekIndex];
  if (!week) return showCourse(course);
  runQuiz(shuffle(week.cards), {
    title: `🏆 ${week.label} Test`,
    record: (s) => recordScore(course.id, weekTestKey(week.key), s),
    restart: () => startWeekTest(course, weekIndex),
    next: () => {
      const test = testForWeek(course, weekIndex);
      if (test && test.weeks[test.weeks.length - 1] === weekIndex) {
        return { label: `🏆 ${test.label}`, go: () => showMix(course, test) };
      }
      const nextWeek = course.weeks[weekIndex + 1];
      if (nextWeek) return { label: `📖 Learn ${nextWeek.label}`, go: () => runLearn(course, weekIndex + 1) };
      return undefined;
    },
    back: () => showCourse(course),
  });
}

// ---------- Big test: the whole list, in short mixed-up parts ----------
interface Mix {
  parts: Card[][];
  scores: (Score | null)[];
}

function saveMix(course: Course, test: TestUnit, mix: Mix): void {
  setMix(course.id, test.key, { parts: mix.parts.map((p) => p.map((c) => c.hebrew)), scores: mix.scores });
}

function newMix(course: Course, test: TestUnit): Mix {
  const parts = dealParts(course, test);
  const mix: Mix = { parts, scores: parts.map(() => null) };
  saveMix(course, test, mix);
  return mix;
}

/** The saved mix for this list, or a fresh one if there is none (or it no longer fits the list). */
function currentMix(course: Course, test: TestUnit): Mix {
  const saved = getMix(course.id, test.key);
  const parts = partsFromSaved(course, test, saved?.parts);
  if (!parts) return newMix(course, test);
  const scores = Array.isArray(saved?.scores) ? saved.scores : [];
  return { parts, scores: parts.map((_, i) => scores[i] ?? null) };
}

function total(scores: (Score | null)[]): Score {
  return scores.reduce<Score>((t, s) => ({ score: t.score + (s?.score ?? 0), total: t.total + (s?.total ?? 0) }), {
    score: 0,
    total: 0,
  });
}

function columnLetters(course: Course, test: TestUnit): string {
  // Each letter isolated, so they read א ב ג left to right inside the English sentence.
  return test.weeks
    .map((wi) => course.weeks[wi]?.column ?? "")
    .filter(Boolean)
    .map((c) => `\u2068${c}\u2069`)
    .join(" ");
}

function showMix(course: Course, test: TestUnit, note?: string): void {
  const mix = currentMix(course, test);
  const done = mix.scores.filter((s) => s !== null).length;
  const allDone = done === mix.parts.length;
  const nextPart = mix.scores.findIndex((s) => s === null);

  const parts = el("div", { class: "stack" });
  mix.parts.forEach((cards, i) => {
    const s = mix.scores[i];
    const label = s ? `Part ${i + 1}  ✅ ${s.score} / ${s.total}` : `Part ${i + 1}  (${cards.length} words)`;
    parts.append(button(label, i === nextPart ? "go part" : "choice part", () => startPart(course, test, i)));
  });

  const letters = columnLetters(course, test);
  const nodes: Node[] = [
    el("h1", {}, `🏆 ${test.label}`),
    el("p", { class: "msg" }, letters ? `Words from ${letters} all mixed up!` : "All the words, mixed up!"),
  ];
  if (note) nodes.push(el("p", { class: "note" }, note));
  nodes.push(parts);
  if (allDone) {
    const t = total(mix.scores);
    nodes.push(
      el("p", { class: "score" }, `${t.score} / ${t.total}`),
      el("p", { class: "msg" }, messageFor(t.score, t.total)),
    );
  }

  const reshuffle = (): void => {
    newMix(course, test);
    showMix(course, test, "🔀 All mixed up! New words in each part.");
  };
  // Mixing again starts the parts over, so ask first if some (but not all) are done.
  const mixBtn = button("🔀 New mix", "mix", () => (done > 0 && !allDone ? confirmNewMix(course, test, reshuffle) : reshuffle()));
  nodes.push(el("div", { class: "stack mix-btns" }, mixBtn, button("Back", "quit", () => showCourse(course))));
  mount(...nodes);
}

function confirmNewMix(course: Course, test: TestUnit, reshuffle: () => void): void {
  mount(
    el("h1", {}, "New mix? 🔀"),
    el("p", { class: "msg" }, "Your ✅ parts will start over."),
    el(
      "div",
      { class: "stack" },
      button("Yes, mix it!", "mix", reshuffle),
      button("No, keep it", "choice", () => showMix(course, test)),
    ),
  );
}

function startPart(course: Course, test: TestUnit, part: number): void {
  const cards = currentMix(course, test).parts[part];
  if (!cards) return showMix(course, test);
  runQuiz(shuffle(cards), {
    title: `🏆 ${test.label} · Part ${part + 1}`,
    record: (s) => {
      const mix = currentMix(course, test);
      const prev = mix.scores[part];
      if (!prev || s.score / s.total > prev.score / prev.total) mix.scores[part] = s;
      saveMix(course, test, mix);
      if (mix.scores.every((x) => x !== null)) recordScore(course.id, test.key, total(mix.scores));
    },
    restart: () => startPart(course, test, part),
    next: () => {
      const mix = currentMix(course, test);
      const n = mix.scores.findIndex((x) => x === null);
      if (n >= 0) return { label: `🏆 Part ${n + 1}`, go: () => startPart(course, test, n) };
      return { label: "See my total 🌟", go: () => showMix(course, test) };
    },
    back: () => showMix(course, test),
  });
}

// ---------- Quiz: type the English ----------
function runQuiz(cards: Card[], ctx: QuizContext, practice = false): void {
  const answers: Answer[] = [];
  let index = 0;

  function showQuestion(): void {
    const card = cards[index];
    if (!card) return showCheck(answers, ctx, practice);
    const input = el("input", {
      type: "text",
      autocomplete: "off",
      autocorrect: "off",
      autocapitalize: "off",
      spellcheck: "false",
      "aria-label": "English meaning",
      placeholder: "English…",
      enterkeyhint: "next",
    });

    const form = el("form", { class: "stack", novalidate: "" }, input);
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const typed = input.value.trim();
      if (typed === "") {
        input.focus();
        return;
      }
      answers.push({ card, typed, correct: isCorrect(typed, card.english) });
      index++;
      showQuestion();
    });
    form.append(el("button", { type: "submit", class: "go", style: "margin-top:0" }, "Next"));

    mount(
      el("h2", { class: "center" }, practice ? "💪 Practice" : ctx.title),
      hebrewCard(card),
      form,
      progressBar(index + 1, cards.length, `${index + 1} / ${cards.length}`),
      button("Quit", "quit", ctx.back),
    );
    input.focus();
  }
  showQuestion();
}

function messageFor(score: number, total: number): string {
  const r = total === 0 ? 0 : score / total;
  if (r === 1) return "🌟🌟🌟 Perfect! Amazing!";
  if (r >= 0.8) return "⭐⭐ Great job!";
  if (r >= 0.5) return "⭐ Good work! Keep going!";
  return "💪 Nice try! Practice makes perfect!";
}

// ---------- Check: kid marks answers that were only spelled wrong ----------
function showCheck(answers: Answer[], ctx: QuizContext, practice: boolean): void {
  const toCheck = answers.filter((a) => !a.correct);
  if (toCheck.length === 0) return showResults(answers, ctx, practice);

  const list = el("ul", { class: "results" });
  for (const a of toCheck) {
    const li = el("li", { class: "check" });
    const fix = button("", "spell", () => {
      a.spelling = !a.spelling;
      paint();
    });
    function paint(): void {
      li.classList.toggle("right", a.spelling === true);
      fix.textContent = a.spelling ? "✅ Right! (tap to undo)" : "✏️ I knew it, just spelling";
      fix.setAttribute("aria-pressed", a.spelling ? "true" : "false");
    }
    li.append(
      el("span", { class: "hebrew-sm", dir: "rtl", lang: "he" }, a.card.hebrew),
      el("span", { class: "typed" }, a.typed),
      el("span", { class: "mark", "aria-hidden": "true" }, "🤔"),
      el("span", { class: "answer neutral" }, `Answer: ${a.card.english.join(", ")}`),
      fix,
    );
    paint();
    list.append(li);
  }

  mount(
    el("h1", {}, "Let's check! 🔍"),
    el("p", { class: "msg" }, "Did you know it, but spell it a bit wrong? Tap ✏️"),
    list,
    button("See my score ⭐", "go", () => showResults(answers, ctx, practice)),
  );
}

function isRight(a: Answer): boolean {
  return a.correct || a.spelling === true;
}

function showResults(answers: Answer[], ctx: QuizContext, practice: boolean): void {
  const score = answers.filter(isRight).length;
  const wrong = answers.filter((a) => !isRight(a));
  if (!practice) ctx.record({ score, total: answers.length });

  const list = el("ul", { class: "results" });
  for (const a of answers) {
    const right = isRight(a);
    const li = el("li", { class: right ? "right" : "wrong" });
    const typed = el("span", { class: "typed" }, a.typed);
    if (a.spelling) typed.append(el("small", {}, `✏️ ${a.card.english.join(", ")}`));
    li.append(
      el("span", { class: "hebrew-sm", dir: "rtl", lang: "he" }, a.card.hebrew),
      typed,
      el("span", { class: "mark", "aria-label": right ? "correct" : "wrong" }, right ? "✅" : "❌"),
    );
    if (!right) li.append(el("span", { class: "answer" }, `Answer: ${a.card.english.join(", ")}`));
    list.append(li);
  }

  const buttons = el("div", { class: "stack" });
  const next = practice ? undefined : ctx.next();
  if (next) buttons.append(button(next.label, "go", next.go));
  if (wrong.length > 0) {
    buttons.append(button("Practice my mistakes", "warn", () => runQuiz(shuffle(wrong.map((a) => a.card)), ctx, true)));
  }
  buttons.append(button("Take the test again", "", ctx.restart));
  buttons.append(button("Back", "choice", ctx.back));

  mount(
    el("h1", {}, practice ? "Practice done!" : "Test done!"),
    el("p", { class: "score" }, `${score} / ${answers.length}`),
    el("p", { class: "msg" }, messageFor(score, answers.length)),
    list,
    buttons,
  );
}

showCourse(COURSE);

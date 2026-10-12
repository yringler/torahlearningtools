import "./style.css";
import { WEEKS } from "./words";
import type { Word } from "./words";
import { isCorrect } from "./check";

const MIX = "mix";
const COUNT_OPTIONS = [5, 10, 15, 20] as const;
type Source = typeof MIX | number;

interface Settings {
  source: Source;
  count: number | "all";
}
interface Answer {
  word: Word;
  typed: string;
  correct: boolean;
}

const app = document.getElementById("app");
if (!app) throw new Error("#app missing");
const root: HTMLElement = app;

function shuffle<T>(items: readonly T[]): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = a[i] as T;
    a[i] = a[j] as T;
    a[j] = tmp;
  }
  return a;
}

function poolFor(source: Source): Word[] {
  if (source === MIX) return WEEKS.flatMap((w) => w.words);
  return WEEKS.find((w) => w.id === source)?.words ?? [];
}

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
}

// ---------- Saved settings (localStorage, per device) ----------
const SETTINGS_KEY = "cheder-flashcards:settings";

function loadSettings(): Settings | null {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return null;
    const data: unknown = JSON.parse(raw);
    if (typeof data !== "object" || data === null) return null;
    const { source, count } = data as Record<string, unknown>;
    const validSource =
      source === MIX || (typeof source === "number" && WEEKS.some((w) => w.id === source));
    const validCount = count === "all" || (typeof count === "number" && count > 0);
    return validSource && validCount ? { source: source as Source, count: count as number | "all" } : null;
  } catch {
    return null;
  }
}

function saveSettings(settings: Settings): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // storage unavailable (private mode etc.) — just don't remember
  }
}

// ---------- Start ----------
let lastSettings: Settings | null = null;

function showStart(): void {
  const saved = loadSettings();
  let source: Source | null = saved?.source ?? null;
  let count: number | "all" | null = saved?.count ?? null;

  const weekBox = el("div", { class: "row" });
  const countBox = el("div", { class: "row" });
  const countHeading = el("h2", {}, "How many?");
  const goBtn = button("Start!", "go", () => {
    if (source === null || count === null) return;
    startQuiz({ source, count });
  });

  function renderCounts(): void {
    countBox.replaceChildren();
    const has = source !== null;
    countHeading.hidden = !has;
    countBox.hidden = !has;
    if (source === null) return;
    const size = poolFor(source).length;
    const opts: (number | "all")[] = COUNT_OPTIONS.filter((n) => n < size);
    opts.push("all");
    if (count !== null && !opts.includes(count)) count = null;
    for (const o of opts) {
      const label = o === "all" ? `All (${size})` : String(o);
      const b = button(label, "choice", () => {
        count = o;
        renderCounts();
      });
      b.setAttribute("aria-pressed", String(count === o));
      countBox.append(b);
    }
  }

  function renderWeeks(): void {
    weekBox.replaceChildren();
    const choices: { label: string; value: Source; cls: string }[] = [
      ...WEEKS.map((w) => ({ label: w.label, value: w.id as Source, cls: "choice" })),
      { label: "Mix them all!", value: MIX, cls: "choice" },
    ];
    for (const c of choices) {
      const b = button(c.label, c.cls, () => {
        source = c.value;
        renderWeeks();
        renderCounts();
        updateGo();
      });
      b.setAttribute("aria-pressed", String(source === c.value));
      weekBox.append(b);
    }
  }

  function updateGo(): void {
    goBtn.disabled = source === null || count === null;
  }
  // keep Start state in sync when count changes
  countBox.addEventListener("click", updateGo);

  mount(
    el("h1", {}, "Word Quiz ⭐"),
    el("h2", {}, "Pick a week"),
    weekBox,
    countHeading,
    countBox,
    goBtn,
  );
  renderWeeks();
  renderCounts();
  updateGo();
}

// ---------- Quiz ----------
function startQuiz(settings: Settings): void {
  lastSettings = settings;
  saveSettings(settings);
  const pool = shuffle(poolFor(settings.source));
  const n = settings.count === "all" ? pool.length : Math.min(settings.count, pool.length);
  runQuiz(pool.slice(0, n));
}

function runQuiz(words: Word[]): void {
  const answers: Answer[] = [];
  let index = 0;

  function showQuestion(): void {
    const word = words[index];
    if (!word) {
      showResults(answers);
      return;
    }
    const hebrew = el("div", { class: "hebrew", dir: "rtl", lang: "he" }, word.hebrew);
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
    input.autofocus = true;

    const submit = (): void => {
      const typed = input.value.trim();
      if (typed === "") {
        input.focus();
        return;
      }
      answers.push({ word, typed, correct: isCorrect(typed, word.english) });
      index++;
      showQuestion();
    };
    const form = el("form", { class: "stack", novalidate: "" }, input);
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      submit();
    });
    const next = el("button", { type: "submit", class: "go", style: "margin-top:0" }, "Next");

    form.append(next);
    const pct = (index / words.length) * 100;
    const bar = el("div", { class: "bar", role: "progressbar", "aria-valuemin": "0", "aria-valuemax": String(words.length), "aria-valuenow": String(index + 1) }, el("div", { style: `width:${pct + 100 / words.length}%` }));
    const quit = button("Quit", "quit", showStart);

    mount(
      hebrew,
      form,
      el("div", { class: "progress" }, bar, el("div", { class: "progress-text" }, `${index + 1} / ${words.length}`)),
      quit,
    );
    input.focus();
  }
  showQuestion();
}

// ---------- Results ----------
function messageFor(score: number, total: number): string {
  const r = total === 0 ? 0 : score / total;
  if (r === 1) return "🌟🌟🌟 Perfect! Amazing!";
  if (r >= 0.8) return "⭐⭐ Great job!";
  if (r >= 0.5) return "⭐ Good work! Keep going!";
  return "💪 Nice try! Practice makes perfect!";
}

function showResults(answers: Answer[]): void {
  const score = answers.filter((a) => a.correct).length;
  const wrong = answers.filter((a) => !a.correct);

  const list = el("ul", { class: "results" });
  for (const a of answers) {
    const li = el("li", { class: a.correct ? "right" : "wrong" });
    li.append(
      el("span", { class: "hebrew-sm", dir: "rtl", lang: "he" }, a.word.hebrew),
      el("span", { class: "typed" }, a.typed),
      el("span", { class: "mark", "aria-label": a.correct ? "correct" : "wrong" }, a.correct ? "✅" : "❌"),
    );
    if (!a.correct) li.append(el("span", { class: "answer" }, `Answer: ${a.word.english.join(", ")}`));
    list.append(li);
  }

  const buttons = el("div", { class: "stack" });
  if (lastSettings) {
    const s = lastSettings;
    buttons.append(button("Try again", "", () => startQuiz(s)));
  }
  if (wrong.length > 0) {
    buttons.append(button("Practice my mistakes", "warn", () => runQuiz(shuffle(wrong.map((a) => a.word)))));
  }
  buttons.append(button("Home", "choice", showStart));

  mount(
    el("h1", {}, "All done!"),
    el("p", { class: "score" }, `${score} / ${answers.length}`),
    el("p", { class: "msg" }, messageFor(score, answers.length)),
    list,
    buttons,
  );
  window.scrollTo(0, 0);
}

showStart();

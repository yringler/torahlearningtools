import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import type { LearningEvent } from "../shared/api";
import { activeMasechtaOf, MasechtaProvider } from "../src/components/MasechtaGate";
import { ReadPhase } from "../src/components/ReadPhase";
import { CATALOG, DEFAULT_MASECHTA_ID, entryOf, getMishnah, isTranslated, MASECHTA, setMasechta, shapeOf } from "../src/data";
import {
  chooseMasechta, lastMasechtaOf, loadFailure, masechtaHe, masechtaTiles, needsInternet, nudgeText, otherDue, progressSummary, resolveMasechta,
  sederIdOf, sederTiles,
} from "../src/nav";
import { resetEvents } from "../src/parent/ChildDetail";
import { describeEntry } from "../src/parent/log";
import {
  checkPerek, completeStep, dueByMasechta, dueReviews, gatedDueReviews, gatedNextLearning, knownCount, mp, nextLearning, parentCheckMishnah,
  passPerekChain, perekStage, resetPerek, startedCount, type Task,
} from "../src/progress";
import { perekPhrases, perekSteps } from "../src/perekSteps";
import { describeEvent } from "../src/screens/ChildHistory";
import { MishnahScreen } from "../src/screens/MishnahScreen";
import { stampEvent } from "../src/screens/Session";
import { buildSteps } from "../src/steps";
import type { Masechta, MishnahProgress, Profile } from "../src/types";
import { kid } from "./helpers";

const BR = shapeOf("berakhot");
const PEAH = shapeOf("peah");
const DEMAI = shapeOf("demai");

const textOf = (id: string): Masechta => {
  const e = entryOf(id);
  if (!e) throw new Error(id);
  return JSON.parse(readFileSync(fileURLToPath(new URL(`../public${e.file}`, import.meta.url)), "utf8")) as Masechta;
};
const BERAKHOT_TEXT = MASECHTA;
const PEAH_TEXT = textOf("peah");
/** Run with Peah's text active (tests/setup-data.ts makes Berakhot active for every other test). */
function withPeah<T>(f: () => T): T {
  setMasechta("peah", PEAH_TEXT);
  try { return f(); } finally { setMasechta(DEFAULT_MASECHTA_ID, BERAKHOT_TEXT); }
}
afterEach(() => setMasechta(DEFAULT_MASECHTA_ID, BERAKHOT_TEXT));

const known = (due = "2099-01-01"): MishnahProgress => ({ stepIndex: 9, state: "known", fails: {}, review: { box: 0, due, passes: 0 } });
const withLast = (p: Profile, lastMasechta: string): Profile => ({ ...p, settings: { ...p.settings, lastMasechta } });

describe("nav: resolving and choosing a masechta", () => {
  it("resolves a catalog id, else Berakhot", () => {
    expect(resolveMasechta("peah")).toBe("peah");
    expect(resolveMasechta("demai")).toBe("demai");
    for (const bad of [undefined, null, "", "shabbos", "Peah", "berakhot/1", 3]) expect(resolveMasechta(bad)).toBe("berakhot");
    expect(lastMasechtaOf(kid("A"))).toBe("berakhot");
    expect(lastMasechtaOf(withLast(kid("A"), "peah"))).toBe("peah");
    expect(lastMasechtaOf(withLast(kid("A"), "not_listed"))).toBe("berakhot");
  });

  it("chooseMasechta writes lastMasechta only when the choice changes", () => {
    const a = kid("A");
    expect(chooseMasechta(a, "berakhot")).toBe(a); // the default, nothing stored: no write
    const b = chooseMasechta(a, "peah");
    expect(b.settings).toEqual({ fontScale: 1, lastMasechta: "peah" });
    expect(chooseMasechta(b, "peah")).toBe(b);
    expect(chooseMasechta(b, "berakhot").settings.lastMasechta).toBe("berakhot");
    expect(chooseMasechta(b, "nope")).toBe(b);
  });

  it("finds the seder, the Hebrew name and the nudge text", () => {
    expect(sederIdOf("peah")).toBe("zeraim");
    expect(sederIdOf("unknown")).toBe("zeraim");
    expect(masechtaHe("peah")).toBe("מסכת פאה");
    expect(nudgeText(3, "berakhot")).toBe("🔁 3 reviews waiting in מסכת ברכות");
    expect(nudgeText(1, "demai")).toBe("🔁 1 review waiting in מסכת דמאי");
  });

  it("the gate and the tiles tell offline-and-not-saved apart from other failures", () => {
    expect(loadFailure(false, false)).toBe("offline");
    expect(loadFailure(false, true)).toBe("error");
    expect(loadFailure(true, false)).toBe("error");
    expect(needsInternet(false, false)).toBe(true);
    expect(needsInternet(false, true)).toBe(false);
    expect(needsInternet(true, false)).toBe(false);
  });
});

describe("nav: masechta and seder tiles", () => {
  const p = withLast(kid("A", {
    mishnayos: { "1:1": known("2000-01-01"), "1:2": known(), "peah/1:1": known(), "peah/2:3": { stepIndex: 2, state: "learning", fails: {} } },
  }), "peah");

  it("counts each masechta from its own keys, with catalog totals, due reviews and flags", () => {
    const tiles = masechtaTiles(p, "zeraim", "peah", "2026-01-01");
    expect(tiles.slice(0, 3).map((t) => [t.id, t.known, t.total, t.due, t.current, t.translated, t.finished])).toEqual([
      ["berakhot", 2, 57, 1, false, true, false],
      ["peah", 1, 69, 0, true, false, false],
      ["demai", 0, 53, 0, false, false, false],
    ]);
    expect(tiles.map((t) => t.he)).toEqual(["ברכות", "פאה", "דמאי", "כלאים", "שביעית", "תרומות", "מעשרות", "מעשר שני", "חלה", "ערלה", "ביכורים"]);
  });

  it("gates the due count per masechta when verified sets are given", () => {
    // Berakhot perek 1 not verified and not learned: it is the frontier, its mishnah review still counts.
    expect(masechtaTiles(p, "zeraim", "peah", "2026-01-01", () => new Set())[0]?.due).toBe(1);
  });

  it("sums a seder's masechtos", () => {
    const [zeraim, ...rest] = sederTiles(p, "peah", "2026-01-01");
    expect(zeraim).toEqual({ id: "zeraim", he: "זרעים", en: "Zeraim", masechtos: 11, known: 3, total: 650, due: 1, current: true });
    expect(rest.map((s) => [s.id, s.masechtos, s.known, s.due, s.current])).toEqual([
      ["moed", 12, 0, 0, false], ["nashim", 7, 0, 0, false], ["nezikin", 10, 0, 0, false],
      ["kodashim", 11, 0, 0, false], ["tahorot", 12, 0, 0, false],
    ]);
  });

  it("otherDue lists the other masechtos with due reviews", () => {
    expect(otherDue(p, "peah", "2026-01-01")).toEqual([{ masechta: "berakhot", due: 1 }]);
    expect(otherDue(p, "berakhot", "2026-01-01")).toEqual([]);
  });

  it("progressSummary names each masechta with progress", () => {
    expect(progressSummary(p)).toBe("Berakhot: 2 known · Peah: 1 known, 1 started");
    expect(progressSummary(kid("B"))).toBe("nothing learned yet");
  });
});

describe("progress per masechta", () => {
  it("Peah progress never leaks into Berakhot, and Berakhot's (legacy, unqualified) keys never into Peah", () => {
    const p = kid("A", { mishnayos: { "peah/1:1": known("2000-01-01"), "peah/1:2": known() } });
    expect(knownCount(p, PEAH)).toBe(2);
    expect(knownCount(p, BR)).toBe(0);
    expect(dueReviews(p, BR, "2026-01-01")).toEqual([]);
    expect(dueReviews(p, PEAH, "2026-01-01")).toEqual([{ masechta: "peah", type: "review-m", perek: 1, mishnah: 1 }]);
    expect(nextLearning(p, BR)).toEqual({ masechta: "berakhot", type: "learn", perek: 1, mishnah: 1 });
    expect(nextLearning(p, PEAH)).toEqual({ masechta: "peah", type: "perek-chain", perek: 1, from: 1, to: 2 });

    const q = kid("B", { mishnayos: { "1:1": known("2000-01-01") }, perakim: { "1": { chainedThrough: 5, complete: true } } });
    expect(knownCount(q, BR)).toBe(1);
    expect(knownCount(q, PEAH)).toBe(0);
    expect(perekStage(q, BR, 1)).toBe("complete");
    expect(perekStage(q, PEAH, 1)).toBe("building");
    expect(nextLearning(q, PEAH)).toEqual({ masechta: "peah", type: "learn", perek: 1, mishnah: 1 });
    expect(startedCount(q, DEMAI)).toBe(0);
  });

  it("writes Peah keys qualified and Berakhot keys unqualified", () => {
    const p = passPerekChain(passPerekChain(kid("A"), PEAH, 2, 1, 2), BR, 2, 1, 2);
    expect(Object.keys(p.perakim).sort()).toEqual(["2", "peah/2"]);
    const r = resetPerek(kid("A"), PEAH, 1);
    expect(Object.keys(r.mishnayos)).toEqual(["peah/1:1", "peah/1:2", "peah/1:3", "peah/1:4", "peah/1:5", "peah/1:6"]);
    expect(Object.keys(r.perakim)).toEqual(["peah/1"]);
  });

  it("perek steps follow each masechta's own shape", () => {
    expect(perekSteps(PEAH, 4).filter((s) => s.kind === "mishnah")).toHaveLength(11);
    expect(perekSteps(BR, 4).filter((s) => s.kind === "mishnah")).toHaveLength(7);
    expect(perekSteps(DEMAI, 99)).toEqual([]);
  });

  it("dueByMasechta lists every masechta with due reviews, gated when asked", () => {
    const p = kid("A", { mishnayos: { "1:1": known("2000-01-01"), "peah/3:1": known("2000-01-01"), "peah/1:1": known("2000-01-01"), "demai/1:1": known() } });
    expect(dueByMasechta(p, "2026-01-01")).toEqual([{ masechta: "berakhot", due: 1 }, { masechta: "peah", due: 2 }]);
    // Under the gate nothing is verified: Peah perek 3 is locked, so only its perek 1 review counts.
    expect(dueByMasechta(p, "2026-01-01", () => new Set())).toEqual([{ masechta: "berakhot", due: 1 }, { masechta: "peah", due: 1 }]);
    expect(dueByMasechta(kid("B"), "2026-01-01")).toEqual([]);
  });

  it("a finished masechta has no next learning (no automatic move to another masechta)", () => {
    let p = kid("A");
    for (let perek = 1; perek <= DEMAI.perakim.length; perek++) {
      p = { ...p, perakim: { ...p.perakim, [`demai/${perek}`]: { chainedThrough: DEMAI.perakim[perek - 1] ?? 0, complete: true } } };
    }
    expect(nextLearning(p, DEMAI)).toBeNull();
    const all = new Set(DEMAI.perakim.map((_, i) => i + 1));
    expect(gatedNextLearning(p, DEMAI, all)).toBeNull();
    // Not yet verified: the first perek's test is next.
    expect(gatedNextLearning(p, DEMAI, new Set())).toEqual({ masechta: "demai", type: "perek-finish", perek: 1 });
    expect(nextLearning(p, BR)).toEqual({ masechta: "berakhot", type: "learn", perek: 1, mishnah: 1 });
  });

  it("every task carries its masechta", () => {
    const p = kid("A", { mishnayos: { "peah/1:1": known("2000-01-01") } });
    const tasks: Array<Task | null> = [...dueReviews(p, PEAH, "2026-01-01"), nextLearning(p, PEAH), ...gatedDueReviews(p, PEAH, new Set(), "2026-01-01")];
    expect(tasks.every((t) => t?.masechta === "peah")).toBe(true);
  });

  it("functions that read the text refuse a masechta that isn't active", () => {
    expect(() => completeStep(kid("A"), PEAH, 1, 1)).toThrow(/not the active one/);
    expect(() => parentCheckMishnah(kid("A"), PEAH, 1, 1, "notyet")).toThrow(/not the active one/);
    expect(() => perekPhrases("peah", 1)).toThrow(/not the active one/);
    // The shape-only path of a parent check needs no text.
    expect(mp(parentCheckMishnah(kid("A"), PEAH, 1, 1, "pass"), PEAH, 1, 1).state).toBe("known");
  });

  it("learns a Peah mishnah while Peah is active, keyed under peah/", () => {
    withPeah(() => {
      const total = buildSteps(getMishnah(1, 1).chunks).length;
      let p = kid("A");
      for (let i = 0; i < total; i++) p = completeStep(p, PEAH, 1, 1).profile;
      p = parentCheckMishnah(p, PEAH, 1, 1, "pass");
      expect(Object.keys(p.mishnayos)).toEqual(["peah/1:1"]);
      expect(mp(p, PEAH, 1, 1).state).toBe("known");
      expect(mp(p, BR, 1, 1).state).toBe("new");
      expect(perekPhrases("peah", 1)[0]?.phrases.length).toBeGreaterThan(0);
      expect(checkPerek(p, PEAH, 1, "pass")).toBe(p); // not ready yet
    });
  });
});

describe("events carry the masechta", () => {
  it("a session stamps every event, Berakhot included", () => {
    expect(stampEvent({ type: "session", startedAt: 1, ms: 6000, steps: 2 }, "berakhot")).toMatchObject({ masechta: "berakhot" });
    expect(stampEvent({ type: "recite", task: "learn", perek: 1, mishnah: 1, step: 0, grade: "pass", peeks: 0, ms: 5 }, "peah")).toMatchObject({ masechta: "peah", perek: 1 });
    // A stale masechta on the body never survives.
    expect(stampEvent({ type: "check", scope: "mishnah", perek: 1, mishnah: 1, through: null, grade: "pass", slipped: [], slipWords: 0, masechta: "berakhot" }, "demai").masechta).toBe("demai");
    const src = readFileSync(fileURLToPath(new URL("../src/screens/Session.tsx", import.meta.url)), "utf8");
    expect(src).toContain("const emit: Emit = (e) => onEventRef.current?.(stampEvent(e, masechta));");
  });

  it("a parent's reset names the masechta", () => {
    expect(resetEvents("peah", 2, [1, 2])).toEqual([
      { type: "reset", perek: 2, mishnah: 1, masechta: "peah" }, { type: "reset", perek: 2, mishnah: 2, masechta: "peah" },
    ]);
  });

  it("history lines name the masechta (absent: Berakhot)", () => {
    const base = { id: "e", childId: "c", at: 1, day: "2026-01-01" };
    const e = (x: object) => ({ ...base, ...x }) as LearningEvent;
    expect(describeEvent(e({ type: "reset", perek: 1, mishnah: 2 }))).toBe("Berakhot: Parent reset 1:2");
    expect(describeEvent(e({ type: "reset", perek: 1, mishnah: 2, masechta: "peah" }))).toBe("Peah: Parent reset 1:2");
  });

  it("the change log names a non-Berakhot masechta", () => {
    const entry = (action: "perek_verified" | "progress_edited", detail: Record<string, unknown>) => describeEntry({
      id: "1", at: 1, action, childId: "c", childName: "Avi", detail, via: "parent", actorEmail: null, actorDevice: null,
    });
    const plain = (s: string) => s.replace(/[⁦-⁩]/g, "");
    expect(plain(entry("perek_verified", { masechta: "peah", perakim: [2] }))).toBe("Avi: Peah פרק ב׳ marked verified");
    expect(plain(entry("perek_verified", { masechta: "berakhot", perakim: [2] }))).toBe("Avi: פרק ב׳ marked verified");
    expect(plain(entry("progress_edited", { keys: ["p:peah/2", "m:peah/2:1", "m:peah/3:4", "m:1:2"], count: 4 })))
      .toBe("Avi: Peah פרק ב׳ reset; Peah 3:4 marked not known; 1:2 marked not known");
  });
});

describe("Hebrew-only masechtos", () => {
  it("are detected from the catalog", () => {
    expect(isTranslated("berakhot")).toBe(true);
    expect(isTranslated("peah")).toBe(false);
    expect(isTranslated("demai")).toBe(false);
    expect(isTranslated("unknown")).toBe(false);
    expect(activeMasechtaOf("peah")).toMatchObject({ id: "peah", he: "פאה", en: "Peah", translated: false });
    const hebrewOnly = CATALOG.filter((e) => !e.translated).map((e) => e.id);
    expect(hebrewOnly).toEqual(expect.arrayContaining(["peah", "demai", "kelim", "oktzin"]));
    expect(hebrewOnly).not.toContain("berakhot");
  });

  it("the read step shows no meaning, word panel or tap-for-meaning", () => {
    const render = (id: string, chunk = getMishnah(1, 1).chunks[0]!) => renderToStaticMarkup(createElement(MasechtaProvider, { id },
      createElement(ReadPhase, { chunk, perek: 1, mishnah: 1, view: "simple", onView: () => undefined, onDone: () => undefined })));
    const berakhot = render("berakhot");
    expect(berakhot).toContain("Tap a word to see what it means");
    expect(berakhot).toContain("word-panel");
    expect(berakhot).toContain("tappable");
    const peah = withPeah(() => render("peah", getMishnah(1, 1).chunks[0]!));
    expect(peah).toContain("Read it out loud 2 times.");
    expect(peah).not.toContain("Tap a word");
    expect(peah).not.toContain("word-panel");
    expect(peah).not.toContain("tappable");
    expect(peah).not.toContain("meaning");
    expect(peah).toContain("I read it 2 times");
  });

  it("the mishnah screen hides the meaning views and Steinsaltz, and says the text is Hebrew only", () => {
    const props = {
      profile: kid("A"), perek: 1, mishnah: 1, onPractice: () => undefined, onReview: () => undefined, onPracticeRange: () => undefined,
      onBack: () => undefined, onView: () => undefined,
    };
    const berakhot = renderToStaticMarkup(createElement(MasechtaProvider, { id: "berakhot" }, createElement(MishnahScreen, props)));
    expect(berakhot).toContain(">Steinsaltz</button>");
    const peah = withPeah(() => renderToStaticMarkup(createElement(MasechtaProvider, { id: "peah" }, createElement(MishnahScreen, props))));
    expect(peah).toContain("פאה");
    expect(peah).toContain("Hebrew only");
    expect(peah).not.toContain("Steinsaltz");
    expect(peah).not.toContain("Simple");
    expect(peah).not.toContain("Tap any word");
    expect(peah).not.toContain("AI");
    expect(peah).toContain("Start learning");
  });
});

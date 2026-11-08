import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import type { PerekTestInfo, SyncRequest, SyncResponse } from "../shared/api";
import { ApiFailure, NetworkFailure } from "../src/api/client";
import { mishnayosOf, PERAKIM } from "../src/data";
import { guestStartScreen } from "../src/GuestApp";
import { canImportDevice, copyAsNew, normalizeProfile } from "../src/legacy/import";
import { cooldownTest, liveTest, minutesLeft, GUEST_BODY } from "../src/perekTest";
import { requestErrorResult } from "../src/perekTestRequest";
import {
  completeVerified, dueReviews, frontier, gatedDueReviews, gatedNextInPerek, gatedNextLearning, hasProgressIn, isLocked,
  MAX_SESSION_REVIEWS, needsVerifIntro, nextLearning, perekDone, perekLearned, perekPhase, perekStage, sessionReviews,
  type Verified,
} from "../src/progress";
import { gatedSubLabel } from "../src/screens/Home";
import { perekChip } from "../src/parent/ChildDetail";
import { failKind, initialLanding, landingReducer, takePerekTestToken, type LandingState } from "../src/screens/PerekTestLanding";
import { SyncEngine } from "../src/sync/engine";
import { diffProfiles, profileToRows } from "../src/sync/mapping";
import { applyServerResponse, emptyStore, loadStore, storeKey, verifiedSet, type AccountStore, type KV } from "../src/sync/store";
import type { MishnahProgress, Profile } from "../src/types";
import { kid, store, USER } from "./helpers";
import { shapeOf as shapeOfBR } from "../src/data";

/** Berakhot: the masechta every test here runs against (tests/setup-data.ts makes it active). */
const BR = shapeOfBR("berakhot");

const T0 = 1_700_000_000_000;
const known = (due = "2099-01-01"): MishnahProgress => ({ stepIndex: 99, state: "known", fails: {}, review: { box: 0, due, passes: 0 } });

/** Every mishnah of `perek` known and every build-up chain passed: stage "ready" (or "complete" with legacy). */
function learned(p: Profile, perek: number, legacyComplete = false, due = "2099-01-01"): Profile {
  const n = mishnayosOf(perek).length;
  const mishnayos = { ...p.mishnayos };
  for (let m = 1; m <= n; m++) mishnayos[`${perek}:${m}`] = known(due);
  return { ...p, mishnayos, perakim: { ...p.perakim, [String(perek)]: { chainedThrough: n, complete: legacyComplete, ...(legacyComplete ? { review: { box: 0, due, passes: 0 } } : {}) } } };
}

const V = (...ks: number[]): Verified => new Set(ks);

describe("gate: frontier, isLocked, perekPhase", () => {
  it("nothing verified and perakim 1–3 learned: frontier 1, 1 is in test, 2 and 3 locked", () => {
    const p = learned(learned(learned(kid("A"), 1), 2), 3);
    expect(frontier(BR, V())).toBe(1);
    expect(perekPhase(p, BR, V(), 1)).toBe("test");
    expect(isLocked(BR, V(), 2)).toBe(true);
    expect(perekPhase(p, BR, V(), 3)).toBe("locked");
  });

  it("perek 1 verified and 2 learned: frontier 2", () => {
    const p = learned(learned(kid("A"), 1), 2);
    expect(frontier(BR, V(1))).toBe(2);
    expect(perekPhase(p, BR, V(1), 1)).toBe("verified");
    expect(perekPhase(p, BR, V(1), 2)).toBe("test");
    expect(perekPhase(p, BR, V(1), 3)).toBe("locked");
  });

  it("every perek verified: no frontier, nothing locked", () => {
    const all = V(...PERAKIM);
    expect(frontier(BR, all)).toBeNull();
    expect(PERAKIM.some((k) => isLocked(BR, all, k))).toBe(false);
  });

  it("legacy complete: true counts as learned, not verified", () => {
    const p = learned(kid("A"), 1, true);
    expect(perekStage(p, BR, 1)).toBe("complete");
    expect(perekLearned(p, BR, 1)).toBe(true);
    expect(perekPhase(p, BR, V(), 1)).toBe("test");
  });

  it("un-verifying perek 1 locks 2 and 3 again with no other state change", () => {
    const p = learned(learned(learned(kid("A"), 1), 2), 3);
    expect(perekPhase(p, BR, V(1, 2), 3)).toBe("test");
    expect(perekPhase(p, BR, V(2), 2)).toBe("verified");
    expect(perekPhase(p, BR, V(2), 3)).toBe("locked");
    expect(gatedNextLearning(p, BR, V(2))).toEqual({ masechta: "berakhot", type: "perek-finish", perek: 1 });
  });
});

describe("gatedNextLearning", () => {
  it("the frontier's build-up while it is being learned", () => {
    const p = kid("A");
    expect(gatedNextLearning(p, BR, V())).toEqual(nextLearning(p, BR));
    expect(gatedNextLearning(p, BR, V())).toMatchObject({ masechta: "berakhot", type: "learn", perek: 1, mishnah: 1 });
  });

  it("the test step (perek-finish) for a learned frontier, ready or legacy complete", () => {
    expect(gatedNextLearning(learned(kid("A"), 1), BR, V())).toEqual({ masechta: "berakhot", type: "perek-finish", perek: 1 });
    // ungated nextLearning skips a complete perek and would move on: the gate doesn't
    const legacy = learned(kid("B"), 1, true);
    expect(nextLearning(legacy, BR)?.perek).toBe(2);
    expect(gatedNextLearning(legacy, BR, V())).toEqual({ masechta: "berakhot", type: "perek-finish", perek: 1 });
  });

  it("never returns a task past the frontier", () => {
    let p = kid("A");
    for (const k of PERAKIM) p = learned(p, k, true);
    for (let i = 0; i < PERAKIM.length; i++) {
      const v = V(...PERAKIM.slice(0, i));
      const f = frontier(BR, v);
      const t = gatedNextLearning(p, BR, v);
      expect(t?.perek).toBe(f);
    }
  });

  it("moves on once the perek is verified, even if its build-up is only ready", () => {
    const p = learned(kid("A"), 1);
    expect(gatedNextLearning(p, BR, V(1))).toMatchObject({ masechta: "berakhot", type: "learn", perek: 2, mishnah: 1 });
    expect(gatedNextInPerek(p, BR, V(1), 1)).toBeNull();
  });

  it("a verified perek that was reset is relearned first", () => {
    const p = learned(kid("A"), 1);
    const reset = { ...p, mishnayos: { ...p.mishnayos, "1:3": { stepIndex: 0, state: "new" as const, fails: {} } } };
    expect(gatedNextLearning(reset, BR, V(1))).toMatchObject({ masechta: "berakhot", type: "learn", perek: 1, mishnah: 3 });
  });

  it("gatedNextInPerek: nothing for a locked perek", () => {
    expect(gatedNextInPerek(kid("A"), BR, V(), 2)).toBeNull();
  });
});

describe("gatedDueReviews and sessionReviews", () => {
  const past = "2000-01-01";
  it("drops locked perakim and the frontier's review-p while it waits; keeps verified perakim's reviews", () => {
    let p = learned(kid("A"), 1, true, past);
    p = learned(p, 2, true, past);
    p = learned(p, 3, false, past);
    const all = dueReviews(p, BR, "2026-01-01");
    expect(all.some((t) => t.perek === 3)).toBe(true);
    const g = gatedDueReviews(p, BR, V(1), "2026-01-01");
    expect(g).toContainEqual({ masechta: "berakhot", type: "review-p", perek: 1 });
    expect(g.some((t) => t.type === "review-p" && t.perek === 2)).toBe(false); // frontier in test
    expect(g.some((t) => t.perek === 3)).toBe(false); // locked
  });

  it("caps a session's reviews at 6, oldest due first", () => {
    let p = kid("A");
    for (let m = 1; m <= 5; m++) p = { ...p, mishnayos: { ...p.mishnayos, [`1:${m}`]: known(`2025-01-0${m}`) } };
    for (let m = 1; m <= 5; m++) p = { ...p, mishnayos: { ...p.mishnayos, [`2:${m}`]: known(`2024-01-0${m}`) } };
    const r = sessionReviews(p, dueReviews(p, BR, "2026-01-01"));
    expect(r).toHaveLength(MAX_SESSION_REVIEWS);
    expect(r.slice(0, 5).every((t) => t.perek === 2)).toBe(true);
  });
});

describe("completeVerified", () => {
  it("marks a verified ready perek complete with a review; leaves the rest (same object when nothing changes)", () => {
    const p = learned(learned(kid("A"), 1), 2);
    const q = completeVerified(p, BR, V(1));
    expect(perekDone(q, BR, 1)).toBe(true);
    expect(q.perakim["1"]?.review).toBeDefined();
    expect(perekDone(q, BR, 2)).toBe(false);
    expect(completeVerified(q, BR, V(1))).toBe(q);
    expect(completeVerified(p, BR, V())).toBe(p);
  });
});

describe("the banner and the locked sheet", () => {
  it("needsVerifIntro: learned perakim and no verification at all", () => {
    expect(needsVerifIntro(kid("A"), BR, V())).toBe(false);
    expect(needsVerifIntro(learned(kid("A"), 1, true), BR, V())).toBe(true);
    expect(needsVerifIntro(learned(kid("A"), 1, true), BR, V(1))).toBe(false);
  });
  it("hasProgressIn: saved progress in a locked perek", () => {
    expect(hasProgressIn(kid("A"), BR, 3)).toBe(false);
    expect(hasProgressIn(learned(kid("A"), 3), BR, 3)).toBe(true);
  });
});

describe("store: verifications", () => {
  const row = (childId: string, perek: number, verified = true) =>
    ({ childId, masechta: "berakhot", perek, verified, verifiedAt: verified ? T0 : null, updatedAt: T0 });
  const res = (extra: Partial<SyncResponse> = {}): SyncResponse => ({ cursor: 5, children: [], records: [], serverTime: T0 + 1000, ...extra });
  const none = { children: [], records: [], events: [] };

  it("applies rows even while the child's p record is pending; ignores unknown children; sets clockOffset and verifSchema", () => {
    const a = kid("A");
    let s: AccountStore = store([a]);
    s = { ...s, pending: { ...s.pending, records: { [`${a.id}|p|1`]: { kind: "p", childId: a.id, key: "1", updatedAt: T0, data: { chainedThrough: 5, complete: false } } } } };
    const out = applyServerResponse(s, none, res({ verifications: [row(a.id, 1), row("someone-else", 1)] }), T0);
    expect([...verifiedSet(out, a.id, "berakhot")]).toEqual([1]);
    expect(out.verified["someone-else"]).toBeUndefined();
    expect(out.clockOffset).toBe(1000);
    expect(out.verifSchema).toBe(1);
  });

  it("an un-verify row (verified: false) removes the perek from the set", () => {
    const a = kid("A");
    const s1 = applyServerResponse(store([a]), none, res({ verifications: [row(a.id, 1)] }), T0);
    const s2 = applyServerResponse(s1, none, res({ verifications: [row(a.id, 1, false)] }), T0);
    expect(verifiedSet(s2, a.id, "berakhot").size).toBe(0);
  });

  it("drops entries of tombstoned children", () => {
    const a = kid("A");
    const s1 = applyServerResponse(store([a]), none, res({ verifications: [row(a.id, 1)] }), T0);
    const tomb = { id: a.id, updatedAt: T0 + 5, deleted: true, meta: { name: a.name, color: a.color, emoji: a.emoji, sort: 0, settings: a.settings } };
    const s2 = applyServerResponse(s1, none, res({ children: [tomb as never] }), T0);
    expect(s2.verified[a.id]).toBeUndefined();
  });

  it("an old-shape response (no verifications) still works and doesn't set verifSchema", () => {
    const a = kid("A");
    const out = applyServerResponse(store([a]), none, res(), T0);
    expect(out.verifSchema).toBeUndefined();
    expect(out.cursor).toBe(5);
  });

  it("loadStore on a pre-feature store defaults verified to {} and still loads", () => {
    const m = new Map<string, string>();
    const kv: KV = { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v), removeItem: (k) => void m.delete(k) };
    const { verified: _v, ...old } = { ...emptyStore(USER), cursor: 7, profiles: [kid("A")] };
    m.set(storeKey(USER.id), JSON.stringify(old));
    const s = loadStore(kv, USER);
    expect(s.cursor).toBe(7);
    expect(s.verified).toEqual({});
    expect(s.verifSchema).toBeUndefined();
  });

  it("nothing that is pushed or exported can carry a verification", () => {
    const a = learned(kid("A"), 1);
    const rows = JSON.stringify([profileToRows(a, 0, T0), diffProfiles([], [a], T0), copyAsNew([a]), normalizeProfile(a, 0)]);
    expect(rows).not.toMatch(/verif|official/i);
  });
});

describe("engine: cursor catch-up", () => {
  it("the first sync with verifSchema unset sends cursor 0; later ones the stored cursor", async () => {
    let s: AccountStore = { ...store([kid("A")]), cursor: 42 };
    const calls: SyncRequest[] = [];
    const engine = new SyncEngine({
      api: { sync: async (b) => { calls.push(b); return { cursor: 50, children: [], records: [], serverTime: T0, verifications: [] }; } },
      get: () => s, set: (n) => { s = n; }, onStatus: () => undefined, now: () => T0,
    });
    await engine.syncNow();
    await engine.syncNow();
    expect(calls.map((c) => c.cursor)).toEqual([0, 50]);
    expect(s.verifSchema).toBe(1);
  });
});

describe("test request helpers", () => {
  it("countdown uses the server clock, whatever the tablet's clock says", () => {
    const serverNow = T0;
    const next = T0 + 9 * 60_000 + 1;
    for (const skew of [-600_000, 0, 600_000]) {
      const deviceNow = serverNow - skew;
      const offset = serverNow - deviceNow;
      expect(minutesLeft(next, deviceNow + offset)).toBe(10);
    }
    expect(minutesLeft(T0, T0)).toBe(0);
    expect(minutesLeft(T0 + 60_001, T0)).toBe(2);
  });

  it("maps request errors", () => {
    expect(requestErrorResult(new NetworkFailure("x"))).toEqual({ kind: "offline" });
    expect(requestErrorResult(new ApiFailure(401, null))).toEqual({ kind: "signedOut" });
    expect(requestErrorResult(new ApiFailure(429, { error: "rate_limited", message: "", retryAfterSec: 120, reason: "cooldown" }))).toEqual({ kind: "cooldown", retryAfterSec: 120 });
    // An account cap near the end of its window has a short wait too; it must not read as "already sent".
    expect(requestErrorResult(new ApiFailure(429, { error: "rate_limited", message: "", retryAfterSec: 120, reason: "cap" }))).toEqual({ kind: "cap", retryAfterSec: 120 });
    expect(requestErrorResult(new ApiFailure(429, { error: "rate_limited", message: "", retryAfterSec: 120 }))).toEqual({ kind: "cap", retryAfterSec: 120 });
    expect(requestErrorResult(new ApiFailure(400, { error: "bad_request", message: "not_frontier" }))).toEqual({ kind: "notFrontier" });
    expect(requestErrorResult(new ApiFailure(502, { error: "email_failed", message: "" }))).toEqual({ kind: "failed" });
  });

  it("a 429 counts as 'already sent' only for the per-child cooldown", () => {
    expect(cooldownTest("berakhot", 1, 300, T0)).toEqual({ masechta: "berakhot", perek: 1, sentAt: T0 - 300_000, nextAllowedAt: T0 + 300_000 });
    expect(cooldownTest("berakhot", 1, 3000, T0)).toBeNull();
  });

  it("liveTest: same perek and under 30 days old", () => {
    const t = { masechta: "berakhot", perek: 2, sentAt: T0, nextAllowedAt: T0 + 600_000 };
    expect(liveTest(t, "berakhot", 2, T0 + 1000)).toBe(t);
    expect(liveTest(t, "berakhot", 3, T0 + 1000)).toBeNull();
    expect(liveTest(t, "berakhot", 2, T0 + 31 * 86_400_000)).toBeNull();
  });

  it("Home's sub-label", () => {
    expect(gatedSubLabel(2, null, 1, false)).toBe("2 reviews, then show Abba or Ima your perek");
    expect(gatedSubLabel(0, null, 1, false)).toBe("Get ready to show Abba or Ima פרק א׳");
    expect(gatedSubLabel(0, null, 1, true)).toBe("Waiting for Abba or Ima 📬 · practice while you wait");
    expect(gatedSubLabel(0, null, null, false)).toBe("All caught up!");
  });

  it("parent mode's perek chips", () => {
    const p = learned(learned(kid("A"), 1), 2);
    const t = { verified: V(1), verifiedAt: () => T0, lastTest: { masechta: "berakhot", perek: 2, sentAt: T0 - 120_000, nextAllowedAt: T0 }, now: T0 };
    expect(perekChip(p, BR, t, 1)).toMatch(/^✔ Verified /);
    expect(perekChip(p, BR, t, 2)).toBe("📬 Test email sent 2 minutes ago");
    expect(perekChip(p, BR, t, 3).replace(/[\u2066-\u2069]/g, "")).toBe("🔒 Opens after פרק ב׳");
    expect(perekChip(p, BR, { ...t, lastTest: undefined }, 2)).toBe("🙋 Learned, ready for a test");
    expect(perekChip(kid("B"), BR, { ...t, verified: V() }, 1)).toBe("Not started");
    // A test email for the same perek number of another masechta isn't this perek's.
    expect(perekChip(p, BR, { ...t, lastTest: { ...t.lastTest, masechta: "peah" } }, 2)).toBe("🙋 Learned, ready for a test");
  });
});

describe("parent landing page", () => {
  const info = (status: PerekTestInfo["status"]): PerekTestInfo => ({
    status, childName: "Avi", childEmoji: "🦁", childColor: "#333", masechta: "berakhot", masechtaHe: "ברכות", masechtaEn: "Berakhot",
    perek: 1, nextPerek: 2, mishnayos: [["a", "b"]], requestedAt: T0, verifiedAt: status === "verified" ? T0 : null,
  });

  it("takePerekTestToken reads the fragment once and strips it, only on /perek-test", () => {
    const urls: string[] = [];
    expect(takePerekTestToken({ pathname: "/perek-test", hash: "#t=abcDEF_123-xyz" }, (u) => urls.push(u), null)).toBe("abcDEF_123-xyz");
    expect(urls).toEqual(["/perek-test"]);
    expect(takePerekTestToken({ pathname: "/", hash: "#t=abc" }, (u) => urls.push(u))).toBeNull();
    expect(takePerekTestToken({ pathname: "/auth/verify", hash: "#token=abc" }, (u) => urls.push(u))).toBeNull();
    expect(urls).toHaveLength(1);
    expect(takePerekTestToken({ pathname: "/perek-test", hash: "" }, () => undefined, null)).toBe("");
  });

  it("takePerekTestToken keeps the token for a reload of the same tab", () => {
    const m = new Map<string, string>();
    const tab = { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
    expect(takePerekTestToken({ pathname: "/perek-test", hash: "" }, () => undefined, tab)).toBe("");
    expect(takePerekTestToken({ pathname: "/perek-test", hash: "#t=tok1" }, () => undefined, tab)).toBe("tok1");
    expect(takePerekTestToken({ pathname: "/perek-test", hash: "" }, () => undefined, tab)).toBe("tok1");
    expect(takePerekTestToken({ pathname: "/perek-test", hash: "#t=tok2" }, () => undefined, tab)).toBe("tok2");
    expect(takePerekTestToken({ pathname: "/perek-test/", hash: "" }, () => undefined, tab)).toBe("tok2");
  });

  it("nothing reaches confirm before a tap; each result maps to its state", () => {
    let st: LandingState = initialLanding("tok");
    expect(st).toEqual({ s: "loading" });
    st = landingReducer(st, { a: "lookupOk", info: info("pending") });
    expect(st).toMatchObject({ s: "pending", busy: false, notYet: false });
    st = landingReducer(st, { a: "notYet" });
    expect(st).toMatchObject({ s: "pending", notYet: true });
    st = landingReducer(st, { a: "toggleText" });
    expect(st).toMatchObject({ s: "pending", showText: false });
    const busy = landingReducer(st, { a: "tapConfirm" });
    expect(busy).toMatchObject({ s: "pending", busy: true, notYet: false });
    expect(landingReducer(busy, { a: "confirmOk", info: info("verified") })).toMatchObject({ s: "done", fresh: true });
    expect(landingReducer(busy, { a: "confirmFail", kind: "offline" })).toMatchObject({ s: "pending", busy: false, error: "You're offline. Connect and tap again." });
    expect(landingReducer(busy, { a: "confirmFail", kind: "expired" })).toMatchObject({ s: "expired" });
    expect(landingReducer(busy, { a: "confirmFail", kind: "invalid" })).toMatchObject({ s: "invalid" });
    expect(landingReducer({ s: "loading" }, { a: "lookupOk", info: info("verified") })).toMatchObject({ s: "done", fresh: false });
    expect(landingReducer({ s: "loading" }, { a: "lookupOk", info: info("expired") })).toMatchObject({ s: "expired" });
    expect(landingReducer({ s: "loading" }, { a: "lookupFail", kind: "invalid" })).toEqual({ s: "invalid" });
    expect(landingReducer({ s: "loading" }, { a: "lookupFail", kind: "limited" })).toEqual({ s: "error", message: "Too many tries. Wait a few minutes and try again." });
    expect(initialLanding("")).toEqual({ s: "invalid", missing: true });
  });

  it("failKind", () => {
    expect(failKind(new ApiFailure(400, { error: "invalid_link", message: "This test link has expired." }))).toBe("expired");
    expect(failKind(new ApiFailure(400, { error: "invalid_link", message: "This test link isn't valid anymore." }))).toBe("invalid");
    expect(failKind(new ApiFailure(429, { error: "rate_limited", message: "" }))).toBe("limited");
    expect(failKind(new NetworkFailure("x"))).toBe("offline");
  });
});

describe("guest and import", () => {
  it("GuestApp starts at start.perek's first mishnah, scoped to that perek", () => {
    expect(guestStartScreen(undefined, "peah")).toEqual({ s: "home", m: "peah" });
    expect(guestStartScreen({ masechta: "berakhot", perek: 3 }, "peah")).toMatchObject({
      s: "session", m: "berakhot", tasks: [{ masechta: "berakhot", type: "learn", perek: 3, mishnah: 1 }], scopePerek: 3, back: { s: "perek", m: "berakhot", perek: 3 },
    });
    expect(guestStartScreen({ masechta: "demai", perek: 2, mishnah: 4 }, "berakhot")).toMatchObject({
      s: "session", m: "demai", tasks: [{ masechta: "demai", type: "learn", perek: 2, mishnah: 4 }], back: { s: "perek", m: "demai", perek: 2 },
    });
  });

  it("device import is offered only to a synced account with no children", () => {
    expect(canImportDevice(1, 0, T0)).toBe(true);
    expect(canImportDevice(1, 1, T0)).toBe(false);
    expect(canImportDevice(0, 0, T0)).toBe(false);
    expect(canImportDevice(1, 0, null)).toBe(false);
  });
});

describe("copy", () => {
  it("child-facing verification copy never calls Torah learning fun or a game", () => {
    const files = ["src/components/PerekReady.tsx", "src/components/PerekGate.tsx", "src/screens/PerekTestLanding.tsx", "src/perekTest.ts", "src/screens/Home.tsx"];
    for (const f of files) {
      const src = readFileSync(resolve(__dirname, "..", f), "utf8");
      expect(src, f).not.toMatch(/\bfun\b|\bgames?\b|\bplay(ing)?\b/i);
    }
    expect(GUEST_BODY).toBe("Continue as a guest. It won't count toward your progress, but you can keep learning Torah.");
  });

  it("the locked sheet offers exactly the guest copy", async () => {
    const { LockedSheet } = await import("../src/components/PerekGate");
    const html = renderToStaticMarkup(createElement(LockedSheet, {
      perek: 3, frontier: 1, saved: false, testReady: true, onGoFrontier: () => undefined, onGuest: () => undefined, onClose: () => undefined,
    }));
    expect(html).toContain("Want to keep going?");
    expect(html).toContain("Continue as a guest. It won&#x27;t count toward your progress, but you can keep learning Torah.");
    expect(html).toContain(">Continue as a guest</button>");
  });

  it("the locked sheet promises the show step only when it is next", async () => {
    const { LockedSheet } = await import("../src/components/PerekGate");
    const render = (saved: boolean, testReady: boolean) => renderToStaticMarkup(createElement(LockedSheet, {
      perek: 2, frontier: 1, saved, testReady, onGoFrontier: () => undefined, onGuest: () => undefined, onClose: () => undefined,
    }));
    expect(render(true, false)).not.toContain("Get ready to show");
    expect(render(true, false)).toContain("Go to ");
    expect(render(false, true)).toContain("Get ready to show");
  });
});

describe("no in-app check can make a perek official", () => {
  it("Session's perek-finish no longer calls checkPerek except in guest mode", () => {
    const src = readFileSync(resolve(__dirname, "../src/screens/Session.tsx"), "utf8");
    expect(src.match(/checkPerek\(/g)).toHaveLength(1);
    expect(src).toMatch(/perekTest \? \{\} : \{[\s\S]{0,200}onFinishGuest: \(\) => finishTask\(checkPerek\(profile, ms, perek, "pass"\)/);
    expect(src).not.toContain("PerekFinishTask");
  });
});

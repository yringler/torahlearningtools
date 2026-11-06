import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { AuditEntry, ChildRow, PerekTestInfo, RecordRow, SyncResponse } from "../shared/api";
import { deviceLabel } from "../shared/device";
import { ApiFailure, NetworkFailure } from "../src/api/client";
import { bootPhase, phaseAfterSignIn } from "../src/auth/boot";
import { takePinResetToken } from "../src/auth/PinResetLanding";
import { verifyAs } from "../src/auth/VerifyLanding";
import { mishnayosOf } from "../src/data";
import { childSummary } from "../src/parent/ParentApp";
import { actorLine, describeEntry } from "../src/parent/log";
import { initialPad, LOCK, lockDecision, pinPadReducer, weakPin, wrongPinText, type PadState } from "../src/parent/pin";
import { pinOutcomeOf } from "../src/parent/PinFlows";
import { runParentSync } from "../src/parent/useParent";
import { resetPerek } from "../src/progress";
import { landingReducer, type LandingState } from "../src/screens/PerekTestLanding";
import { diffProfiles } from "../src/sync/mapping";
import { applyLocalEdit, applyServerResponse, pendingCount, recordKey, type AccountStore, type SentBatch } from "../src/sync/store";
import type { Profile } from "../src/types";
import { kid, store } from "./helpers";

const T0 = 1_700_000_000_000;
const learning = (stepIndex: number) => ({ stepIndex, state: "learning" as const, fails: {} });
const withM = (p: Profile, key: string, stepIndex: number): Profile => ({ ...p, mishnayos: { ...p.mishnayos, [key]: learning(stepIndex) } });
const resp = (r: Partial<SyncResponse>): SyncResponse => ({ cursor: 1, children: [], records: [], serverTime: T0, ...r });
const sentOf = (s: AccountStore): SentBatch => ({
  children: Object.values(s.pending.children), records: Object.values(s.pending.records), events: s.pending.events,
});
const none: SentBatch = { children: [], records: [], events: [] };

describe("C1 PIN logic", () => {
  it("weakPin refuses repeats, 1234 and 4321, and allows the rest", () => {
    for (let d = 0; d <= 9; d++) expect(weakPin(String(d).repeat(4))).toBe(true);
    expect(weakPin("1234")).toBe(true);
    expect(weakPin("4321")).toBe(true);
    expect(weakPin("2580")).toBe(false);
    expect(weakPin("1123")).toBe(false);
  });

  it("the pad takes digits, backspace and paste, and submits at the 4th digit", () => {
    let s: PadState = initialPad;
    s = pinPadReducer(s, { a: "digit", d: "2" });
    s = pinPadReducer(s, { a: "digit", d: "x" });
    s = pinPadReducer(s, { a: "digit", d: "5" });
    expect(s.digits).toBe("25");
    s = pinPadReducer(s, { a: "back" });
    expect(s.digits).toBe("2");
    expect(s.submit).toBeNull();
    s = pinPadReducer(s, { a: "digit", d: "5" });
    s = pinPadReducer(s, { a: "digit", d: "8" });
    s = pinPadReducer(s, { a: "digit", d: "0" });
    expect(s).toMatchObject({ digits: "2580", busy: true, submit: "2580" });
    // busy: keys do nothing
    expect(pinPadReducer(s, { a: "digit", d: "1" })).toBe(s);
    expect(pinPadReducer(s, { a: "back" })).toBe(s);

    const pasted = pinPadReducer(initialPad, { a: "paste", text: " 25-80 99" });
    expect(pasted).toMatchObject({ digits: "2580", submit: "2580", busy: true });
    expect(pinPadReducer(initialPad, { a: "paste", text: "12" })).toMatchObject({ digits: "12", busy: false, submit: null });
    expect(pinPadReducer(initialPad, { a: "paste", text: "abc" })).toBe(initialPad);
  });

  it("wrong clears, shakes and counts down; locked replaces the pad", () => {
    const busy = pinPadReducer(initialPad, { a: "paste", text: "2580" });
    const w = pinPadReducer(busy, { a: "wrong", left: 3 });
    expect(w).toMatchObject({ digits: "", busy: false, submit: null, error: "That PIN isn't right. 3 tries left.", shake: 1 });
    const w1 = pinPadReducer(pinPadReducer(w, { a: "paste", text: "1111" }), { a: "wrong", left: 1 });
    expect(w1.error).toBe(wrongPinText(1));
    expect(w1.error).toMatch(/1 try left\. After that, the PIN locks/);
    expect(w1.shake).toBe(2);
    const l = pinPadReducer(busy, { a: "locked" });
    expect(l.locked).toBe(true);
    expect(pinPadReducer(l, { a: "digit", d: "1" })).toBe(l);
    const f = pinPadReducer(busy, { a: "fail", message: "You're offline." });
    expect(f).toMatchObject({ error: "You're offline.", busy: false, shake: 0 });
    expect(pinPadReducer(f, { a: "digit", d: "1" }).error).toBe("");
  });

  it("lockDecision: 5 min idle, 60 s hidden, and a ping every 2 min only after recent input", () => {
    const base = { lastInputAt: T0, hiddenSince: null, lastPingAt: T0, now: T0 };
    expect(lockDecision(base)).toEqual({ lock: false, ping: false });
    expect(lockDecision({ ...base, now: T0 + LOCK.IDLE_MS - 1, lastPingAt: T0 + LOCK.IDLE_MS - 1 })).toEqual({ lock: false, ping: false });
    expect(lockDecision({ ...base, now: T0 + LOCK.IDLE_MS })).toEqual({ lock: true, ping: false });
    expect(lockDecision({ ...base, hiddenSince: T0, now: T0 + 59_999, lastInputAt: T0 + 59_000 }).lock).toBe(false);
    expect(lockDecision({ ...base, hiddenSince: T0, now: T0 + 60_000, lastInputAt: T0 + 59_000 }).lock).toBe(true);
    // ping: 2 min since the last one and input in the last 2 min
    expect(lockDecision({ ...base, lastInputAt: T0 + 100_000, now: T0 + 120_000 })).toEqual({ lock: false, ping: true });
    expect(lockDecision({ ...base, lastInputAt: T0, now: T0 + 120_000 })).toEqual({ lock: false, ping: false });
    expect(lockDecision({ ...base, lastInputAt: T0 + 100_000, lastPingAt: T0 + 60_000, now: T0 + 120_000 }).ping).toBe(false);
    // no ping while hidden
    expect(lockDecision({ ...base, lastInputAt: T0 + 100_000, hiddenSince: T0 + 110_000, now: T0 + 120_000 }).ping).toBe(false);
  });

  it("maps unlock and confirm failures to pad outcomes", () => {
    expect(pinOutcomeOf(new ApiFailure(400, { error: "invalid_pin", message: "", attemptsLeft: 2 }))).toEqual({ wrong: true, left: 2 });
    expect(pinOutcomeOf(new ApiFailure(403, { error: "pin_locked", message: "" }))).toEqual({ locked: true });
    expect(pinOutcomeOf(new ApiFailure(429, { error: "rate_limited", message: "", retryAfterSec: 300 }))).toEqual({ fail: "Too many tries. Wait 5 minutes." });
    expect(pinOutcomeOf(new NetworkFailure("x"))).toEqual({ fail: "You're offline. Connect to enter your PIN." });
  });
});

describe("C2 byParent rows win over pending values", () => {
  const parentRow = (childId: string, key: string, stepIndex: number): RecordRow =>
    ({ kind: "m", childId, key, updatedAt: T0 - 1000, data: learning(stepIndex), byParent: true });

  it("a byParent record replaces a pending value for the same key; a plain row still doesn't", () => {
    const a = kid("A");
    let s = applyLocalEdit(store([a]), [withM(withM(a, "1:1", 5), "1:2", 5)], T0);
    const plain: RecordRow = { kind: "m", childId: a.id, key: "1:2", updatedAt: T0 - 1000, data: learning(1) };
    s = applyServerResponse(s, none, resp({ records: [parentRow(a.id, "1:1", 0), plain] }), T0);
    expect(s.profiles[0]?.mishnayos["1:1"]?.stepIndex).toBe(0);
    expect(s.pending.records[`${a.id}|m|1:1`]).toBeUndefined();
    expect(s.profiles[0]?.mishnayos["1:2"]?.stepIndex).toBe(5);
    expect(s.pending.records[`${a.id}|m|1:2`]).toBeDefined();
  });

  it("a byParent child row replaces a pending child edit", () => {
    const a = kid("A");
    let s = applyLocalEdit(store([a]), [{ ...a, settings: { fontScale: 1.4 } }], T0);
    expect(s.pending.children[a.id]).toBeDefined();
    const row: ChildRow = { id: a.id, updatedAt: T0 - 5, deleted: false, byParent: true,
      meta: { name: "Avi", color: "#2f7d6d", emoji: "🐑", settings: { fontScale: 1, breakMinutes: 10 }, sort: 0 } };
    s = applyServerResponse(s, none, resp({ children: [row] }), T0);
    expect(s.pending.children[a.id]).toBeUndefined();
    expect(s.profiles[0]).toMatchObject({ name: "Avi", emoji: "🐑", settings: { fontScale: 1, breakMinutes: 10 } });
  });

  it("in flight: sent K1, edited to K2, the response carries the parent's row: K2 is dropped", () => {
    const a = kid("A");
    let s = applyLocalEdit(store([a]), [withM(a, "2:3", 4)], T0);
    const sent = sentOf(s);
    s = applyLocalEdit(s, [withM(s.profiles[0] as Profile, "2:3", 6)], T0 + 10); // K2, while the push is out
    s = applyServerResponse(s, sent, resp({ records: [parentRow(a.id, "2:3", 0)] }), T0 + 20);
    expect(s.profiles[0]?.mishnayos["2:3"]?.stepIndex).toBe(0);
    expect(pendingCount(s)).toBe(0);
  });

  it("over 500 pending: a key that wasn't in the batch is dropped when the parent's row arrives", () => {
    const a = kid("A");
    let p = a;
    for (let i = 1; i <= 520; i++) p = withM(p, `${Math.ceil(i / 100)}:${i}`, 2);
    let s = applyLocalEdit(store([a]), [p], T0);
    const keys = Object.keys(s.pending.records);
    const batch: SentBatch = { children: Object.values(s.pending.children), records: Object.values(s.pending.records).slice(0, 500), events: [] };
    const late = keys[keys.length - 1] ?? "";
    const lateRow = s.pending.records[late];
    expect(batch.records.some((r) => recordKey(r) === late)).toBe(false);
    s = applyServerResponse(s, batch, resp({ records: [parentRow(a.id, lateRow?.key ?? "", 0)] }), T0);
    expect(s.pending.records[late]).toBeUndefined();
    expect(pendingCount(s)).toBe(keys.length - 500 - 1);
  });

  it("the parent's own store keeps a value edited while its push was in flight", () => {
    const a = kid("A");
    let s = applyLocalEdit(store([a]), [withM(a, "1:1", 4)], T0);
    const sent = sentOf(s);
    s = applyLocalEdit(s, [withM(s.profiles[0] as Profile, "1:1", 0)], T0 + 10);
    s = applyServerResponse(s, sent, resp({ records: [parentRow(a.id, "1:1", 4)] }), T0 + 20, { parentWins: false });
    expect(s.profiles[0]?.mishnayos["1:1"]?.stepIndex).toBe(0);
    expect(pendingCount(s)).toBe(1);
  });
});

describe("C3 resetPerek", () => {
  it("writes a blank mishnah for every mishnah of the perek and chains: [], and diffProfiles sends them all", () => {
    const n = mishnayosOf(1).length;
    let a = kid("A");
    for (let m = 1; m <= n; m++) a = { ...a, mishnayos: { ...a.mishnayos, [`1:${m}`]: { stepIndex: 9, state: "known", fails: {} } } };
    a = { ...a, mishnayos: { ...a.mishnayos, "2:1": learning(3) }, perakim: { "1": { chainedThrough: 3, complete: true, chains: ["1-3"] } } };
    const r = resetPerek(a, 1);
    for (let m = 1; m <= n; m++) expect(r.mishnayos[`1:${m}`]).toEqual({ stepIndex: 0, state: "new", fails: {} });
    expect(r.mishnayos["2:1"]).toEqual(learning(3));
    expect(r.perakim["1"]).toEqual({ chainedThrough: 0, complete: false, chains: [] });
    const d = diffProfiles([a], [r], T0);
    expect(d.records.filter((x) => x.kind === "m").map((x) => x.key).sort()).toEqual(mishnayosOf(1).map((m) => `1:${m.mishnah}`).sort());
    expect(d.records.find((x) => x.kind === "p")).toMatchObject({ key: "1", data: { chainedThrough: 0, complete: false, chains: [] } });
  });

  it("also sends blank rows for mishnayos that were never stored", () => {
    const d = diffProfiles([kid("B")], [resetPerek(kid("B"), 2)], T0);
    expect(d.records.filter((x) => x.kind === "m")).toHaveLength(mishnayosOf(2).length);
  });
});

/** The text without the bidi isolates around Hebrew. */
const plain = (s: string) => s.replace(/[\u2066-\u2069]/g, "");

describe("C4 describeEntry", () => {
  const e = (x: Partial<AuditEntry>): AuditEntry => ({
    id: "1", at: T0, action: "pin_set", childId: "c", childName: "Avi", detail: {}, via: "parent",
    actorEmail: "abba@example.com", actorDevice: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
    ...x,
  });
  it("PIN actions", () => {
    expect(plain(describeEntry(e({ action: "pin_set" })))).toBe("Parent PIN set");
    expect(plain(describeEntry(e({ action: "pin_changed" })))).toBe("Parent PIN changed");
    expect(plain(describeEntry(e({ action: "pin_reset", via: "pin_reset_link" })))).toBe("Parent PIN reset with an email link");
    expect(plain(describeEntry(e({ action: "pin_locked" })))).toBe("PIN locked after 5 wrong tries");
  });
  it("verifications by the parent and from the test link", () => {
    expect(plain(describeEntry(e({ action: "perek_verified", detail: { masechta: "berakhot", perakim: [3, 1] } })))).toBe("Avi: פרק א׳, ג׳ marked verified");
    expect(plain(describeEntry(e({ action: "perek_verified", via: "test_link", detail: { perakim: [2], pinUsed: true } }))))
      .toBe("Avi: פרק ב׳ confirmed from the test email · PIN entered");
    expect(plain(describeEntry(e({ action: "perek_verified", via: "test_link", detail: { perakim: [2], pinUsed: false } }))))
      .toBe("Avi: פרק ב׳ confirmed from the test email");
    expect(plain(describeEntry(e({ action: "perek_unverified", detail: { perakim: [2] } })))).toBe("Avi: verification of פרק ב׳ removed");
  });
  it("progress edits: a perek reset vs. a list of mishnayos", () => {
    expect(plain(describeEntry(e({ action: "progress_edited", detail: { keys: ["p:2", "m:2:1", "m:2:2"], count: 3 } })))).toBe("Avi: פרק ב׳ reset");
    expect(plain(describeEntry(e({ action: "progress_edited", detail: { keys: ["m:2:3", "m:1:4"], count: 2 } })))).toBe("Avi: 2:3, 1:4 marked not known");
    expect(plain(describeEntry(e({ action: "progress_edited", detail: { keys: ["p:1", "m:1:1", "m:3:2"], count: 3 } })))).toBe("Avi: פרק א׳ reset; 3:2 marked not known");
    expect(plain(describeEntry(e({ action: "progress_edited", detail: { keys: ["m:1:1"], count: 70 } })))).toBe("Avi: 1:1 marked not known (and more)");
  });
  it("children: added, imported, removed, renamed, settings", () => {
    expect(plain(describeEntry(e({ action: "child_added", detail: { imported: false, rows: 0 } })))).toBe("Child added: Avi");
    expect(plain(describeEntry(e({ action: "child_added", detail: { imported: true, rows: 12 } })))).toBe("Child added from this device's saved progress: Avi");
    expect(plain(describeEntry(e({ action: "child_removed" })))).toBe("Child removed: Avi");
    expect(plain(describeEntry(e({ action: "child_edited", detail: { fields: ["name"], from: { name: "Avi" }, to: { name: "Avraham" } } })))).toBe("Avi renamed to Avraham");
    expect(plain(describeEntry(e({ action: "child_edited", detail: { fields: ["settings.breakMinutes"] } })))).toBe("Avi: settings changed");
    expect(plain(describeEntry(e({ action: "child_removed", childName: null })))).toBe("Child removed: A child");
  });
  it("the actor line names the login and the device, or the link", () => {
    expect(actorLine(e({}))).toBe("abba@example.com · Safari on iPhone");
    expect(actorLine(e({ via: "test_link" }))).toBe("abba@example.com · test email link");
    expect(actorLine(e({ via: "pin_reset_link" }))).toBe("abba@example.com · PIN reset email link");
    expect(actorLine(e({ actorEmail: null, actorDevice: null }))).toBe("Unknown login · a browser");
  });
});

describe("C5 deviceLabel", () => {
  it("names common browsers", () => {
    expect(deviceLabel("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1")).toBe("Safari on iPhone");
    expect(deviceLabel("Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36")).toBe("Chrome on Android");
    expect(deviceLabel("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36")).toBe("Chrome on Windows");
    expect(deviceLabel("")).toBe("a browser");
  });
});

describe("C6 test page PIN step", () => {
  const info = (x: Partial<PerekTestInfo> = {}): PerekTestInfo => ({
    status: "pending", childName: "Avi", childEmoji: "🦁", childColor: "#333", masechta: "berakhot", masechtaHe: "ברכות", masechtaEn: "Berakhot",
    perek: 1, nextPerek: 2, mishnayos: [["a"]], requestedAt: T0, verifiedAt: null, ...x,
  });
  const pending = (x: Partial<PerekTestInfo> = {}): LandingState => landingReducer({ s: "loading" }, { a: "lookupOk", info: info(x) });

  it("no PIN on the account: tapping confirms as before", () => {
    const st = landingReducer(pending(), { a: "tapConfirm" });
    expect(st).toMatchObject({ s: "pending", busy: true });
    expect("pin" in st && st.pin).toBeFalsy();
  });
  it("pinRequired: tapping opens the PIN sheet instead of confirming", () => {
    const st = landingReducer(pending({ pinRequired: true }), { a: "tapConfirm" });
    expect(st).toMatchObject({ s: "pending", busy: false, pin: { busy: false, locked: false } });
    expect(landingReducer(st, { a: "closePin" })).toMatchObject({ s: "pending", pin: undefined });
  });
  it("a confirm answered pin_required opens the sheet", () => {
    const st = landingReducer(landingReducer(pending(), { a: "tapConfirm" }), { a: "pinRequired" });
    expect(st).toMatchObject({ s: "pending", busy: false, info: { pinRequired: true }, pin: { busy: false } });
  });
  it("wrong, then locked, then a reset email, then a re-tap opens the pad again", () => {
    let st = landingReducer(pending({ pinRequired: true }), { a: "tapConfirm" });
    st = landingReducer(st, { a: "pinWrong", left: 2 });
    expect(st).toMatchObject({ pin: { triesLeft: 2 } });
    st = landingReducer(st, { a: "pinLocked" });
    expect(st).toMatchObject({ info: { pinLocked: true }, pin: { locked: true } });
    // closing and tapping again opens straight to the locked state
    st = landingReducer(landingReducer(st, { a: "closePin" }), { a: "tapConfirm" });
    expect(st).toMatchObject({ pin: { locked: true } });
    st = landingReducer(st, { a: "resetSent" });
    expect(st).toMatchObject({ info: { pinLocked: false }, pin: { resetSent: true } });
    st = landingReducer(landingReducer(st, { a: "closePin" }), { a: "tapConfirm" });
    expect(st).toMatchObject({ pin: { busy: false, locked: false } });
    expect(landingReducer(st, { a: "confirmOk", info: info({ status: "verified" }) })).toMatchObject({ s: "done", fresh: true });
  });
  it("a lookup with pinLocked opens to the locked state on the first tap", () => {
    expect(landingReducer(pending({ pinRequired: true, pinLocked: true }), { a: "tapConfirm" })).toMatchObject({ pin: { locked: true } });
  });
});

describe("C7 boot routing", () => {
  it("learner first, then parent, then the choice", () => {
    expect(bootPhase("ok")).toBe("app");
    expect(bootPhase("offline")).toBe("offlineNoAccount");
    expect(bootPhase("none")).toBe("askParent");
    expect(bootPhase("none", "ok")).toBe("parent");
    expect(bootPhase("none", "none")).toBe("choose");
    expect(bootPhase("none", "offline")).toBe("offlineNoAccount");
  });
  it("the link fragment's as hint", () => {
    expect(verifyAs("#token=abc&as=parent")).toBe("parent");
    expect(verifyAs("#token=abc")).toBe("learner");
    expect(verifyAs("#token=abc&as=admin")).toBe("learner");
  });
  it("the verify scope decides the phase", () => {
    expect(phaseAfterSignIn("parent")).toBe("parent");
    expect(phaseAfterSignIn("learner")).toBe("app");
    expect(phaseAfterSignIn(undefined)).toBe("app");
  });
});

describe("C8 takePinResetToken", () => {
  it("reads the fragment once and strips it, only on /parent-pin", () => {
    const urls: string[] = [];
    expect(takePinResetToken({ pathname: "/parent-pin", hash: "#t=abc_123" }, (u) => urls.push(u), null)).toBe("abc_123");
    expect(urls).toEqual(["/parent-pin"]);
    expect(takePinResetToken({ pathname: "/perek-test", hash: "#t=abc" }, (u) => urls.push(u), null)).toBeNull();
    expect(urls).toHaveLength(1);
    expect(takePinResetToken({ pathname: "/parent-pin/", hash: "" }, () => undefined, null)).toBe("");
  });
  it("keeps the token for a reload of the same tab", () => {
    const m = new Map<string, string>();
    const tab = { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
    expect(takePinResetToken({ pathname: "/parent-pin", hash: "#t=tok1" }, () => undefined, tab)).toBe("tok1");
    expect(takePinResetToken({ pathname: "/parent-pin", hash: "" }, () => undefined, tab)).toBe("tok1");
  });
});

describe("C9 copy", () => {
  const files = [
    "src/parent/ParentApp.tsx", "src/parent/ChildDetail.tsx", "src/parent/ChangeLog.tsx", "src/parent/ParentSettings.tsx",
    "src/parent/PinFlows.tsx", "src/parent/pin.ts", "src/parent/log.ts", "src/components/PinPad.tsx", "src/components/ConfirmSheet.tsx",
    "src/auth/PinResetLanding.tsx", "src/auth/Login.tsx", "src/screens/Profiles.tsx",
  ];
  it("has no fun, game or play wording", () => {
    for (const f of files) {
      const text = readFileSync(fileURLToPath(new URL(`../${f}`, import.meta.url)), "utf8");
      expect(text, f).not.toMatch(/\b(fun|funny|games?|gaming|play|playing|played|plays|win|winner|points|score|level up)\b/i);
    }
  });
});

describe("parent sync and the children list", () => {
  it("runParentSync pushes until nothing is pending, as the parent (its own edits are kept)", async () => {
    const a = kid("A");
    let s = applyLocalEdit(store([]), [a], T0);
    const calls: number[] = [];
    const r = await runParentSync({
      api: { parentSync: async (b) => { calls.push(b.children.length); return resp({ cursor: 5, children: b.children.map((c) => ({ ...c, byParent: true as const })) }); } },
      get: () => s,
      set: (x) => { s = x; },
      now: () => T0,
    });
    expect(r).toBe("ok");
    expect(calls).toEqual([1]);
    expect(s.cursor).toBe(5);
    expect(pendingCount(s)).toBe(0);
  });

  it("runParentSync: 403 keeps pending (locked), 400 drops the batch, offline and 401 are reported", async () => {
    const a = kid("A");
    const mk = () => applyLocalEdit(store([]), [a], T0);
    const run = async (err: unknown) => {
      let s = mk();
      const r = await runParentSync({ api: { parentSync: async () => { throw err; } }, get: () => s, set: (x) => { s = x; } });
      return { r, pending: pendingCount(s) };
    };
    expect(await run(new ApiFailure(403, { error: "parent_locked", message: "" }))).toEqual({ r: "locked", pending: 1 });
    expect(await run(new ApiFailure(400, { error: "bad_request", message: "" }))).toEqual({ r: "rejected", pending: 0 });
    expect(await run(new ApiFailure(401, { error: "unauthorized", message: "" }))).toEqual({ r: "signedOut", pending: 1 });
    expect(await run(new NetworkFailure("x"))).toEqual({ r: "offline", pending: 1 });
  });

  it("a child's card line", () => {
    expect(childSummary(kid("A"), new Set([1])).line).toMatch(/^0\/\d+ mishnayos · 1 perek verified · 0 due$/);
  });
});

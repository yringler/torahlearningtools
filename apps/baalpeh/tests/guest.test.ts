import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  asksServer, blankGuest, bootRoute, GUEST_FLAG_KEY, GUEST_ID, isGuestChosen, loadGuest, saveGuest, setGuestChosen,
  UNREADABLE_BACKUP_KEY,
} from "../src/guest";
import { importDefaults, importLegacy, normalizeProfile } from "../src/legacy/import";
import { completeStep } from "../src/progress";
import { isAppState, KEY as LEGACY_KEY } from "../src/storage";
import type { KV } from "../src/sync/store";
import { kid, store } from "./helpers";

function memKV(init: Record<string, string> = {}): KV & { map: Map<string, string> } {
  const map = new Map(Object.entries(init));
  return { map, getItem: (k) => map.get(k) ?? null, setItem: (k, v) => void map.set(k, v), removeItem: (k) => void map.delete(k) };
}

afterEach(() => vi.unstubAllGlobals());

describe("guest flag", () => {
  it("is off by default, persists when set and clears", () => {
    const kv = memKV();
    expect(isGuestChosen(kv)).toBe(false);
    setGuestChosen(kv, true);
    expect(kv.map.get(GUEST_FLAG_KEY)).toBe("1");
    expect(isGuestChosen(kv)).toBe(true);
    setGuestChosen(kv, false);
    expect(kv.map.has(GUEST_FLAG_KEY)).toBe(false);
    expect(isGuestChosen(kv)).toBe(false);
  });

  it("survives a throwing storage", () => {
    const broken: KV = { getItem: () => { throw new Error("x"); }, setItem: () => { throw new Error("x"); }, removeItem: () => { throw new Error("x"); } };
    expect(() => setGuestChosen(broken, true)).not.toThrow();
    expect(isGuestChosen(broken)).toBe(false);
  });
});

describe("bootRoute", () => {
  it("a magic link overrides the remembered guest choice", () => {
    expect(bootRoute({ verifyToken: "tok", guest: true, cachedUser: false })).toBe("verify");
    expect(bootRoute({ verifyToken: "", guest: true, cachedUser: true })).toBe("verify");
  });
  it("a remembered guest choice skips login and the server check", () => {
    expect(bootRoute({ verifyToken: null, guest: true, cachedUser: false })).toBe("guest");
    expect(bootRoute({ verifyToken: null, guest: true, cachedUser: true })).toBe("guest");
    expect(asksServer("guest")).toBe(false);
  });
  it("otherwise behaves as before", () => {
    expect(bootRoute({ verifyToken: null, guest: false, cachedUser: true })).toBe("app");
    expect(bootRoute({ verifyToken: null, guest: false, cachedUser: false })).toBe("boot");
    expect(asksServer("boot")).toBe(true);
    expect(asksServer("app")).toBe(true);
  });
});

describe("guest progress (v1 format)", () => {
  it("starts blank and writes nothing until saved", () => {
    const kv = memKV();
    expect(loadGuest(kv)).toMatchObject({ id: GUEST_ID, name: "Guest", mishnayos: {}, days: [] });
    expect(kv.map.size).toBe(0);
  });

  it("round-trips through baalpeh:v1 and keeps other v1 profiles", () => {
    const old = kid("Dina");
    const kv = memKV({ [LEGACY_KEY]: JSON.stringify({ version: 1, profiles: [old] }) });
    const p = completeStep(blankGuest(), 1, 1).profile;
    saveGuest(kv, p);
    saveGuest(kv, { ...p, settings: { ...p.settings, meaningView: "steinsaltz" } });
    const parsed: unknown = JSON.parse(kv.map.get(LEGACY_KEY) ?? "null");
    expect(isAppState(parsed)).toBe(true);
    if (!isAppState(parsed)) return;
    expect(parsed.profiles.map((x) => x.id)).toEqual([old.id, GUEST_ID]);
    const back = loadGuest(kv);
    expect(back.mishnayos["1:1"]).toMatchObject({ stepIndex: 1, state: "learning" });
    expect(back.settings.meaningView).toBe("steinsaltz");
  });

  it("ignores a corrupt v1 value", () => {
    expect(loadGuest(memKV({ [LEGACY_KEY]: "{not json" })).id).toBe(GUEST_ID);
  });

  it("keeps a copy of unreadable v1 data before the first guest write", () => {
    const kv = memKV({ [LEGACY_KEY]: "{not json" });
    saveGuest(kv, blankGuest());
    expect(kv.map.get(UNREADABLE_BACKUP_KEY)).toBe("{not json");
    expect(loadGuest(kv).id).toBe(GUEST_ID);
    kv.map.set(LEGACY_KEY, JSON.stringify({ version: 2 }));
    saveGuest(kv, blankGuest());
    expect(kv.map.get(UNREADABLE_BACKUP_KEY)).toBe("{not json"); // the first copy is never replaced
  });

  it("saves over a v1 state holding non-object entries without throwing, and keeps them", () => {
    const kv = memKV({ [LEGACY_KEY]: JSON.stringify({ version: 1, profiles: [null, 7, { ...blankGuest() }] }) });
    expect(() => saveGuest(kv, { ...blankGuest(), name: "Guest 2" })).not.toThrow();
    const parsed = JSON.parse(kv.map.get(LEGACY_KEY) ?? "null") as { profiles: unknown[] };
    expect(parsed.profiles.slice(0, 2)).toEqual([null, 7]);
    expect(loadGuest(kv).name).toBe("Guest 2");
  });

  it("is offered by the account import prompt and imports under a new id", () => {
    const kv = memKV();
    saveGuest(kv, completeStep(blankGuest(), 1, 1).profile);
    const parsed: unknown = JSON.parse(kv.map.get(LEGACY_KEY) ?? "null");
    if (!isAppState(parsed)) throw new Error("not v1");
    const legacy = parsed.profiles.map(normalizeProfile);
    expect(importDefaults(legacy, [])).toEqual({ [GUEST_ID]: true });
    const s = importLegacy(store(), legacy, 1000, () => "new-uuid-1");
    expect(s.profiles[0]).toMatchObject({ id: "new-uuid-1", name: "Guest" });
    expect(Object.keys(s.pending.records)).toContain("new-uuid-1|m|1:1");
  });

  it("makes no network requests", () => {
    const fetch = vi.fn(() => Promise.reject(new Error("no network in guest mode")));
    vi.stubGlobal("fetch", fetch);
    const kv = memKV();
    setGuestChosen(kv, true);
    saveGuest(kv, completeStep(loadGuest(kv), 1, 1).profile);
    loadGuest(kv);
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("GuestApp module graph", () => {
  // Every module the guest app loads at runtime (type-only imports are erased and don't count).
  function runtimeGraph(entry: string): Set<string> {
    const seen = new Set<string>();
    const visit = (file: string) => {
      if (seen.has(file)) return;
      seen.add(file);
      const src = readFileSync(file, "utf8");
      for (const m of src.matchAll(/^\s*(import|export)\s+(?!type\b)[^;]*?from\s+"([^"]+)"/gms)) {
        const spec = m[2] ?? "";
        if (!spec.startsWith(".")) continue;
        const base = resolve(dirname(file), spec);
        const found = [".ts", ".tsx", "/index.ts", ""].map((ext) => base + ext).find((f) => {
          try { readFileSync(f); return true; } catch { return false; }
        });
        if (found && /\.tsx?$/.test(found)) visit(found);
      }
    };
    visit(entry);
    return seen;
  }

  it("never loads the API client, the sync engine, useAccount or Turnstile", () => {
    const root = resolve(__dirname, "..");
    const graph = [...runtimeGraph(resolve(root, "src/GuestApp.tsx"))].map((f) => f.slice(root.length + 1));
    expect(graph).toContain("src/screens/Session.tsx");
    for (const banned of ["src/api/client.ts", "src/sync/engine.ts", "src/sync/useAccount.ts", "src/auth/Turnstile.tsx"]) {
      expect(graph).not.toContain(banned);
    }
  });
});

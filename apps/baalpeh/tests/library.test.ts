import { describe, expect, it } from "vitest";
import { SEDARIM } from "../src/data";
import {
  isLibraryPath, LAST_PLACE_KEY, libraryPath, loadLastPlace, loadScale, neighbourPerek, parseLibraryPath, saveLastPlace, saveScale,
  type LibraryPlace,
} from "../src/library/location";
import type { KV } from "../src/sync/store";

const SEDER_IDS = SEDARIM.map((s) => s.id);
const parse = (p: string) => parseLibraryPath(p, SEDER_IDS);
const memKV = (): KV & { m: Map<string, string> } => {
  const m = new Map<string, string>();
  return { m, getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v), removeItem: (k) => void m.delete(k) };
};

describe("library paths", () => {
  it("recognises library paths only", () => {
    expect(isLibraryPath("/library")).toBe(true);
    expect(isLibraryPath("/library/")).toBe(true);
    expect(isLibraryPath("/library/berakhot/2")).toBe(true);
    expect(isLibraryPath("/libraryx")).toBe(false);
    expect(isLibraryPath("/")).toBe(false);
    expect(isLibraryPath("/licenses")).toBe(false);
  });

  it("round-trips every kind of place", () => {
    const seder = SEDER_IDS[1] ?? SEDER_IDS[0] ?? "";
    const places: LibraryPlace[] = [
      { v: "home" },
      { v: "seder", seder },
      { v: "masechta", m: "peah" },
      { v: "read", m: "berakhot", perek: 2 },
      { v: "read", m: "berakhot", perek: 2, mishnah: 3 },
    ];
    for (const p of places) expect(parse(libraryPath(p))).toEqual(p);
  });

  it("falls back to the nearest valid place", () => {
    expect(parse("/library/nope")).toEqual({ v: "home" });
    expect(parse("/library/s:nope")).toEqual({ v: "home" });
    expect(parse("/library/berakhot/99")).toEqual({ v: "masechta", m: "berakhot" });
    expect(parse("/library/berakhot/0")).toEqual({ v: "masechta", m: "berakhot" });
    expect(parse("/library/berakhot/x")).toEqual({ v: "masechta", m: "berakhot" });
    expect(parse("/library/berakhot/1/99")).toEqual({ v: "read", m: "berakhot", perek: 1 });
    expect(parse("/library/berakhot/1/02")).toEqual({ v: "read", m: "berakhot", perek: 1 });
  });

  it("steps between perakim inside the masechta only", () => {
    expect(neighbourPerek("berakhot", 1, -1)).toBeNull();
    expect(neighbourPerek("berakhot", 1, 1)).toBe(2);
    expect(neighbourPerek("berakhot", 9, 1)).toBeNull();
  });
});

describe("library memory", () => {
  it("remembers the last place and drops one that no longer exists", () => {
    const kv = memKV();
    expect(loadLastPlace(kv)).toBeNull();
    saveLastPlace(kv, { m: "peah", perek: 2, mishnah: 4 });
    expect(loadLastPlace(kv)).toEqual({ m: "peah", perek: 2, mishnah: 4 });
    kv.setItem(LAST_PLACE_KEY, JSON.stringify({ m: "gone", perek: 1 }));
    expect(loadLastPlace(kv)).toBeNull();
    kv.setItem(LAST_PLACE_KEY, "{not json");
    expect(loadLastPlace(kv)).toBeNull();
  });

  it("keeps the text size within range", () => {
    const kv = memKV();
    expect(loadScale(kv)).toBe(1);
    saveScale(kv, 1.3);
    expect(loadScale(kv)).toBe(1.3);
    kv.setItem("baalpeh:library:scale", "9");
    expect(loadScale(kv)).toBe(1);
  });
});

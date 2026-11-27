import { describe, expect, it } from "vitest";
import {
  eventMasechta, isMasechtaId, keyBelongsTo, LEGACY_MASECHTA_ID, parseProgressKey, perekKey, progressKey,
} from "../shared/progressKey";

describe("progress keys", () => {
  it("keeps Berakhot unqualified and qualifies other masechtos", () => {
    expect(LEGACY_MASECHTA_ID).toBe("berakhot");
    expect(progressKey("berakhot", 1, 2)).toBe("1:2");
    expect(perekKey("berakhot", 1)).toBe("1");
    expect(progressKey("peah", 1, 2)).toBe("peah/1:2");
    expect(perekKey("demai", 7)).toBe("demai/7");
  });

  it("round-trips", () => {
    for (const masechta of ["berakhot", "peah", "demai", "bava_kamma"]) {
      expect(parseProgressKey("m", progressKey(masechta, 3, 12))).toEqual({ masechta, perek: 3, mishnah: 12 });
      expect(parseProgressKey("p", perekKey(masechta, 9))).toEqual({ masechta, perek: 9, mishnah: null });
    }
  });

  it("rejects malformed and non-canonical keys", () => {
    for (const k of ["berakhot/1:2", "Peah/1:2", "peah/", "peah/1:2:3", "../1:2", "1234:1", "1:1234", "peah/1000:1", "", "1:", ":1", "p/1:2", "peah//1:2", " 1:2"]) {
      expect(parseProgressKey("m", k), k).toBeNull();
    }
    for (const k of ["berakhot/1", "Peah/1", "peah/", "peah/1/2", "../1", "1234", "peah/1:2", "1:2", ""]) {
      expect(parseProgressKey("p", k), k).toBeNull();
    }
    expect(parseProgressKey("m", "1")).toBeNull();
  });

  it("tells which masechta a key belongs to", () => {
    expect(keyBelongsTo("m", "1:2", "berakhot")).toBe(true);
    expect(keyBelongsTo("m", "1:2", "peah")).toBe(false);
    expect(keyBelongsTo("m", "peah/1:2", "peah")).toBe(true);
    expect(keyBelongsTo("m", "berakhot/1:2", "berakhot")).toBe(false);
    expect(keyBelongsTo("p", "peah/1", "peah")).toBe(true);
    expect(keyBelongsTo("p", "peah/1:2", "peah")).toBe(false);
  });

  it("validates masechta ids by format", () => {
    for (const id of ["berakhot", "peah", "ab", "bava_kamma", "a1"]) expect(isMasechtaId(id), id).toBe(true);
    for (const v of ["a", "Peah", "1peah", "_x", "pe-ah", "pe ah", "a".repeat(33), "", null, 3, undefined]) expect(isMasechtaId(v), String(v)).toBe(false);
    expect(isMasechtaId("a".repeat(32))).toBe(true);
  });

  it("treats an event without a masechta as Berakhot", () => {
    expect(eventMasechta({})).toBe("berakhot");
    expect(eventMasechta({ masechta: "peah" })).toBe("peah");
  });
});

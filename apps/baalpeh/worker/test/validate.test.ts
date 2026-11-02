import { describe, expect, it } from "vitest";
import { childMeta } from "../lib/validate";

const base = { name: "Avi", color: "#336699", emoji: "🐮", sort: 0 };

describe("child settings", () => {
  it("has no break setting unless one is sent", () => {
    expect(childMeta({ ...base, settings: { fontScale: 1 } }, "meta").settings).toEqual({ fontScale: 1 });
  });

  it("drops the retired dailyMinutes that older clients send", () => {
    expect(childMeta({ ...base, settings: { fontScale: 1, dailyMinutes: 15 } }, "meta").settings).toEqual({ fontScale: 1 });
  });

  it("keeps breakMinutes in range", () => {
    expect(childMeta({ ...base, settings: { fontScale: 1, breakMinutes: 20 } }, "meta").settings).toEqual({ fontScale: 1, breakMinutes: 20 });
    expect(() => childMeta({ ...base, settings: { fontScale: 1, breakMinutes: 0 } }, "meta")).toThrow();
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Masechta } from "../src/types";

// src/data.ts keeps module state (the active masechta and the in-memory cache), so each test imports a fresh copy.
// tests/setup-data.ts activated Berakhot in the shared copy; these fresh copies start with nothing loaded.
type Data = typeof import("../src/data");
let data: Data;

beforeEach(async () => {
  vi.resetModules();
  data = await import("../src/data");
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const fake = (he: string, en: string): Masechta => ({
  masechta: he,
  masechtaEn: en,
  mishnayos: [{ perek: 1, mishnah: 1, summary: "", chunks: [{ he: `${en} 1:1`, en: "", words: [] }] }],
});

/** A fetcher that serves a small fake for each catalog file and records every URL it is asked for. */
function fakeFetcher(fail: (url: string) => boolean = () => false) {
  const calls: string[] = [];
  const fetcher = (async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);
    await Promise.resolve();
    if (fail(url)) return new Response("down", { status: 503 });
    const e = data.CATALOG.find((x) => x.file === url);
    if (!e) return new Response("missing", { status: 404 });
    return new Response(JSON.stringify(fake(e.he, e.en)), { status: 200 });
  }) as typeof fetch;
  return { fetcher, calls };
}

const fileOf = (id: string): string => data.entryOf(id)?.file ?? "";

describe("loadMasechta", () => {
  it("starts with nothing active", () => {
    expect(data.activeMasechtaId()).toBe("");
    expect(data.PERAKIM).toEqual([]);
  });

  it("switches A → B → A with no second request for A", async () => {
    const { fetcher, calls } = fakeFetcher();
    await data.loadMasechta("peah", fetcher);
    expect(data.activeMasechtaId()).toBe("peah");
    expect(data.MASECHTA.masechtaEn).toBe("Peah");
    await data.loadMasechta("demai", fetcher);
    expect(data.activeMasechtaId()).toBe("demai");
    expect(data.getMishnah(1, 1).chunks[0]?.he).toBe("Demai 1:1");
    const p = data.loadMasechta("peah", fetcher);
    expect(data.activeMasechtaId()).toBe("peah"); // from memory: active at once
    await p;
    expect(data.MASECHTA.masechtaEn).toBe("Peah");
    expect(data.mishnayosOf(1)).toHaveLength(1);
    expect(calls).toEqual([fileOf("peah"), fileOf("demai")]);
  });

  it("leaves the active masechta unchanged when loading another one fails, and retries next time", async () => {
    let down = true;
    const { fetcher, calls } = fakeFetcher((url) => down && url === fileOf("demai"));
    await data.loadMasechta("peah", fetcher);
    await expect(data.loadMasechta("demai", fetcher)).rejects.toThrow("503");
    expect(data.activeMasechtaId()).toBe("peah");
    expect(data.MASECHTA.masechtaEn).toBe("Peah");
    expect(data.isMasechtaCached("demai")).toBe(false);
    down = false;
    await data.loadMasechta("demai", fetcher);
    expect(data.activeMasechtaId()).toBe("demai");
    expect(calls).toEqual([fileOf("peah"), fileOf("demai"), fileOf("demai")]);
  });

  it("shares one request between concurrent calls", async () => {
    const { fetcher, calls } = fakeFetcher();
    await Promise.all([
      data.loadMasechta("peah", fetcher),
      data.loadMasechta("peah", fetcher),
      data.prefetchMasechta("peah", fetcher),
    ]);
    expect(calls).toEqual([fileOf("peah")]);
    expect(data.activeMasechtaId()).toBe("peah");
  });

  it("activates the most recently requested masechta when loads overlap", async () => {
    const { fetcher } = fakeFetcher();
    const a = data.loadMasechta("peah", fetcher);
    const b = data.loadMasechta("demai", fetcher);
    await Promise.all([a, b]);
    expect(data.activeMasechtaId()).toBe("demai");
  });

  it("prefetches into memory without activating", async () => {
    const { fetcher, calls } = fakeFetcher();
    await data.loadMasechta("peah", fetcher);
    await data.prefetchMasechta("demai", fetcher);
    expect(data.activeMasechtaId()).toBe("peah");
    expect(data.isMasechtaCached("demai")).toBe(true);
    await data.loadMasechta("demai", fetcher);
    expect(data.activeMasechtaId()).toBe("demai");
    expect(calls).toEqual([fileOf("peah"), fileOf("demai")]);
  });

  it("rejects an unknown id without changing the active masechta", async () => {
    const { fetcher, calls } = fakeFetcher();
    await data.loadMasechta("peah", fetcher);
    await expect(data.loadMasechta("nope", fetcher)).rejects.toThrow("Unknown masechta");
    expect(data.activeMasechtaId()).toBe("peah");
    expect(calls).toEqual([fileOf("peah")]);
  });
});

describe("isDownloaded", () => {
  it("is false where there is no Cache API", async () => {
    vi.stubGlobal("caches", undefined);
    expect(await data.isDownloaded("berakhot")).toBe(false);
  });

  it("checks the masechta's current file in the service worker's data cache", async () => {
    const opened: string[] = [];
    vi.stubGlobal("caches", {
      open: (name: string) => {
        opened.push(name);
        return Promise.resolve({
          match: (url: string) => Promise.resolve(url === fileOf("peah") ? new Response("{}") : undefined),
        });
      },
    });
    expect(await data.isDownloaded("peah")).toBe(true);
    expect(await data.isDownloaded("demai")).toBe(false);
    expect(await data.isDownloaded("nope")).toBe(false);
    expect(opened).toEqual(["data-v1", "data-v1"]);
  });
});

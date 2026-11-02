import { afterEach, describe, expect, it, vi } from "vitest";
import { api, ApiFailure, call, NetworkFailure } from "../src/api/client";

afterEach(() => { vi.unstubAllGlobals(); });

const stub = (impl: (url: string, init: RequestInit) => Promise<Response>) => {
  const f = vi.fn(impl);
  vi.stubGlobal("fetch", f);
  return f;
};

describe("api call", () => {
  it("maps 204 to undefined and sends JSON with credentials", async () => {
    const f = stub(async () => new Response(null, { status: 204 }));
    await expect(api.logout()).resolves.toBeUndefined();
    const [url, init] = f.mock.calls[0] ?? [];
    expect(url).toBe("/api/auth/logout");
    expect(init).toMatchObject({ method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: "{}" });
  });

  it("returns the JSON body on 200 and sends no body for GET", async () => {
    const f = stub(async () => Response.json({ turnstileSiteKey: "k", devEmail: true }));
    await expect(call("GET", "/config")).resolves.toEqual({ turnstileSiteKey: "k", devEmail: true });
    expect(f.mock.calls[0]?.[1]).not.toHaveProperty("body");
  });

  it("maps a non-2xx response to ApiFailure with the body", async () => {
    stub(async () => Response.json({ error: "invalid_code", message: "nope", attemptsLeft: 3 }, { status: 400 }));
    const e = await api.verifyCode({ email: "a@b.co", code: "123456" }).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(ApiFailure);
    expect((e as ApiFailure).status).toBe(400);
    expect((e as ApiFailure).body).toEqual({ error: "invalid_code", message: "nope", attemptsLeft: 3 });
  });

  it("maps a non-JSON error to ApiFailure with a null body", async () => {
    stub(async () => new Response("oops", { status: 502 }));
    const e = await api.me().catch((x: unknown) => x);
    expect(e).toBeInstanceOf(ApiFailure);
    expect((e as ApiFailure).body).toBeNull();
  });

  it("maps a fetch rejection to NetworkFailure", async () => {
    stub(async () => { throw new TypeError("Failed to fetch"); });
    await expect(api.me()).rejects.toBeInstanceOf(NetworkFailure);
  });

  it("encodes child ids in parent-view paths", async () => {
    const f = stub(async () => Response.json({ events: [], nextBefore: null }));
    await api.events("a/b", 5);
    expect(f.mock.calls[0]?.[0]).toBe("/api/children/a%2Fb/events?before=5");
  });
});

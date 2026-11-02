import { afterEach, describe, expect, it, vi } from "vitest";
import { devOutbox, LogSender } from "../email/log";
import { loginEmail } from "../email/loginEmail";
import { RESEND_URL, ResendSender } from "../email/resend";
import { isLocalOrigin, pickSender } from "../email/sender";

afterEach(() => {
  vi.restoreAllMocks();
});

const msg = { to: "p@example.com", subject: "s", text: "t", html: "<p>h</p>", idempotencyKey: "login-123" };

describe("email", () => {
  it("ResendSender posts the right request", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ id: "1" }));
    await new ResendSender("re_key", "From <f@example.com>").send(msg);
    expect(spy).toHaveBeenCalledTimes(1);
    const [url, init] = spy.mock.calls[0]!;
    expect(url).toBe(RESEND_URL);
    expect(init?.method).toBe("POST");
    const h = new Headers(init?.headers);
    expect(h.get("Authorization")).toBe("Bearer re_key");
    expect(h.get("Idempotency-Key")).toBe("login-123");
    expect(h.get("Content-Type")).toBe("application/json");
    expect(JSON.parse(String(init?.body))).toEqual({ from: "From <f@example.com>", to: ["p@example.com"], subject: "s", text: "t", html: "<p>h</p>" });
  });

  it("ResendSender throws on a 4xx", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("bad", { status: 403 }));
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(new ResendSender("k", "f").send(msg)).rejects.toThrow("resend 403");
    expect(log.mock.calls.flat().join(" ")).not.toContain("<p>h</p>");
  });

  it("LogSender prints only on localhost and throws otherwise", async () => {
    const out = vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    await new LogSender(true).send(msg);
    expect(devOutbox.at(-1)).toEqual(msg);
    expect(out).toHaveBeenCalled();
    await expect(new LogSender(false).send(msg)).rejects.toThrow();
  });

  it("pickSender", () => {
    expect(pickSender({ RESEND_API_KEY: "k", EMAIL_FROM: "f", APP_ORIGIN: "https://x.example" }).kind).toBe("resend");
    expect(pickSender({ EMAIL_FROM: "f", APP_ORIGIN: "http://localhost:5173" }).kind).toBe("log");
    expect(isLocalOrigin("http://localhost:5173")).toBe(true);
    expect(isLocalOrigin("http://127.0.0.1")).toBe(true);
    expect(isLocalOrigin("https://localhost")).toBe(false);
    expect(isLocalOrigin("http://localhost.evil.com")).toBe(false);
  });

  it("login email escapes the link and formats the code", () => {
    const e = loginEmail('https://x.example/auth/verify#token=a"<b>&', "123456");
    expect(e.subject).toBe("123456 is your Mishnah Ba'al Peh sign-in code");
    expect(e.text).toContain("Or type this code in the app:  123 456");
    expect(e.html).toContain("&#34;&#60;b&#62;&#38;");
    expect(e.html).not.toContain('a"<b>');
    expect(e.html).toContain("משנה בעל פה");
    expect(e.html).toContain('dir="ltr"');
  });
});

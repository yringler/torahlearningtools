import { afterEach, describe, expect, it, vi } from "vitest";
import { devOutbox, LogSender } from "../email/log";
import { emailSafeEmoji, emailSafeName } from "../email/html";
import { loginEmail } from "../email/loginEmail";
import { perekTestEmail } from "../email/perekTestEmail";
import { hebNum } from "../../shared/hebrew";
import { masechtaIds, masechtaText, perakimCount, perekPieces } from "../lib/text";
import { maskEmail } from "../routes/perekTests";
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

describe("perek test email", () => {
  const link = 'https://app.test/perek-test#t=abc"<x>&y';

  it("stays under 90 KB for every perek, with the button above the text", () => {
    for (const id of masechtaIds()) {
      const m = masechtaText(id)!;
      for (let perek = 1; perek <= perakimCount(id); perek++) {
        const pieces = perekPieces(id, perek);
        expect(pieces.length).toBeGreaterThan(0);
        const e = perekTestEmail({ childName: "A".repeat(40), childEmoji: "🦁", masechtaHe: m.he, masechtaEn: m.en, perek, lastPerek: perek === perakimCount(id), pieces, link });
        expect(new TextEncoder().encode(e.html).byteLength).toBeLessThan(90_000);
        const href = e.html.indexOf('href="https://app.test/perek-test#t=abc&#34;&#60;x&#62;&#38;y"');
        expect(href).toBeGreaterThan(0);
        expect(href).toBeLessThan(e.html.indexOf(pieces[0]![0]!));
        expect(e.html).not.toContain('abc"<x>');
        expect(e.html).toContain(`מסכת ${m.he} פרק ${hebNum(perek)}`);
        expect(e.text).toContain(link);
        for (const piece of pieces.flat()) expect(e.text).toContain(piece);
      }
    }
  });

  it("is upbeat and never calls the learning fun or a game", () => {
    const m = masechtaText("berakhot")!;
    const e = perekTestEmail({ childName: "Avi", childEmoji: "🦁", masechtaHe: m.he, masechtaEn: m.en, perek: 2, lastPerek: false, pieces: perekPieces("berakhot", 2), link });
    expect(e.subject).toBe("🎉 Avi finished Berakhot Perek 2! Time for a quick test");
    expect(e.html).toContain("🦁 Avi learned a whole perek by heart!");
    expect(e.text).toContain("the next perek opens in the app.");
    for (const s of [e.subject, e.text, e.html]) expect(s).not.toMatch(/\b(fun|game|games|play)\b/i);
  });

  it("emailSafeName strips control, bidi and isolate characters, caps at 40, falls back", () => {
    expect(emailSafeName("Avi\u202e\u2066X\u200f\n\tY\u0000")).toBe("Avi X Y");
    expect(emailSafeName("  Dina   Leah ")).toBe("Dina Leah");
    expect(Array.from(emailSafeName("א".repeat(60)))).toHaveLength(40);
    expect(emailSafeName("\u202e\u2067 \r\n")).toBe("Your child");
    expect(emailSafeEmoji("🦁")).toBe("🦁");
    expect(emailSafeEmoji("\u202e🦁")).toBe("");
    expect(emailSafeEmoji("x".repeat(17))).toBe("");
  });

  it("maskEmail", () => {
    expect(maskEmail("yosef@gmail.com")).toBe("y•••@gmail.com");
    expect(maskEmail("a@b.co")).toBe("a•••@b.co");
  });
});

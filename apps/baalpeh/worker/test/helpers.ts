import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { vi } from "vitest";
import type { AuthSuccessResponse, ChildMeta, ChildRow, LearningEvent, RecordRow, User } from "../../shared/api";
import worker from "../index";
import { RESEND_URL } from "../email/resend";
import type { Env } from "../env";

/**
 * Env for requests. The test APP_ORIGIN is https (to exercise the __Host- cookie), and with an https origin and no
 * RESEND_API_KEY the LogSender must refuse to send. So requests run with a fake Resend key and the Resend call is
 * captured by the fetch mock below.
 */
export const testEnv: Env = { ...env, RESEND_API_KEY: "re_test_key" };
export const db = env.DB;
export const ORIGIN = env.APP_ORIGIN;

export interface SentEmail {
  to: string;
  subject: string;
  text: string;
  html: string;
  from: string;
  idempotencyKey: string | null;
  authorization: string | null;
}
export const sentEmails: SentEmail[] = [];
export const turnstileForms: FormData[] = [];

/** Mocks global fetch: Turnstile siteverify answers `success`; Resend sends are captured in `sentEmails`. */
export function mockTurnstile(success: boolean) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url === "https://challenges.cloudflare.com/turnstile/v0/siteverify") {
      turnstileForms.push(init?.body as FormData);
      return Response.json({ success });
    }
    if (url === RESEND_URL) {
      const headers = new Headers(init?.headers);
      const b = JSON.parse(String(init?.body)) as { from: string; to: string[]; subject: string; text: string; html: string };
      sentEmails.push({
        to: b.to[0]!,
        from: b.from,
        subject: b.subject,
        text: b.text,
        html: b.html,
        idempotencyKey: headers.get("Idempotency-Key"),
        authorization: headers.get("Authorization"),
      });
      return Response.json({ id: crypto.randomUUID() });
    }
    throw new Error("unexpected fetch in test: " + url);
  });
}

let seq = 0;
export function uniqueEmail(tag = "u"): string {
  return `${tag}-${Date.now().toString(36)}-${++seq}-${crypto.randomUUID().slice(0, 8)}@example.com`;
}
export function uniqueIp(): string {
  const b = crypto.getRandomValues(new Uint8Array(3));
  return `10.${b[0]}.${b[1]}.${b[2]}`;
}

export interface ReqOptions {
  method?: string;
  body?: unknown;
  /** Sent verbatim instead of JSON.stringify(body). */
  rawBody?: string;
  contentType?: string | null;
  cookie?: string;
  /** null = no Origin header. Defaults to APP_ORIGIN for non-GET requests. */
  origin?: string | null;
  ip?: string;
  headers?: Record<string, string>;
  env?: Env;
}

export async function req(path: string, o: ReqOptions = {}): Promise<Response> {
  const hasBody = o.body !== undefined || o.rawBody !== undefined;
  const method = o.method ?? (hasBody ? "POST" : "GET");
  const headers = new Headers(o.headers);
  headers.set("CF-Connecting-IP", o.ip ?? uniqueIp());
  if (o.cookie) headers.set("Cookie", o.cookie);
  const origin = o.origin === undefined ? (method === "GET" ? null : ORIGIN) : o.origin;
  if (origin !== null) headers.set("Origin", origin);
  if (hasBody && o.contentType !== null) headers.set("Content-Type", o.contentType ?? "application/json");
  const init: RequestInit = { method, headers };
  if (hasBody) init.body = o.rawBody ?? JSON.stringify(o.body);
  const ctx = createExecutionContext();
  const res = await worker.fetch(new Request(`https://app.test${path}`, init), o.env ?? testEnv, ctx);
  await waitOnExecutionContext(ctx);
  return res;
}

/** "name=value" of the session cookie set by the response, or null. */
export function cookieOf(res: Response): string | null {
  for (const c of res.headers.getSetCookie()) {
    const m = /^((?:__Host-)?bp_session)=([^;]*)/.exec(c);
    if (m && m[2]) return `${m[1]}=${m[2]}`;
  }
  return null;
}

export function sessionSetCookie(res: Response): string | undefined {
  return res.headers.getSetCookie().find((c) => /^(__Host-)?bp_session=/.test(c));
}

/** The newest captured login email for `email`: its token and code. */
export function lastLogin(email: string): { token: string; code: string; mail: SentEmail } {
  const mail = [...sentEmails].reverse().find((m) => m.to === email);
  if (!mail) throw new Error("no email sent to " + email);
  const token = /#token=([A-Za-z0-9_-]+)/.exec(mail.text)?.[1];
  const code = /^(\d{6}) /.exec(mail.subject)?.[1];
  if (!token || !code) throw new Error("could not parse login email");
  return { token, code, mail };
}

export async function requestLogin(email: string, ip?: string): Promise<Response> {
  return req("/api/auth/request", { body: { email, turnstileToken: "tok" }, ...(ip ? { ip } : {}) });
}

/** Full login via code. Requires mockTurnstile(true). */
export async function login(email = uniqueEmail()): Promise<{ cookie: string; user: User; email: string }> {
  const r1 = await requestLogin(email);
  if (r1.status !== 200) throw new Error("request failed: " + r1.status + " " + (await r1.text()));
  const { code } = lastLogin(email);
  const r2 = await req("/api/auth/verify-code", { body: { email, code } });
  if (r2.status !== 200) throw new Error("verify failed: " + r2.status + " " + (await r2.text()));
  const body = await r2.json<AuthSuccessResponse>();
  const cookie = cookieOf(r2);
  if (!cookie) throw new Error("no cookie");
  return { cookie, user: body.user, email };
}

export async function sha256(s: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(d), (b) => b.toString(16).padStart(2, "0")).join("");
}

// ───────────── sync fixtures ─────────────

export function meta(over: Partial<ChildMeta> = {}): ChildMeta {
  return { name: "Avi", color: "#336699", emoji: "🦁", settings: { fontScale: 1, tts: false, dailyMinutes: 10 }, sort: 0, ...over };
}

export function child(id: string, updatedAt: number, over: Partial<ChildRow> = {}): ChildRow {
  return { id, updatedAt, deleted: false, meta: meta(), ...over };
}

export function mRec(childId: string, key: string, updatedAt: number, stepIndex = 1): RecordRow {
  return { kind: "m", childId, key, updatedAt, data: { stepIndex, state: "learning", fails: { "0": 1 } } };
}

export function pRec(childId: string, key: string, updatedAt: number): RecordRow {
  return { kind: "p", childId, key, updatedAt, data: { chainedThrough: 2, complete: false, review: { box: 1, due: "2026-11-02", passes: 1 } } };
}

export function dRec(childId: string, key: string, updatedAt: number): RecordRow {
  return { kind: "d", childId, key, updatedAt, data: {} };
}

export function recite(childId: string, at: number, over: Partial<Extract<LearningEvent, { type: "recite" }>> = {}): LearningEvent {
  return {
    id: crypto.randomUUID(),
    childId,
    at,
    day: "2026-11-01",
    type: "recite",
    task: "learn",
    perek: 1,
    mishnah: 1,
    step: 0,
    grade: "pass",
    peeks: 0,
    ms: 5000,
    ...over,
  };
}

export function sync(cookie: string, body: { cursor?: number; children?: ChildRow[]; records?: RecordRow[]; events?: LearningEvent[] }) {
  return req("/api/sync", {
    cookie,
    body: { cursor: body.cursor ?? 0, children: body.children ?? [], records: body.records ?? [], events: body.events ?? [] },
  });
}

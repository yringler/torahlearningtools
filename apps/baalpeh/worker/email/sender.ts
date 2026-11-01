import type { Env } from "../env";
import { LogSender } from "./log";
import { ResendSender } from "./resend";

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
  idempotencyKey: string;
}

/** `send` throws on failure. */
export interface EmailSender {
  readonly kind: "resend" | "log";
  send(msg: EmailMessage): Promise<void>;
}

export function isLocalOrigin(origin: string): boolean {
  return /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
}

export function pickSender(env: Pick<Env, "RESEND_API_KEY" | "EMAIL_FROM" | "APP_ORIGIN">): EmailSender {
  if (env.RESEND_API_KEY) return new ResendSender(env.RESEND_API_KEY, env.EMAIL_FROM);
  return new LogSender(isLocalOrigin(env.APP_ORIGIN)); // printSecrets only on localhost
}

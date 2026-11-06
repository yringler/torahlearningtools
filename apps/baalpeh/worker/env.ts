import type { User } from "../shared/api";

export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  APP_ORIGIN: string; // var, e.g. "https://mishnah.example.com" (no trailing slash)
  EMAIL_FROM: string; // var, e.g. "Mishnah Ba'al Peh <login@example.com>"
  TURNSTILE_SITE_KEY: string; // var (public)
  TURNSTILE_SECRET_KEY: string; // secret
  AUTH_SECRET: string; // secret, >= 32 random bytes
  RESEND_API_KEY?: string; // secret; unset => LogSender
}

/** Set by requireParentSession / requireParent (docs/PARENT_MODE.md §6.1). */
export interface ParentVars {
  /** sessions.id: the public id written to the change log. */
  sessionId: string;
  /** The address this parent session signed in with. */
  loginEmail: string;
  expiresAt: number;
  unlockedAt: number | null;
  /** null = locked. */
  unlockedUntil: number | null;
  /** This request's User-Agent, cut to 200 chars. */
  userAgent: string;
}

export type AppEnv = { Bindings: Env; Variables: { user: User; sessionHash: string; parent?: ParentVars } };

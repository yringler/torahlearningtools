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

export type AppEnv = { Bindings: Env; Variables: { user: User; sessionHash: string } };

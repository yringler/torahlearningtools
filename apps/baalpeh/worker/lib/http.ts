import type { Context, MiddlewareHandler } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { ApiError, ErrorCode } from "../../shared/api";
import type { AppEnv } from "../env";

export const MAX_BODY_BYTES = 1_000_000;

type Extra = Pick<ApiError, "retryAfterSec" | "attemptsLeft">;

export function apiError(
  c: Context<AppEnv>,
  status: ContentfulStatusCode,
  error: ErrorCode,
  message: string,
  extra: Extra = {},
): Response {
  const body: ApiError = { error, message, ...extra };
  return c.json(body, status);
}

/** Thrown from helpers; turned into an ApiError response by app.onError. */
export class HttpError extends Error {
  constructor(
    readonly status: ContentfulStatusCode,
    readonly code: ErrorCode,
    message: string,
    readonly extra: Extra = {},
  ) {
    super(message);
  }
}

export function isJsonContentType(c: Context<AppEnv>): boolean {
  return (c.req.header("Content-Type") ?? "").toLowerCase().startsWith("application/json");
}

/** Reads a JSON body: requires application/json, enforces the 1 MB limit, parses. Throws HttpError. */
export async function readJson(c: Context<AppEnv>): Promise<unknown> {
  if (!isJsonContentType(c)) throw new HttpError(400, "bad_request", "Content-Type must be application/json");
  const len = c.req.header("Content-Length");
  if (len !== undefined && Number(len) > MAX_BODY_BYTES) {
    throw new HttpError(413, "payload_too_large", "Request body too large");
  }
  const text = await c.req.text();
  if (text.length > MAX_BODY_BYTES || new TextEncoder().encode(text).byteLength > MAX_BODY_BYTES) {
    throw new HttpError(413, "payload_too_large", "Request body too large");
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new HttpError(400, "bad_request", "Body is not valid JSON");
  }
}

/** Cache-Control: no-store and basic security headers on every /api response. */
export const securityHeaders: MiddlewareHandler<AppEnv> = async (c, next) => {
  await next();
  c.res.headers.set("Cache-Control", "no-store");
  c.res.headers.set("X-Content-Type-Options", "nosniff");
  c.res.headers.set("Referrer-Policy", "no-referrer");
};

export function clientIp(c: Context<AppEnv>): string {
  return c.req.header("CF-Connecting-IP") ?? "unknown";
}

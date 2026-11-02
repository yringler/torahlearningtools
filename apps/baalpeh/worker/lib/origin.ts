import type { MiddlewareHandler } from "hono";
import type { AppEnv } from "../env";
import { apiError, isJsonContentType, MAX_BODY_BYTES } from "./http";

const SAFE = new Set(["GET", "HEAD", "OPTIONS"]);

/** CSRF defence for every non-GET /api request (§3.6). */
export const originCheck: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (SAFE.has(c.req.method)) return next();

  const origin = c.req.header("Origin");
  const sameOrigin =
    origin !== undefined ? origin === c.env.APP_ORIGIN : c.req.header("Sec-Fetch-Site") === "same-origin";
  if (!sameOrigin) return apiError(c, 403, "forbidden", "Cross-origin request refused");

  const len = c.req.header("Content-Length");
  const hasBody = (len !== undefined && len !== "0") || c.req.header("Transfer-Encoding") !== undefined;
  if (len !== undefined && Number(len) > MAX_BODY_BYTES) {
    return apiError(c, 413, "payload_too_large", "Request body too large");
  }
  if (hasBody && !isJsonContentType(c)) {
    return apiError(c, 400, "bad_request", "Content-Type must be application/json");
  }
  return next();
};

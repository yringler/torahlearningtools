import { Hono } from "hono";
import type { ConfigResponse } from "../../shared/api";
import type { AppEnv } from "../env";
import { isLocalOrigin, pickSender } from "../email/sender";

export const configRoutes = new Hono<AppEnv>();

configRoutes.get("/config", (c) => {
  const body: ConfigResponse = {
    turnstileSiteKey: c.env.TURNSTILE_SITE_KEY,
    devEmail: pickSender(c.env).kind === "log" && isLocalOrigin(c.env.APP_ORIGIN),
  };
  return c.json(body);
});

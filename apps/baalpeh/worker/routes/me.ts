import { Hono } from "hono";
import type { MeResponse } from "../../shared/api";
import type { AppEnv } from "../env";
import { requireUser } from "../lib/session";

/** GET /api/me (learner). Account deletion moved to DELETE /api/parent/account (docs/PARENT_MODE.md §6.4). */
export const meRoutes = new Hono<AppEnv>();

meRoutes.get("/me", requireUser, (c) => {
  const body: MeResponse = { user: c.var.user };
  return c.json(body);
});

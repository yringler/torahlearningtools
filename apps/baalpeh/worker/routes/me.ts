import { Hono } from "hono";
import type { MeResponse } from "../../shared/api";
import type { AppEnv } from "../env";
import { apiError, readJson } from "../lib/http";
import { clearSession, requireUser } from "../lib/session";
import { validateDeleteAccount } from "../lib/validate";

export const meRoutes = new Hono<AppEnv>();

meRoutes.get("/me", requireUser, (c) => {
  const body: MeResponse = { user: c.var.user };
  return c.json(body);
});

meRoutes.delete("/account", requireUser, async (c) => {
  const v = validateDeleteAccount(await readJson(c));
  const user = c.var.user;
  if (!v.ok || v.value.email !== user.email) {
    return apiError(c, 400, "bad_request", "Type your account email to confirm");
  }
  const db = c.env.DB;
  await db.batch([
    db.prepare("DELETE FROM events WHERE user_id = ?1").bind(user.id),
    db.prepare("DELETE FROM progress WHERE user_id = ?1").bind(user.id),
    db.prepare("DELETE FROM children WHERE user_id = ?1").bind(user.id),
    db.prepare("DELETE FROM sessions WHERE user_id = ?1").bind(user.id),
    db.prepare("DELETE FROM login_requests WHERE email = ?1").bind(user.email),
    db.prepare("DELETE FROM users WHERE id = ?1").bind(user.id),
  ]);
  clearSession(c);
  return c.body(null, 204);
});

import { Hono } from "hono";
import type { AppEnv, Env } from "./env";
import { cleanup } from "./cron";
import { apiError, HttpError, securityHeaders } from "./lib/http";
import { originCheck } from "./lib/origin";
import { authRoutes } from "./routes/auth";
import { childrenRoutes } from "./routes/children";
import { configRoutes } from "./routes/config";
import { meRoutes } from "./routes/me";
import { syncRoutes } from "./routes/sync";

const app = new Hono<AppEnv>();
app.use("/api/*", securityHeaders, originCheck);
app.route("/api", configRoutes); // GET /config
app.route("/api/auth", authRoutes); // request, verify-link, verify-code, logout
app.route("/api", meRoutes); // GET /me, DELETE /account
app.route("/api", syncRoutes); // POST /sync
app.route("/api/children", childrenRoutes); // GET /:id/events, /:id/stats
app.all("/api/*", (c) => apiError(c, 404, "not_found", "No such endpoint"));
app.all("*", (c) => c.env.ASSETS.fetch(c.req.raw)); // only reached if run_worker_first matched; defensive
app.onError((err, c) => {
  if (err instanceof HttpError) return apiError(c, err.status, err.code, err.message, err.extra);
  console.error(err);
  return apiError(c, 500, "server_error", "Something went wrong");
});

export { app };
export default {
  fetch: app.fetch,
  scheduled: (_ctl, env, ctx) => ctx.waitUntil(cleanup(env, Date.now())),
} satisfies ExportedHandler<Env>;

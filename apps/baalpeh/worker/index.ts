import { Hono } from "hono";
import type { AppEnv, Env } from "./env";
import { cleanup } from "./cron";
import { apiError, HttpError, securityHeaders } from "./lib/http";
import { originCheck } from "./lib/origin";
import { authRoutes } from "./routes/auth";
import { configRoutes } from "./routes/config";
import { meRoutes } from "./routes/me";
import { parentRoutes } from "./routes/parent";
import { perekTestRoutes } from "./routes/perekTests";
import { pinResetRoutes } from "./routes/pinReset";
import { syncRoutes } from "./routes/sync";

const app = new Hono<AppEnv>();
app.use("/api/*", securityHeaders, originCheck);
app.route("/api", configRoutes); // GET /config
app.route("/api/auth", authRoutes); // request, verify-link, verify-code, logout
app.route("/api", meRoutes); // GET /me (learner)
app.route("/api", syncRoutes); // POST /sync (learner)
app.route("/api/parent", parentRoutes); // parent mode (docs/PARENT_MODE.md §6.4), includes /children/* and /sync
app.route("/api/pin-reset", pinResetRoutes); // POST /lookup, POST / (no session)
app.route("/api/perek-tests", perekTestRoutes); // POST /, /lookup, /confirm, /forgot-pin (no GET route on purpose)
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

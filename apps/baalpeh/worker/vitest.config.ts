import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import { fileURLToPath } from "node:url";
import { defineProject } from "vitest/config";

const root = fileURLToPath(new URL("..", import.meta.url));
const migrations = await readD1Migrations(`${root}migrations`);

export default defineProject({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: `${root}wrangler.jsonc` },
      miniflare: {
        bindings: {
          TEST_MIGRATIONS: migrations,
          APP_ORIGIN: "https://app.test",
          AUTH_SECRET: "test-secret-0123456789abcdef0123456789abcdef",
          TURNSTILE_SECRET_KEY: "1x0000000000000000000000000000000AA",
          TURNSTILE_SITE_KEY: "1x00000000000000000000AA",
          EMAIL_FROM: "Test <login@app.test>",
        },
      },
    }),
  ],
  test: { name: "worker", include: ["test/**/*.test.ts"], setupFiles: ["./test/setup.ts"] },
});

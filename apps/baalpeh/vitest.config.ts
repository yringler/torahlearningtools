import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      { extends: "./vite.config.ts", test: { name: "client", include: ["tests/**/*.test.ts"], environment: "node" } },
      "./worker/vitest.config.ts",
    ],
  },
});

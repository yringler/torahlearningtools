import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Served by the Cloudflare Worker at the domain root. In dev, /api is proxied to `wrangler dev` on :8787.
export default defineConfig({
  base: "/",
  plugins: [react()],
  build: { outDir: "dist" },
  server: { port: 5173, strictPort: true, proxy: { "/api": { target: "http://localhost:8787" } } },
});

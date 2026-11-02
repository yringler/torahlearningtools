import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, transformWithEsbuild, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

const root = fileURLToPath(new URL(".", import.meta.url));

/** Every file under public/ as a URL path ("/icons/icon-192.png"). */
function publicFiles(dir = join(root, "public")): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? publicFiles(full) : ["/" + relative(join(root, "public"), full).split("\\").join("/")];
  });
}

/**
 * Builds dist/sw.js from sw/sw.ts with the list of files to precache and a version hash in front.
 * Precached: this build's bundle (with index.html as "/") and public/ files except _headers and the masechta texts,
 * which are cached when first opened instead (the full Mishnah would be megabytes).
 */
function serviceWorker(): Plugin {
  return {
    name: "baalpeh-service-worker",
    apply: "build",
    enforce: "post",
    async generateBundle(_options, bundle) {
      const built = Object.keys(bundle).map((f) => (f === "index.html" ? "/" : "/" + f));
      const extra = publicFiles().filter((f) => f !== "/_headers" && !f.startsWith("/data/"));
      const precache = [...new Set([...built, ...extra])].sort();

      const hash = createHash("sha256");
      for (const f of built) {
        const out = bundle[f === "/" ? "index.html" : f.slice(1)];
        if (out) hash.update(f).update(out.type === "chunk" ? out.code : out.source);
      }
      for (const f of extra) hash.update(f).update(readFileSync(join(root, "public", f)));
      const source = readFileSync(join(root, "sw/sw.ts"), "utf8");
      hash.update(source);

      const { code } = await transformWithEsbuild(source, "sw.ts", { loader: "ts", format: "esm", target: "es2020", minify: true });
      const header = `const PRECACHE=${JSON.stringify(precache)};const VERSION=${JSON.stringify(hash.digest("hex").slice(0, 12))};\n`;
      // The worker is a classic script: drop the `export {}` that only makes sw.ts a module for TypeScript.
      this.emitFile({ type: "asset", fileName: "sw.js", source: header + code.replace(/export\s*\{\s*\};?/g, "") });
    },
  };
}

// Served by the Cloudflare Worker at the domain root. In dev, /api is proxied to `wrangler dev` on :8787.
export default defineConfig({
  base: "/",
  plugins: [react(), serviceWorker()],
  build: { outDir: "dist" },
  server: { port: 5173, strictPort: true, proxy: { "/api": { target: "http://localhost:8787" } } },
});

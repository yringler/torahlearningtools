import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { viteSingleFile } from "vite-plugin-singlefile";

// `--mode single` builds one self-contained index.html (for sharing as a single file).
// Default build targets GitHub Pages at /<repo>/.
export default defineConfig(({ mode }) => ({
  base: mode === "single" ? "./" : "/Baalpeh/",
  plugins: mode === "single" ? [react(), viteSingleFile()] : [react()],
  build: { outDir: mode === "single" ? "dist-single" : "dist" },
}));

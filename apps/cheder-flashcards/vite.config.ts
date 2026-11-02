import { defineConfig } from "vitest/config";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  base: "./",
  plugins: [
    VitePWA({
      // The app asks to register itself (src/pwa.ts), and updates wait for a safe moment.
      registerType: "prompt",
      injectRegister: false,
      // Our own worker (src/sw.ts), so it can retire itself on old hostnames. It is still
      // built to sw.js: installed apps only look for updates at that exact URL.
      strategies: "injectManifest",
      srcDir: "src",
      filename: "sw.ts",
      manifest: {
        name: "Word Quiz",
        short_name: "Word Quiz",
        start_url: "./",
        scope: "./",
        display: "standalone",
        background_color: "#fff7e0",
        theme_color: "#1e6bff",
        icons: [
          { src: "icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "icon-512.png", sizes: "512x512", type: "image/png" },
          { src: "icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      injectManifest: { globPatterns: ["**/*.{js,css,html,svg,png,woff2,webmanifest}"] },
    }),
  ],
  test: {
    include: ["tests/**/*.test.ts"],
  },
});

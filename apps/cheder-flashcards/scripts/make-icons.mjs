// Renders the PNG icons from public/icon.svg's design. Run: node scripts/make-icons.mjs
import { chromium } from "@playwright/test";
import { readFileSync } from "node:fs";

const BLUE = "#1e6bff";
// Embed the font so the render does not depend on what is installed on this machine.
const fontFile = readFileSync("node_modules/@fontsource/noto-serif-hebrew/files/noto-serif-hebrew-hebrew-600-normal.woff2");
const fontCss = `@font-face { font-family: "Noto Serif Hebrew"; font-weight: 600; src: url(data:font/woff2;base64,${fontFile.toString("base64")}); }`;

// `art` is how much of the square the letter's box takes; maskable icons keep it in the central 80%.
function html(size, { rounded, art }) {
  return `<style>${fontCss}
    html, body { margin: 0; background: ${rounded ? "transparent" : BLUE}; }
    div { width: ${size}px; height: ${size}px; background: ${BLUE}; ${rounded ? `border-radius: ${size * 0.22}px;` : ""}
      display: flex; align-items: center; justify-content: center;
      color: #fff; font: 600 ${size * art}px/1 "Noto Serif Hebrew", serif; }
  </style><div>א</div>`;
}

const icons = [
  { file: "icon-192.png", size: 192, rounded: true, art: 0.62 },
  { file: "icon-512.png", size: 512, rounded: true, art: 0.62 },
  { file: "icon-maskable-512.png", size: 512, rounded: false, art: 0.5 },
  { file: "apple-touch-icon.png", size: 180, rounded: false, art: 0.62 },
];

const browser = await chromium.launch();
for (const { file, size, rounded, art } of icons) {
  const page = await browser.newPage({ viewport: { width: size, height: size } });
  await page.setContent(html(size, { rounded, art }));
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: `public/${file}`, omitBackground: rounded });
  await page.close();
}
await browser.close();

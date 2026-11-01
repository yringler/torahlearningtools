import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { DEFAULT_MASECHTA_ID, loadMasechta } from "./data";
import "./fonts.css";
import "./styles.css";

// Start downloading the text now, in parallel with the sign-in check. DataGate shows any error.
loadMasechta(DEFAULT_MASECHTA_ID).catch(() => {});

const root = document.getElementById("root");
if (root) createRoot(root).render(<StrictMode><App /></StrictMode>);

// The service worker caches the app and the text so it opens offline. Production only: in dev it would serve stale
// modules over Vite's hot reload.
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch((e: unknown) => console.warn("Service worker registration failed", e));
  });
}

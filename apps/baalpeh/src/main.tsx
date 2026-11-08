import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { UpdateBar } from "./components/UpdateBar";
import { DEFAULT_MASECHTA_ID, prefetchMasechta } from "./data";
import "./fonts.css";
import "./styles.css";
import { registerServiceWorker } from "./swUpdate";

// Start downloading the default masechta now, in parallel with the sign-in check (most children start there). The
// masechta screens' gate (MasechtaGate) loads whichever masechta is opened and shows any error.
prefetchMasechta(DEFAULT_MASECHTA_ID).catch(() => {});

const root = document.getElementById("root");
if (root) createRoot(root).render(<StrictMode><App /><UpdateBar /></StrictMode>);

// The service worker caches the app and the text so it opens offline. Production only: in dev it would serve stale
// modules over Vite's hot reload.
if (import.meta.env.PROD && "serviceWorker" in navigator) registerServiceWorker();

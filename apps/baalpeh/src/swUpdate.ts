/**
 * Registers the service worker and tracks whether a newer version of the app is waiting to take over.
 *
 * How an update reaches an open page:
 *  1. The browser re-downloads /sw.js on navigations and on reg.update(). Any deploy changes its bytes (VERSION),
 *     so the new worker installs and precaches the new build in the background.
 *  2. It then waits (sw/sw.ts never calls skipWaiting on its own). This page sees it waiting and shows the bar.
 *  3. Reload posts SKIP_WAITING; the new worker activates and claims this page ("controllerchange"); we reload,
 *     and the page now loads from the new build.
 *
 * An installed app (home-screen PWA) that is only resumed never navigates, so the browser would not check for a
 * new sw.js; we check ourselves when the app comes back to the foreground and once an hour while it stays open.
 */
import { useSyncExternalStore } from "react";

const CHECK_EVERY_MS = 60 * 60 * 1000;

let waiting: ServiceWorker | null = null;
const listeners = new Set<() => void>();

function setWaiting(w: ServiceWorker | null): void {
  if (w === waiting) return;
  waiting = w;
  for (const l of listeners) l();
}

/** True while a newer version is installed and waiting for the user to reload. */
export function useUpdateReady(): boolean {
  return useSyncExternalStore(
    (l) => { listeners.add(l); return () => { listeners.delete(l); }; },
    () => waiting !== null,
    () => false,
  );
}

let applying = false;

/** Switch to the waiting version and reload the page once it has taken over. */
export function applyUpdate(): void {
  if (!waiting) return window.location.reload();
  applying = true;
  waiting.postMessage("SKIP_WAITING");
}

export function registerServiceWorker(): void {
  const sw = navigator.serviceWorker;

  // Only reload for a takeover the user asked for. The very first install also claims the page (clients.claim),
  // and that must not reload it.
  sw.addEventListener("controllerchange", () => {
    if (applying) window.location.reload();
  });

  window.addEventListener("load", () => {
    sw.register("/sw.js").then(
      (reg) => {
        // A worker that finished installing while a controller already exists is an update. Without a controller
        // it is the first install, which activates by itself.
        const track = (w: ServiceWorker | null): void => {
          if (!w) return;
          const check = (): void => { if (w.state === "installed" && sw.controller) setWaiting(w); };
          check();
          w.addEventListener("statechange", check);
        };
        track(reg.waiting); // installed during an earlier visit, still waiting
        track(reg.installing);
        reg.addEventListener("updatefound", () => track(reg.installing));

        const checkForUpdate = (): void => { reg.update().catch(() => {}); }; // fails offline; try again later
        document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") checkForUpdate(); });
        setInterval(checkForUpdate, CHECK_EVERY_MS);
      },
      (e: unknown) => console.warn("Service worker registration failed", e),
    );
  });
}

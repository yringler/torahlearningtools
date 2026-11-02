/// <reference lib="webworker" />
import { cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute } from "workbox-precaching";
import { NavigationRoute, registerRoute } from "workbox-routing";
import { RETIRED_HOSTS } from "./retired-hosts";

declare const self: ServiceWorkerGlobalScope;

if (RETIRED_HOSTS.has(self.location.hostname)) {
  // Old host: the cached app would hide the redirect forever. Take over at once, drop every
  // cache, unregister, and reload open tabs from the network so they follow the 301.
  // No fetch listener here, so requests go straight to the network.
  self.addEventListener("install", (): void => {
    void self.skipWaiting();
  });

  self.addEventListener("activate", (event: ExtendableEvent): void => {
    event.waitUntil(
      (async (): Promise<void> => {
        const keys: string[] = await caches.keys();
        await Promise.all(keys.map((k: string) => caches.delete(k)));
        await self.registration.unregister();
        const windows: readonly WindowClient[] = await self.clients.matchAll({ type: "window" });
        await Promise.all(
          windows.map((c: WindowClient) => c.navigate(c.url).catch((): null => null)),
        );
      })(),
    );
  });
} else {
  // Same as the worker generateSW used to build: updates wait until the page asks (src/pwa.ts).
  self.addEventListener("message", (event: ExtendableMessageEvent): void => {
    const data: unknown = event.data;
    if (typeof data === "object" && data !== null && (data as { type?: unknown }).type === "SKIP_WAITING") {
      void self.skipWaiting();
    }
  });

  precacheAndRoute(self.__WB_MANIFEST, {});
  cleanupOutdatedCaches();
  registerRoute(new NavigationRoute(createHandlerBoundToURL("index.html")));
}

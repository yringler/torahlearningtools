import { registerSW } from "virtual:pwa-register";
import { RETIRED_HOSTS } from "./retired-hosts";

// A new version of the app is installed in the background. It only takes over when
// the child has left the app AND is on the home screen, so a quiz is never cut off
// (quiz state lives in memory; progress on the home screen is already saved).
let updateWaiting = false;
let safe = false;

// On an old hostname the page would only be reached if the redirect is missing; registering
// there would make the retiring worker reload the page over and over.
const updateSW = RETIRED_HOSTS.has(location.hostname)
  ? null
  : registerSW({
      onNeedRefresh() {
        updateWaiting = true;
      },
      onRegisteredSW(_url, registration) {
        document.addEventListener("visibilitychange", () => {
          // Offline, the check fails; that is fine, it tries again next time.
          if (document.visibilityState === "visible") registration?.update().catch(() => {});
        });
      },
    });

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden" && updateWaiting && safe) void updateSW?.(true);
});

export function setSafeToUpdate(isSafe: boolean): void {
  safe = isSafe;
}

// Installed apps can lose their saved progress when the phone is short on space; ask it not to.
if (window.matchMedia("(display-mode: standalone)").matches && navigator.storage?.persist) {
  navigator.storage.persist().catch(() => {});
}

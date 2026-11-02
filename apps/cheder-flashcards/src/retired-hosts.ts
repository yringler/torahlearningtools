// Old hostnames of the app. Cloudflare 301s them to the new host (except /sw.js), so on
// these hosts the service worker removes itself and the page does not register one.
export const RETIRED_HOSTS: ReadonlySet<string> = new Set<string>([
  "chederflashcards.yehudardevelopment.com",
]);

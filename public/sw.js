/**
 * DeckHQ's service worker — WP-16.
 *
 * IT EXISTS TO MAKE THE APP INSTALLABLE, AND FOR NOTHING ELSE.
 *
 * An installed DeckHQ gets a dock/taskbar icon, and that icon can carry the
 * needs-you count through the Badging API even with every window closed —
 * which is the whole point of the package (`docs/plan/08-PLAN-V2-100X.md`
 * §1.2: the product's job is to let you stop watching). Installability
 * requires a manifest and a registered service worker with a fetch handler.
 * This is that, and no more.
 *
 * WHAT IT DELIBERATELY DOES NOT DO
 *
 *   - **It caches nothing.** Not `/api/state`, not `/api/events`, not the
 *     shell. Every byte this product shows is live local state, and a cached
 *     floor is a floor that lies about who is waiting. A stale needs-you
 *     count is worse than no floor at all.
 *   - **It intercepts nothing.** The `fetch` listener below never calls
 *     `respondWith`, so every request is issued by the browser exactly as it
 *     would have been. That matters most for `/api/events`: an SSE stream
 *     passed through a worker's response pipeline is a well-known way to
 *     break streaming, and the floor is that stream.
 *   - **It reaches nothing off this machine.** No CDN, no push endpoint, no
 *     background sync, no analytics. `test/unit/pwa.test.mjs` reads this file
 *     and the manifest and fails on any host that is not loopback — the
 *     zero-egress promise (`docs/plan/08-PLAN-V2-100X.md` §1.1 rule 2) is not
 *     something a service worker gets an exemption from.
 *
 * If this file ever grows a cache, it needs a plan for invalidating it that
 * is stronger than "the user reloads", and a line in the changelog saying the
 * floor can now be shown from cache.
 */

self.addEventListener('install', () => {
  // Nothing to precache. Take over immediately so a reload after an update
  // is not two reloads.
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', () => {
  // Intentionally empty: registering a fetch handler is what makes the app
  // installable; responding to one is what would make it lie. See above.
});

/**
 * The handful of browser globals `lib.dom` does not carry, declared for
 * `public/tsconfig.json`.
 *
 * `public/` is served as static files to a browser. It has no Node globals,
 * and that is enforced rather than assumed: this file is the ONLY ambient
 * surface the browser project loads, so reaching for `process` or `Buffer`
 * from `public/` is a type error. See `types/node.d.ts` for the other half.
 */

/** `sw.js` runs in a ServiceWorkerGlobalScope, which `lib.dom` does not model. */
interface ServiceWorkerGlobalScopeLike {
  skipWaiting(): Promise<void>;
  clients: { claim(): Promise<void>; matchAll(opts?: any): Promise<any[]> };
  registration: any;
}

interface Window {
  /** Safari's prefixed constructor, feature-detected in `sound.js`. */
  webkitAudioContext?: typeof AudioContext;
  /** `sw.js` reads these off its own global scope. */
  skipWaiting?: ServiceWorkerGlobalScopeLike['skipWaiting'];
  clients?: ServiceWorkerGlobalScopeLike['clients'];
}

/** `ExtendableEvent`/`FetchEvent`, which `lib.dom` leaves to `lib.webworker`. */
interface Event {
  waitUntil?(promise: Promise<any>): void;
  respondWith?(response: Response | Promise<Response>): void;
}

interface HTMLCanvasElement {
  /**
   * The live `Scene` a canvas is bound to. Attached by `scene.js` so the
   * mini-floor and the snapshot route can find the scene from the element.
   */
  __deckhqScene?: any;
}

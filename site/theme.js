/*
 * The stored colour scheme, applied before the first paint — WP-94c.
 *
 * This is the only script on the site that is not deferred, and it is this
 * small for that reason: it reads one key and sets one attribute. Everything
 * else waits for the document. With scripting off the attribute is never set
 * and `prefers-color-scheme` decides, which is the behaviour the stylesheet is
 * written around.
 *
 * It touches nothing but `localStorage` and the root element. No network call,
 * here or anywhere else on this site.
 */
(function () {
  try {
    const t = localStorage.getItem('deckhq-theme');
    if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t);
  } catch {
    /* storage blocked; the OS preference is the answer */
  }
})();

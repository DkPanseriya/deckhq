/**
 * The panel's HTML: a full-bleed iframe holding the floor, and nothing else.
 *
 * **Why an iframe and not a port of the floor.** The floor is 12,000 lines of
 * renderer that already runs in a browser and already talks to the daemon on
 * its own origin. Re-serving it through `webview.asWebviewUri` would move it
 * to the `vscode-webview://` origin, where its every request for `/api/state`
 * becomes cross-origin and every POST becomes exactly the cross-site request
 * the daemon's CSRF guard refuses (`src/daemon.mjs`). Inside an iframe
 * the floor keeps its own origin: its requests are same-origin, they carry
 * `Sec-Fetch-Site: same-origin`, and the guard waves them through unchanged.
 * **No allowance had to be added to the daemon for this extension**, which is
 * the outcome worth having.
 *
 * **The CSP is the minimum that renders a frame.** `default-src 'none'` — no
 * images, no fonts, no styles, no connections from the wrapper document, which
 * needs none of them. `frame-src` names exactly one origin: the loopback port
 * the daemon answered on. The one nonce'd style block sizes the frame, and the
 * one nonce'd script exists only so a second "Show waiting" can move the frame
 * to another agent without tearing down the floor and its SSE stream.
 */

/**
 * A nonce for the CSP. `Math.random` is not a cryptographic source and does
 * not need to be one: this value is not a secret and not a capability, it only
 * has to be unpredictable to the page's own content, which is a fixed string
 * we wrote.
 * @returns {string}
 */
function nonce() {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let out = '';
  for (let i = 0; i < 32; i++) out += alphabet[Math.floor(Math.random() * alphabet.length)];
  return out;
}

/**
 * Escape a value for a double-quoted HTML attribute.
 *
 * The apostrophe is deliberately left alone: every attribute here is delimited
 * by `"`, so `'` cannot end one — and a CSP is made of `'none'` and
 * `'nonce-…'`, which an over-eager escape would turn into a policy the browser
 * silently refuses to parse.
 * @param {string} s
 */
function escapeAttr(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * The panel document.
 *
 * @param {{url:string, origin:string, nonce?:string}} opts
 *   `url` is the floor's URL, fragment and all; `origin` is the scheme, host
 *   and port alone, which is what `frame-src` takes.
 * @returns {string}
 */
function floorHtml(opts) {
  const n = opts.nonce || nonce();
  const csp = [
    "default-src 'none'",
    `frame-src ${opts.origin}`,
    `style-src 'nonce-${n}'`,
    `script-src 'nonce-${n}'`,
  ].join('; ');

  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta http-equiv="Content-Security-Policy" content="${escapeAttr(csp)}" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>DeckHQ</title>
    <style nonce="${n}">
      html,
      body {
        height: 100%;
        margin: 0;
        padding: 0;
        overflow: hidden;
        background: #14121a;
      }
      iframe {
        display: block;
        width: 100%;
        height: 100%;
        border: 0;
      }
    </style>
  </head>
  <body>
    <iframe id="floor" src="${escapeAttr(opts.url)}" title="The DeckHQ floor"></iframe>
    <script nonce="${n}">
      // The only message this document accepts, and the only thing it does
      // with one: point the frame at another agent. Nothing is evaluated,
      // nothing is inserted into the DOM, and a message that is not exactly
      // this shape is ignored.
      window.addEventListener('message', function (event) {
        var message = event.data;
        if (!message || message.type !== 'deckhq.setUrl') return;
        if (typeof message.url !== 'string') return;
        if (message.url.indexOf('http://127.0.0.1:') !== 0) return;
        document.getElementById('floor').src = message.url;
      });
    </script>
  </body>
</html>
`;
}

module.exports = { floorHtml, nonce, escapeAttr };

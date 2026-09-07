/**
 * The layout file: writing one out, and reading one back.
 *
 * Split out of `app.js` by WP-60, which took that file past `model.test.mjs`'s
 * 900-line ceiling — the shell was sitting at 899 and the idle-projects chip
 * was the line that broke it. These two are what came out, because they are
 * the pair in that file with the least to do with anything else in it: they
 * touch `fetch`, a `<a download>`, an `<input type="file">` and `toast`, and
 * nothing else in the shell at all. No scene, no snapshot, no selection.
 *
 * THE DAEMON IS THE AUTHORITY ON WHAT A LAYOUT IS. Neither of these validates
 * one. `exportLayout` writes down whatever `/api/layout` hands it, and
 * `importLayout` parses the file only far enough to be valid JSON before
 * posting it — the refusal the user reads is the daemon's own, and a refused
 * file changes nothing at all (`src/http/routes/layout.mjs`).
 */

import { toast } from './app-state.js';

/**
 * Download the current floor as a layout file.
 *
 * The toast says what is IN the file rather than only that a file happened,
 * and it says the one thing a person needs to know before sending it to
 * anybody: a layout names the user's project folders, so it is not anonymous.
 */
export async function exportLayout() {
  try {
    const res = await fetch('/api/layout');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const layout = await res.json();
    const blob = new Blob(
      [
        `${JSON.stringify(layout, null, 2)}
`,
      ],
      { type: 'application/json' },
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'deckhq-layout.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
    toast(
      `Layout saved: theme “${layout.theme}”, ${layout.rooms.length} room(s). ` +
        'It names your project folders — it is not anonymous.',
    );
  } catch (err) {
    toast(`Could not export the layout: ${err.message}`, { isError: true });
  }
}

/**
 * Apply a layout file.
 *
 * The file is parsed here only far enough to be valid JSON; the daemon is the
 * one authority on whether it is a LAYOUT, so its refusal is what the user
 * reads. A refused file changes nothing at all — see `src/http/routes/layout.mjs`.
 */
export function importLayout() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'application/json,.json';
  input.addEventListener('change', async () => {
    const file = input.files && input.files[0];
    if (!file) return;
    try {
      const text = await file.text();
      let parsed;
      try {
        parsed = JSON.parse(text);
      } catch (err) {
        throw new Error(`that file is not JSON (${err.message})`);
      }
      const res = await fetch('/api/layout', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(parsed),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
      const layout = body.layout || {};
      toast(`Layout applied: theme “${layout.theme}”, ${(layout.rooms || []).length} room(s).`);
    } catch (err) {
      toast(`${err.message} Nothing was changed.`, { isError: true });
    }
  });
  input.click();
}

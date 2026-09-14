/**
 * The Usage tab's two reads, and the one setting that hides the money (WP-83).
 *
 * `public/usage.js` builds the DOM and `public/deck.js` owns the tab; this is
 * the layer between them and the network — the same split `app-cards.js` and
 * `app-launchers.js` keep, and the reason `deck.js` can go on promising that
 * nothing in it fetches at all.
 *
 * Everything here is a READ. `GET /api/stats` replays a directory of text
 * files; it touches no ack state and no `state.json`. The one write is
 * `setShowCost`, which goes through `saveSetting` like every other preference
 * and changes what is DRAWN and nothing that is measured — turning it back on
 * restores every cost surface exactly as it was, because no number was thrown
 * away to hide it.
 */

import { latestSnapshot } from './app-state.js';
import { saveSetting } from './app-notify.js';

/**
 * The project key → name map the last usage fetch came back with.
 *
 * The ledger holds hashes by design (WP-48), and `GET /api/stats` builds this
 * by hashing the cwds the registry already holds — so a project the ledger
 * knows about but that has no session on the floor stays a hash, and no path
 * is ever in the response. A LOOKUP, never a reverse.
 * @type {Record<string, string>}
 */
let projectNames = {};

/**
 * One window's usage, from the daemon.
 *
 * Throws on a bad response rather than returning an empty one: `deck.js` reads
 * a throw as "the ledger could not be read", which is the same thing it draws
 * for a window with no records — and a silent empty object would be a claim
 * that the window was empty.
 *
 * @param {string} window `today` | `7d` | `30d`
 * @returns {Promise<any>}
 */
export async function loadUsage(window) {
  const res = await fetch(`/api/stats?window=${encodeURIComponent(window)}`);
  if (!res.ok) throw new Error(`stats ${res.status}`);
  const body = await res.json();
  projectNames = body && body.projects ? body.projects : {};
  return body ? body.usage : null;
}

/**
 * The two lookups that turn a ledger key into something a person recognises.
 *
 * Sessions come off the live snapshot, which is the only place a display name
 * exists; a session the floor has forgotten keeps its id, shortened, which is
 * honest about the fact that we no longer know what it was called.
 */
export function usageNames() {
  /** @type {Record<string, string>} */
  const sessionNames = {};
  for (const a of latestSnapshot?.agents || []) {
    sessionNames[a.id] = a.displayName || a.label || a.mk || a.title || a.id;
  }
  return { projectNames, sessionNames };
}

/**
 * Turn the currency on or off, everywhere at once.
 *
 * Persisted, because whether a dollar figure is on screen is a property of the
 * machine rather than of this tab — unlike `cmd:show-let-go`, which is a view
 * filter and lives in memory. The toast says what is now on the surfaces
 * rather than only that a switch moved.
 *
 * @param {boolean} next
 * @param {(text:string, o?:any) => void} toast
 */
export async function setShowCost(next, toast) {
  const saved = await saveSetting({ showCost: next });
  if (!saved) return;
  toast(
    next
      ? 'Cost is showing again — a list-price estimate for comparing projects, never a bill.'
      : 'Cost hidden. Every surface shows the tokens it was measured from.',
  );
}

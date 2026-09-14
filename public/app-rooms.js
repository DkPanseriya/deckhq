/**
 * The two things a person decides about a ROOM rather than about a session.
 *
 * Split out of `app.js` by WP-77, which took that file past `model.test.mjs`'s
 * 900-line ceiling for the second time — WP-60 answered the first by moving the
 * layout file out (`app-layout.js`), and this is the same remedy applied to the
 * next pair that has the least to do with anything else in the shell. Both of
 * these touch `fetch` and `toast` and nothing at all besides: no scene, no
 * snapshot, no selection.
 *
 * WHAT THEY ARE. Two halves of one question — should this repo have a room on
 * the floor? — asked from opposite ends:
 *
 *   pin      keep a room when nobody is working in it     (WP-77)
 *   archive  take the room away when nobody is            (WP-30)
 *
 * They are not exclusive and the interface never offers both at once, but where
 * they meet, ARCHIVING WINS: both are the user speaking, and "take this off my
 * floor" is the more specific of the two (`public/floor-rule.js`).
 *
 * THE DAEMON IS THE AUTHORITY ON BOTH. Neither of these predicts the answer or
 * repaints anything: each posts, and the floor changes when the next snapshot
 * arrives. A row that relabelled itself before the write landed would be the
 * interface telling the user something it does not yet know.
 */

import { toast } from './app-state.js';

/**
 * Pin a project's room to the floor, or take the pin back (WP-77).
 *
 * The owner, 14 September: _"Pin any particular project room so it is always in
 * a room, so the room does not collapse when agents are not running."_
 *
 * ONE ROUTE, reached from two places — the idle popover's row toggle and the
 * palette's `Pin` / `Unpin` — because a preference you can set in one place and
 * clear in another is two controls.
 *
 * @param {string} projectId
 * @param {boolean} pinned
 */
export async function setProjectPinned(projectId, pinned) {
  try {
    const res = await fetch('/api/pin', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: projectId, pinned }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    toast(pinned ? 'Pinned to the floor.' : 'Unpinned.');
  } catch (err) {
    toast(`Could not pin that room: ${err.message}`, { isError: true });
  }
}

/**
 * Collapse a project room off the floor, or bring it back (WP-30).
 *
 * Silent on success on purpose: the room leaving the floor IS the feedback, and
 * a toast over a floor that has just visibly changed is a second answer to a
 * question the picture already answered.
 *
 * @param {string} projectId
 * @param {boolean} archived
 */
export async function setProjectArchived(projectId, archived) {
  try {
    const res = await fetch('/api/project-archive', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: projectId, archived }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  } catch (err) {
    toast(`Could not change that room: ${err.message}`, { isError: true });
  }
}

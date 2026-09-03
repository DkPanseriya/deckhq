/**
 * The hover tooltip, and the cursor tracking both floating overlays share.
 *
 * Split out of `app.js` by WP-22. The tooltip is where identity detail lives
 * (CONTRACTS-WP15.md §1): the answer to "what is MK3.2?" is the full title,
 * project, model, branch, state, elapsed and tokens, in one place.
 *
 * `app.js` keeps the `mousemove` listener — every top-level side effect stayed
 * where it was, so nothing about registration order changed — and hands the
 * position here through `noteMouse`.
 */

import { recordLineFor } from './records.js';
import { STATE_LABELS, el, findAgent, formatNumber, palette, panel } from './app-state.js';

let lastMouse = { x: 0, y: 0 };

/**
 * Position a floating overlay (tooltip or whiteboard) near the cursor,
 * clamped to stay inside the viewport. Shared so both read the same mouse
 * tracking and clamp the same way.
 * @param {HTMLElement} node
 * @param {number} maxW approx overlay width budget, for the right/bottom clamp
 */
export function placeNearCursor(node, maxW) {
  const x = Math.min(lastMouse.x + 14, window.innerWidth - maxW);
  const y = Math.min(lastMouse.y + 14, window.innerHeight - 90);
  node.style.left = `${Math.max(0, x)}px`;
  node.style.top = `${Math.max(0, y)}px`;
}

/**
 * The rarity word for one agent, or null — for a common agent (most of them),
 * and for as long as `render/palette.js` has not loaded, since that import is
 * dynamic and defensive (see the file header). Absent rather than wrong is the
 * right failure: the word is a grace note, not information the user needs.
 * @param {any} agent
 * @returns {string|null}
 */
function rarityWordFor(agent) {
  if (!agent || !palette?.appearanceFor || !palette?.rarityWord) return null;
  try {
    return palette.rarityWord(palette.appearanceFor(agent.id).tier);
  } catch (err) {
    console.debug('[deckhq] rarityWord failed', err);
    return null;
  }
}

/** @param {string} text */
function tooltipLine(text) {
  const line = document.createElement('div');
  line.className = 'tooltip-line';
  line.textContent = text;
  return line;
}

/**
 * The hover tooltip is where identity detail lives (CONTRACTS-WP15.md §1,
 * WP15 task B): the answer to "what is MK3.2?" is the full session title,
 * project, model, branch, state, elapsed and tokens — all in one place, all
 * still minimal (no card, see the halo treatment in style.css).
 * @param {string|null} agentId
 */
export function showTooltip(agentId) {
  if (!agentId) {
    el.tooltip.hidden = true;
    return;
  }
  const agent = findAgent(agentId);
  if (!agent) {
    el.tooltip.hidden = true;
    return;
  }
  el.tooltip.textContent = '';

  const title = document.createElement('div');
  title.className = 'tooltip-title';
  title.textContent = agent.title;
  el.tooltip.appendChild(title);

  // The MK tag always identifies the session; the name — the user's, or the
  // one the daemon gave on first sight (WP-20) — is what actually replaced it
  // on the floor, so both belong here. Then, for the minority of agents that
  // have one, the rarity word: one quiet adjective, never a number and never
  // a count of what the user has collected (docs/plan/08 §1.1 rule 6).
  const mk = agent.mk || agent.id;
  const name = agent.displayName || agent.givenName || null;
  const tag = document.createElement('div');
  tag.className = 'tooltip-tag';
  if (name) {
    const b = document.createElement('b');
    b.textContent = name;
    tag.appendChild(b);
    tag.appendChild(document.createTextNode(` · ${mk}`));
  } else {
    tag.textContent = mk;
  }
  const word = rarityWordFor(agent);
  if (word) {
    const rare = document.createElement('span');
    rare.className = 'tooltip-rarity';
    rare.dataset.tier = word;
    rare.textContent = word;
    // A real space, not only the CSS margin: a screen reader reads the text,
    // and "MK2.2rare" is one word to it.
    tag.append(' ', rare);
  }
  el.tooltip.appendChild(tag);

  el.tooltip.appendChild(
    tooltipLine(
      [agent.projectName, agent.model || 'unknown model', agent.gitBranch]
        .filter(Boolean)
        .join(' · '),
    ),
  );

  const elapsedMs =
    Date.now() - (agent.reviewSince ?? agent.needsInputSince ?? agent.lastActivityAt ?? Date.now());
  const elapsedMin = Math.max(0, Math.round(elapsedMs / 60000));
  el.tooltip.appendChild(
    tooltipLine(
      `${STATE_LABELS[agent.activityState] || agent.activityState} · ` +
        `${formatNumber(agent.tokens)} tokens · ${elapsedMin}m`,
    ),
  );

  // WP-46's grace note: the team's record, when this session or this room
  // holds one. Last, and in the same position the panel puts it in — a record
  // is context, never a call to action, and it never scores the reader
  // (`docs/plan/08` §1.1 rule 6, asserted in `records.test.mjs`).
  //
  // The stats body comes from the panel's own five-minute cache rather than a
  // second fetch, so the card and the panel cannot disagree about a record
  // while both are on screen. It is `null` until the first one resolves and
  // `recordLineFor` reads that as "no line", so a hover never waits on the
  // network. `docs/DEVIATIONS.md` §107 asked for exactly this.
  const record = recordLineFor(agent, panel.teamRecords());
  if (record) el.tooltip.appendChild(tooltipLine(record));

  el.tooltip.hidden = false;
  placeNearCursor(el.tooltip, 320);
}

/**
 * Where the cursor is, from `app.js`'s own `mousemove` listener on the canvas.
 * @param {number} x
 * @param {number} y
 */
export function noteMouse(x, y) {
  lastMouse = { x, y };
}

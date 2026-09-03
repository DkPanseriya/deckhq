/**
 * Furniture is a verb: the shelf opens the project's folder, the screen runs
 * its dashboard, and the whiteboard shows what the room is spending.
 *
 * Split out of `app.js` by WP-22. The client sends only a project id and an
 * action id — what that resolves to is decided by the daemon from the
 * project's own directory, so a page can never hand the daemon a command to
 * run. That rule is why these three live together.
 */

import { boardCostParts } from './panel.js';
import { STATE_LABELS, el, formatNumber, latestSnapshot, toast } from './app-state.js';

//
// ------------------------------------------------------- floor launchers
//
// Furniture is a verb. The shelf opens the project's folder; the screen runs
// its dashboard. The client sends only a project id and an action id — what
// that resolves to is decided by the daemon from the project's own directory,
// so a page can never hand the daemon a command to run.

/** @param {string} projectId */
export async function revealProjectFolder(projectId) {
  try {
    const res = await fetch('/api/reveal', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ projectId }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
    toast('Opened ' + body.cwd);
  } catch (err) {
    toast('Could not open that folder: ' + err.message, { isError: true });
  }
}

/** @param {string} projectId */
export async function runProjectDashboard(projectId) {
  try {
    const res = await fetch('/api/run', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ projectId, actionId: 'dashboard' }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
    toast(body.ran ? body.ran : 'Started the dashboard');
  } catch (err) {
    toast('Could not run that: ' + err.message, { isError: true });
  }
}

// The floor's whiteboard prop reports { kind: 'whiteboard', id: projectId }
// through Scene's onHover/onSelect (CONTRACTS-WP15.md §4). This is purely a
// read of the current snapshot — never a fetch, never anything that could
// touch ackState (THE INVARIANT, docs/01-PRODUCT.md §2).

/** @param {string|null} projectId */
/**
 * The project board: the whiteboard on a project room's wall, opened.
 *
 * The floor answers "is anything waiting on me". This answers "what is this
 * project actually doing" — the numbers a team keeps written up where everyone
 * can see them, and the one place in the product that changes plane from
 * looking down at a room to standing in front of the thing on its wall.
 *
 * @param {string} projectId
 */
/**
 * Token counts as a board would have them written: `2.4M`, `840k`, `500`.
 * @param {number} n
 */
export function compactTokens(n) {
  const v = Number(n) || 0;
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `${Math.round(v / 1000)}k`;
  return String(Math.round(v));
}

export function showWhiteboard(projectId) {
  if (!projectId || !latestSnapshot) {
    hideWhiteboard();
    return;
  }
  const project = latestSnapshot.projects?.find((p) => p.id === projectId);
  if (!project) {
    hideWhiteboard();
    return;
  }

  const all = (latestSnapshot.agents || []).filter((a) => a.projectId === projectId);
  const count = (fn) => all.filter(fn).length;
  const stats = {
    total: all.length,
    working: count((a) => a.ackState === 'active' && a.activityState === 'working'),
    // The two "needs you" signals are deliberately separate on the floor
    // (a raised hand at a desk vs somebody standing in your office), so they
    // stay separate here.
    handsUp: count(
      (a) =>
        a.ackState === 'active' &&
        (a.activityState === 'needs_input' || a.activityState === 'stalled'),
    ),
    inOffice: count((a) => a.ackState === 'active' && a.activityState === 'for_review'),
    ended: count((a) => a.ackState === 'active' && a.activityState === 'ended'),
    benched: count((a) => a.ackState === 'benched'),
    archived: count((a) => a.ackState === 'let_go'),
  };
  const onFloor = all.filter((a) => a.ackState !== 'let_go');
  const tokens = onFloor.reduce((a, x) => a + (x.tokens || 0), 0);
  const cache = onFloor.reduce((a, x) => a + (x.cacheTokens || 0), 0);
  // `costEstimate` is `number|null`, and null means "the rate card has no row
  // for this model" (WP-26). Summing it with `|| 0` turned a room nobody can
  // price into a confident `$0.00` — a claim about the money that nothing in
  // the product had made. A room with no priceable session at all sums to
  // null and says "no rate"; one with some says what it can price, which is
  // the same rule `projects()` keeps with `costRated`.
  const rated = onFloor.some((a) => a.costEstimate != null && Number.isFinite(a.costEstimate));
  const cost = rated ? onFloor.reduce((a, x) => a + (x.costEstimate ?? 0), 0) : null;
  const money = boardCostParts(cost, latestSnapshot.rateCardVersion);
  const models = [...new Set(onFloor.map((a) => a.model).filter(Boolean))];

  const board = document.createElement('div');
  board.className = 'whiteboard-board';

  const head = document.createElement('div');
  head.className = 'whiteboard-head';
  const title = document.createElement('div');
  title.className = 'whiteboard-title';
  title.textContent = project.name;
  const sub = document.createElement('div');
  sub.className = 'whiteboard-sub';
  sub.textContent = [project.mk, models.join(', ')].filter(Boolean).join(' · ');
  head.append(title, sub);
  board.appendChild(head);

  const tiles = document.createElement('div');
  tiles.className = 'whiteboard-tiles';
  /** @param {string} label @param {string|number} value @param {string} [tone] */
  const tile = (label, value, tone) => {
    const el2 = document.createElement('div');
    el2.className = 'whiteboard-tile';
    if (tone) el2.dataset.tone = tone;
    const b = document.createElement('b');
    b.textContent = String(value);
    const span = document.createElement('span');
    span.textContent = label;
    el2.append(b, span);
    tiles.appendChild(el2);
  };
  tile('Sessions', stats.total);
  tile('Working', stats.working, 'working');
  tile('Hands up', stats.handsUp, stats.handsUp ? 'needs' : undefined);
  tile('In your office', stats.inOffice, stats.inOffice ? 'needs' : undefined);
  tile('Benched', stats.benched);
  tile('Finished', stats.ended);
  if (stats.archived) tile('Archived', stats.archived);
  // Compact on the tiles: a nine-digit cache figure does not fit one, and the
  // exact number is not what a board is for. The per-session rows below carry
  // the full figures.
  tile('Tokens', compactTokens(tokens));
  tile('Cache tokens', compactTokens(cache));
  tile('Est. cost', money.tile);
  board.appendChild(tiles);

  const heading = document.createElement('p');
  heading.className = 'whiteboard-section';
  heading.textContent = `Per session · ${onFloor.length} on the floor`;
  board.appendChild(heading);

  const sessions = [...onFloor].sort((a, b) => (b.tokens || 0) - (a.tokens || 0));
  for (const a of sessions) {
    const row = document.createElement('div');
    row.className = 'whiteboard-row';
    const left = document.createElement('span');
    left.textContent = a.label || a.mk || a.title || a.id;
    const state = document.createElement('em');
    state.textContent = ` ${STATE_LABELS[a.ackState === 'active' ? a.activityState : a.ackState] || ''}`;
    left.appendChild(state);
    const right = document.createElement('span');
    right.textContent = `${formatNumber(a.tokens || 0)} tok`;
    row.append(left, right);
    board.appendChild(row);
  }
  if (sessions.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'whiteboard-row';
    empty.textContent = 'No sessions on the floor';
    board.appendChild(empty);
  }

  const total = document.createElement('div');
  total.className = 'whiteboard-total';
  const totalLabel = document.createElement('span');
  totalLabel.textContent = 'Project total';
  const totalValue = document.createElement('span');
  totalValue.textContent = `${formatNumber(tokens)} tok · ${money.total}`;
  total.append(totalLabel, totalValue);
  board.appendChild(total);

  const hint = document.createElement('p');
  hint.className = 'whiteboard-hint';
  // The board's figures are only checkable if the table they came from is
  // named on the board. `rateCardVersion` rides in on every snapshot for
  // exactly this, so no surface has to fetch `/api/about` for a string.
  hint.textContent = money.note;
  board.appendChild(hint);

  el.whiteboardOverlay.textContent = '';
  el.whiteboardOverlay.appendChild(board);
  el.whiteboardOverlay.hidden = false;
}

export function hideWhiteboard() {
  el.whiteboardOverlay.hidden = true;
}

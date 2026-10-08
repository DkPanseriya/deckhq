/**
 * "Go to session" — the one button at the top of the card (WP-100).
 *
 * The owner, 8 October: _"maybe just with a button, wherever that session is
 * running — a separate terminal, the Claude Code app, anything — can we open
 * that particular session, so one click and you are back to your working
 * window."_
 *
 * One button, and the daemon decides what it is. A session that is running is
 * GONE TO — the window it is already in is brought forward — and is never
 * started a second time. A session whose process has ended is resumed, in the
 * place chosen in settings, and the label says which of the two a click will
 * do: `Go to session`, or `Resume in Windows Terminal`. Where a running
 * session cannot be reached the button is dead and the line under it says
 * why; it does not turn into Resume, because a second copy of a live session
 * is exactly what this is here to prevent.
 *
 * `loadGoto()` is a GET and moves nothing. `goToSession()` is the only thing
 * that posts, and it is reached only from this button's click, the `O` key and
 * the palette row — never from open(), refresh() or a render.
 *
 * INVARIANT (docs/01-PRODUCT.md §2): being taken to a session says nothing
 * about whether you are done with it. Nothing in this file acknowledges
 * anything, and `test/unit/panel-invariant.test.mjs` reads every client file
 * to check that the one ack route is reached from one place.
 */

import { currentId, displayedAgent } from './panel-state.js';

/** @typedef {ReturnType<typeof import('./panel-dom.js').buildPanelDom>} PanelDom */

/**
 * What the button shows before the daemon has answered, and whenever it
 * cannot be asked. Pure, and the only rule this file owns: a session the
 * floor draws as live is assumed to be reachable until told otherwise, so the
 * label does not flip from Resume to Go a moment after the card opens.
 * @param {{live?:boolean, subagent?:boolean}|null} agent
 * @returns {{label:string, pending:boolean}}
 */
export function provisionalLabel(agent) {
  if (agent && agent.subagent === true) return { label: 'Go to its lead’s session', pending: true };
  return { label: agent && agent.live ? 'Go to session' : 'Resume', pending: true };
}

/**
 * @param {PanelDom & {getSnapshot: () => any,
 *          toast: (m:string, o?:{isError?:boolean}) => void,
 *          announce: (text:string) => void}} ctx
 */
export function createGotoPart(ctx) {
  const { getSnapshot, toast, announce, gotoRow, gotoBtn, gotoDetail } = ctx;
  let token = 0; // guards against a slow answer landing on a newer card
  /** @type {any} */
  let plan = null;
  /** @type {string|null} */
  let planFor = null;
  /** Whether the session was live when the plan was asked for. */
  let planLive = false;
  let busy = false;

  function renderGoto() {
    const agent = displayedAgent;
    // An actor on the empty-machine floor (WP-13) is nobody's session.
    if (!agent || getSnapshot()?.demo) {
      gotoRow.hidden = true;
      return;
    }
    const known = planFor === agent.id ? plan : null;
    if (known && known.action === 'none') {
      gotoRow.hidden = true;
      return;
    }
    gotoRow.hidden = false;
    const label = known ? known.label : provisionalLabel(agent).label;
    gotoBtn.textContent = label;
    gotoBtn.disabled = busy || Boolean(known && known.disabled);
    gotoBtn.setAttribute('aria-keyshortcuts', 'O');
    gotoBtn.dataset.action = known ? known.action : 'pending';
    const detail = known ? String(known.detail || '') : '';
    gotoDetail.textContent = detail;
    gotoDetail.hidden = !detail;
    gotoDetail.classList.toggle('is-warn', Boolean(known && known.disabled));
    // The reason is the tooltip too, so a dead button answers a hover.
    gotoBtn.title = known && known.disabled ? detail : `${label} (O)`;
  }

  /**
   * Ask the daemon what the button would do. A GET; it reads the process
   * table and no window moves. Decorative on failure: the provisional label
   * stays and a click still asks the daemon properly.
   * @param {string} id
   */
  async function loadGoto(id) {
    const mine = ++token;
    if (planFor !== id) {
      plan = null;
      planFor = id;
    }
    planLive = Boolean(displayedAgent?.live);
    renderGoto();
    if (getSnapshot()?.demo) return;
    try {
      const res = await fetch(`/api/session-target?id=${encodeURIComponent(id)}`);
      const body = await res.json().catch(() => ({}));
      if (mine !== token) return;
      plan = res.ok ? body : null;
    } catch {
      if (mine !== token) return;
      plan = null;
    }
    if (currentId === id) renderGoto();
  }

  /**
   * Called on every snapshot. The plan is about a moment: when the session
   * the card shows starts or stops running, what the button does has changed,
   * so it is asked again. Otherwise this is a repaint.
   */
  function refreshGoto() {
    const agent = displayedAgent;
    if (!agent || !currentId) return;
    if (planFor === currentId && Boolean(agent.live) !== planLive) loadGoto(currentId);
    else renderGoto();
  }

  /**
   * Do it. An explicit click, key or palette row and nothing else.
   * @param {string|null} [targetId] the deck's cursor row; the card's own
   *   session when absent
   */
  async function goToSession(targetId) {
    const id = targetId || currentId;
    if (!id || busy) return;
    busy = true;
    renderGoto();
    try {
      const res = await fetch('/api/go', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
      const message = String(body.message || 'Done');
      // A window Windows declined to raise is not a failure, but it is not
      // "done" either: it is said, and said as loudly as an error would be.
      toast(message, { isError: body.did === 'focus' && body.foreground === false });
      announce(message);
    } catch (err) {
      toast(`Could not go to that session: ${err.message}`, { isError: true });
    } finally {
      busy = false;
      // What happened may have changed what the button does next — a resumed
      // session is about to be running.
      if (currentId) loadGoto(currentId);
    }
  }

  gotoBtn.addEventListener('click', () => goToSession());

  return { loadGoto, refreshGoto, renderGoto, goToSession };
}

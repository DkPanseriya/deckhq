/**
 * The weighted actions, the ⋯ menu, and the number keys (WP-22 follow-up).
 *
 * ============================================================================
 * THE INVARIANT (docs/01-PRODUCT.md §2). `performAction()` below is the ONLY
 * code in the whole browser client that calls POST /api/ack. It is invoked
 * exclusively from an explicit click on a button built in `renderActions()`,
 * from the `3` number key via `pressNumberKey()`, and from app.js's explicit
 * A/B shortcuts and command-palette entry. It is never called from open(),
 * refresh(), any render*(), any load*(), or any scroll/hover/input listener.
 * `test/unit/panel-invariant.test.mjs` reads this file and says so.
 * ============================================================================
 *
 * `2 Approve` is a SEND, not an ack: it posts the configurable affirmative
 * through /api/send exactly as typing it would.
 */

import {
  ACTION_LABELS,
  DEFAULT_APPROVE_TEXT,
  DEMO_REFUSAL,
  legalActions,
  optimisticPatch,
  thirdAction,
} from './panel-rules.js';
import { who } from './panel-format.js';
import { currentId, displayedAgent, setDisplayedAgent } from './panel-state.js';
import { textNode } from './panel-dom.js';

/** @typedef {ReturnType<typeof import('./panel-dom.js').buildPanelDom>} PanelDom */

/**
 * @param {PanelDom & {root: HTMLElement,
 *          getSnapshot: () => any,
 *          toast: (m:string, o?:{isError?:boolean}) => void,
 *          announce: (t:string) => void,
 *          onNewAgent?: (projectId:string) => void,
 *          onRename?: (agent:any) => void}} ctx
 */
export function createActionsPart(ctx) {
  const {
    root,
    getSnapshot,
    toast,
    announce,
    onNewAgent,
    onRename,
    actionsWrap,
    actionsEl,
    moreMenu,
    form,
    textarea,
  } = ctx;
  /** Late-bound siblings, wired by panel.js once every part exists
   * (docs/DEVIATIONS.md §122, rule 3). */
  let pendingPermission, renderChrome, sendText, open;

  /**
   * The weighted actions. `2 Approve` is the one filled button on the
   * screen; `1 Reply` only moves focus; the third slot is the ack action
   * that moves this agent (bench / recall / rehire). The rest live behind ⋯.
   * @param {any} a
   */
  function renderActions(a) {
    actionsEl.textContent = '';
    moreMenu.textContent = '';
    setMoreOpen(false);

    // WP-41. A junior gets no action row and no composer at all.
    //
    // Not only the ack half: none of these three does anything for a
    // subagent. `3 Bench` writes an `ackState` the daemon refuses outright
    // (`Registry.act()`), and `1 Reply` / `2 Approve` / Send would post to
    // `claude --resume <agentId>`, which is not a session id — a junior's
    // work comes from its parent and its answer goes back to its parent.
    // Offering buttons that cannot work is worse than offering none, so the
    // panel shows what the junior is and what it said, and stops there.
    // `Registry.act()` refuses these independently: this is the interface
    // agreeing with the daemon, not the only thing holding the line.
    if (a && a.subagent === true) {
      actionsWrap.hidden = true;
      form.hidden = true;
      return;
    }
    actionsWrap.hidden = false;
    form.hidden = false;

    actionsEl.appendChild(weightedButton('1', 'Reply', 'btn', () => focusComposer()));
    // `2 Approve` is normally the one filled button on the screen (`05` §4.2).
    // It yields the fill while a permission card is up: that card is the only
    // thing on this panel with a socket and a deadline behind it, and two
    // accent-filled buttons is exactly the "which one is the action?" problem
    // the single-fill rule exists to prevent. It keeps its key and its place.
    const approveClass = pendingPermission() ? 'btn' : 'btn btn--primary';
    const approveBtn = weightedButton('2', 'Approve', approveClass, () => approve());
    approveBtn.title = `Sends “${approveText()}”`;
    actionsEl.appendChild(approveBtn);
    const third = thirdAction(a);
    // The only wiring for /api/ack in the weighted row: an explicit click on
    // a button that is only ever shown when the action is legal.
    actionsEl.appendChild(
      weightedButton('3', ACTION_LABELS[third], 'btn', () => performAction(third)),
    );

    const spacer = document.createElement('span');
    spacer.className = 'panel-actions-spacer';
    actionsEl.appendChild(spacer);

    const moreBtn = document.createElement('button');
    moreBtn.type = 'button';
    moreBtn.className = 'btn btn--quiet panel-more-btn';
    moreBtn.textContent = '⋯ more';
    moreBtn.setAttribute('aria-expanded', 'false');
    moreBtn.setAttribute('aria-haspopup', 'true');
    // `HTMLElement.hidden` is `boolean | 'until-found'` in the DOM types; this
    // one is only ever assigned a boolean, four lines above and in `setMoreOpen`.
    moreBtn.addEventListener('click', () => setMoreOpen(/** @type {boolean} */ (moreMenu.hidden)));
    actionsEl.appendChild(moreBtn);

    // Everything else, as plain buttons. Each ack action here is still an
    // explicit click and still funnels through performAction().
    for (const action of legalActions(a)) {
      if (action === third) continue;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = action === 'let_go' ? 'btn btn--danger' : 'btn';
      btn.textContent = ACTION_LABELS[action];
      btn.addEventListener('click', () => performAction(action));
      moreMenu.appendChild(btn);
    }
    const renameItem = document.createElement('button');
    renameItem.type = 'button';
    renameItem.className = 'btn';
    renameItem.textContent = 'Rename';
    renameItem.addEventListener('click', () => {
      setMoreOpen(false);
      if (displayedAgent) onRename?.(displayedAgent);
    });
    moreMenu.appendChild(renameItem);
    // WP15 task C.2: creating a sibling session is not a review action, so it
    // is wired through onNewAgent, never through performAction()/ack.
    const newAgentBtn = document.createElement('button');
    newAgentBtn.type = 'button';
    newAgentBtn.className = 'btn';
    newAgentBtn.textContent = '+ New agent';
    newAgentBtn.addEventListener('click', () => {
      setMoreOpen(false);
      onNewAgent?.(a.projectId);
    });
    moreMenu.appendChild(newAgentBtn);
  }

  /**
   * @param {string} key the number the button answers to
   * @param {string} label
   * @param {string} className
   * @param {() => void} onClick
   */
  function weightedButton(key, label, className, onClick) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `${className} btn--weighted`;
    const kbd = document.createElement('kbd');
    kbd.textContent = key;
    btn.append(kbd, textNode(label));
    btn.setAttribute('aria-keyshortcuts', key);
    btn.addEventListener('click', onClick);
    return btn;
  }

  /** @param {boolean} open */
  /** @param {boolean} open */
  function setMoreOpen(open) {
    moreMenu.hidden = !open;
    const btn = actionsEl.querySelector('.panel-more-btn');
    if (btn) btn.setAttribute('aria-expanded', String(open));
  }

  // ------------------------------------------------------------- actions

  /**
   * The agent a targeted key or action is about. The panel's own displayed
   * copy when it is that one (so an optimistic patch is honoured), otherwise
   * the authoritative row from the latest snapshot. WP-10's deck acts on the
   * row under its cursor, which is very often not the row the panel is on.
   * @param {string|null|undefined} id
   */
  function agentFor(id) {
    if (!id || id === currentId) return displayedAgent;
    return getSnapshot()?.agents?.find((a) => a.id === id) || null;
  }

  /**
   * The single funnel for the six user-owned actions (docs/02-ARCHITECTURE
   * §5.1). This is the ONLY function in the client that calls POST
   * /api/ack. It is invoked exclusively from:
   *   - an explicit click on a button built in renderActions() above,
   *   - the `3` number key, via pressNumberKey() below, or
   *   - app.js's keydown handler for the explicit 'A'/'B' shortcuts, which
   *     since WP-10 may name the deck's cursor row instead of the open one.
   * It is never called from open(), refresh(), or any rendering/selection
   * path. Optimistic update with rollback on failure, per WP9.
   *
   * `targetId` acts on a row the panel is not showing — the deck's `3` key
   * clears an item without opening it (docs/plan/05-GUI-UX-SPEC.md §3.2).
   * There is still exactly one request here, and it still only happens
   * because somebody pressed something.
   * @param {string} action
   * @param {string|null} [targetId]
   */
  async function performAction(action, targetId) {
    const id = targetId || currentId;
    const agent = agentFor(id);
    if (!id || !agent) return;
    if (!legalActions(agent).includes(action)) return;
    // The actors on an empty machine's floor (WP-13) are not sessions and are
    // not in the registry, so every one of these would come back "No such
    // agent". Say the true and useful thing instead. This holds for a deck
    // row as much as for the panel's own: the whole floor is actors.
    if (getSnapshot()?.demo) return toast(DEMO_REFUSAL);

    // Only the panel's own row has anything to patch optimistically; a deck
    // row's feedback is the next snapshot, which is 250 ms away.
    const inPanel = id === currentId && Boolean(displayedAgent);
    const rollback = displayedAgent;
    if (inPanel) {
      setDisplayedAgent(optimisticPatch(displayedAgent, action));
      renderChrome();
    }

    try {
      const res = await fetch('/api/ack', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id, action }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
      // A control says what happens (docs/plan/05 §11): the toast names the
      // outcome, in the panel's compact voice (display name, else MK tag).
      const name = who(inPanel ? displayedAgent : agent);
      toast(
        action === 'bench'
          ? `Benched. ${name} is in the lounge.`
          : action === 'recall'
            ? `Recalled. ${name} is back on the floor.`
            : `${ACTION_LABELS[action]} — done`,
      );
      announce(`${name}: ${ACTION_LABELS[action].toLowerCase()}`);
    } catch (err) {
      if (inPanel) {
        setDisplayedAgent(rollback);
        renderChrome();
      }
      toast(`Could not ${ACTION_LABELS[action].toLowerCase()}: ${err.message}`, { isError: true });
    }
  }

  function approveText() {
    const s = getSnapshot()?.settings?.approveText;
    return typeof s === 'string' && s.trim() ? s.trim() : DEFAULT_APPROVE_TEXT;
  }

  /**
   * `2 Approve`: send the configurable affirmative, exactly as if it had been
   * typed. A send, not an ack — see the module note. `id` is WP-10's deck
   * row, which need not be the row the panel is showing.
   * @param {string|null} [id]
   */
  function approve(id) {
    return sendText(approveText(), { approve: true, id });
  }

  /**
   * The number keys, 1/2/3, from app.js's keydown handler — which already
   * stays inert while focus is in the composer or any text control. `1` only
   * moves focus, `2` is a send, and `3` is the one that reaches
   * performAction(), as an explicit keystroke equivalent to its button.
   *
   * `targetId` is WP-10's deck and queue strip: the same three keys, on the
   * row under the cursor, without opening it first. `1` is the exception and
   * has to open — a reply needs somewhere to type, and the composer is in the
   * panel.
   * @param {string} key
   * @param {string|null} [targetId]
   */
  function pressNumberKey(key, targetId) {
    const id = targetId || currentId;
    const agent = agentFor(id);
    if (!id || !agent) return;
    if (!targetId && root.hidden) return;
    // WP-41: the keys are the buttons. A junior has none of the three (see
    // `renderActions`), so the shortcuts must not reach around the missing
    // row and do by keystroke what the interface declined to offer.
    if (agent.subagent === true) return;
    switch (String(key)) {
      case '1':
        if (id !== currentId) open(id);
        focusComposer();
        break;
      case '2':
        approve(id);
        break;
      case '3':
        performAction(thirdAction(agent), id);
        break;
      default:
        break;
    }
  }

  function focusComposer() {
    textarea.focus();
    textarea.setSelectionRange(textarea.value.length, textarea.value.length);
  }

  return {
    renderActions,
    setMoreOpen,
    agentFor,
    performAction,
    pressNumberKey,
    focusComposer,
    approve,
    wire: (o) => {
      ({ pendingPermission, renderChrome, sendText, open } = o);
    },
  };
}

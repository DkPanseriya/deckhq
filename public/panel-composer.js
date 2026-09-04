/**
 * The composer, and the one send path under it (WP-22 follow-up).
 *
 * Split out of `createPanel()` unchanged. WP-09: `POST /api/send` answers
 * 202 as soon as the daemon has the turn, so the box is held for a round trip
 * rather than for the whole reply. Passive with respect to ack state — this
 * reaches /api/send and nothing else, and `2 Approve` is a send, never an
 * ack (docs/01-PRODUCT.md §2).
 */

import { drafts } from './drafts.js';
import { DEMO_REFUSAL } from './panel-rules.js';
import { who } from './panel-format.js';
import { currentId } from './panel-state.js';
import { setStreaming } from './panel-live.js';

/** @typedef {ReturnType<typeof import('./panel-dom.js').buildPanelDom>} PanelDom */

/**
 * @param {PanelDom & {root: HTMLElement,
 *          getSnapshot: () => any,
 *          toast: (m:string, o?:{isError?:boolean}) => void,
 *          announce: (t:string) => void,
 *          onDraftChange?: (id:string, hasDraft:boolean) => void}} ctx
 */
export function createComposerPart(ctx) {
  const {
    root,
    getSnapshot,
    toast,
    announce,
    onDraftChange,
    actionsEl,
    form,
    textarea,
    hintEl,
    sendBtn,
  } = ctx;
  let sending = false;
  /** Late-bound siblings, wired by panel.js (docs/DEVIATIONS.md §122, rule 3). */
  let renderDraftChip, agentFor, beginLive;

  /** @param {boolean} busy @param {string} [label] */
  function setComposerBusy(busy, label) {
    textarea.disabled = busy;
    sendBtn.disabled = busy;
    for (const b of /** @type {NodeListOf<HTMLButtonElement>} */ (
      actionsEl.querySelectorAll('.btn--weighted')
    ))
      b.disabled = busy;
    hintEl.textContent = busy ? label || 'Sending…' : '';
    hintEl.classList.remove('is-warn');
  }

  /**
   * One send path for the composer and for `2 Approve`.
   *
   * WP-09. `POST /api/send` answers **202** as soon as the daemon has the
   * turn, so the composer is held only for as long as that round trip takes
   * — not for the whole turn, which is up to ten minutes and which the user
   * used to spend looking at a disabled box reading "Sending…". The reply
   * itself arrives afterwards on the panel's SSE connection and fills the
   * live region under WHAT IT SAID (`onSendEvent` below).
   *
   * On failure the composer's own text is restored so nothing is lost —
   * whether the failure is the request itself or a `send` event that arrives
   * seconds later saying the runtime refused. An approval that fails simply
   * reports it.
   *
   * `o.id` sends to a row the panel is not showing — WP-10's `2 Approve`
   * from the deck. The composer belongs to the open row, so it is neither
   * cleared nor held busy in that case; the toast is the feedback.
   *
   * Passive with respect to ack state, like everything else here: this
   * reaches /api/send and nothing else. `2 Approve` is a send, never an ack.
   * @param {string} text
   * @param {{approve?: boolean, id?: string|null}} [o]
   */
  async function sendText(text, o = {}) {
    if (sending) return;
    const id = o.id || currentId;
    const agent = agentFor(id);
    if (!id || !agent) return;
    if (!text.trim()) return;
    if (getSnapshot()?.demo) return toast(DEMO_REFUSAL);
    const inPanel = id === currentId && !root.hidden;

    // Mid-turn means actively producing output. A finished turn standing for
    // review, or a hand up waiting for an answer, is exactly when a reply is
    // wanted — no second keystroke there.
    if (agent.live && agent.activityState === 'working') {
      const proceed = window.confirm(
        'This session is currently live and may be mid-turn. Send anyway?',
      );
      if (!proceed) return;
    }

    const fromComposer = !o.approve;
    sending = true;
    if (inPanel) setComposerBusy(true, o.approve ? `Sending “${text}”…` : 'Sending…');
    if (fromComposer) {
      textarea.value = '';
      drafts.clear(id);
      renderDraftChip();
      onDraftChange?.(id, false);
    }

    try {
      const res = await fetch('/api/send', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id, text }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
      toast(o.approve ? `Approved — sent “${text}” to ${who(agent)}` : 'Message sent');
      if (o.approve) announce(`${who(agent)}: approved`);
      // The turn is accepted, not finished. Hold on to what was sent so the
      // stream's own failure can still put it back, and start the live row.
      if (body.sendId) {
        setStreaming({ sendId: String(body.sendId), id, text, fromComposer });
        if (currentId === id) beginLive();
      }
    } catch (err) {
      restoreComposer(id, text, fromComposer);
      if (inPanel) {
        hintEl.textContent = `Could not send: ${err.message}`;
        hintEl.classList.add('is-warn');
      }
      toast(`Could not send: ${err.message}`, { isError: true });
    } finally {
      // The composer comes back the moment the turn is ACCEPTED. This is the
      // whole point of the package.
      sending = false;
      if (inPanel) setComposerBusy(false);
      if (hintEl.textContent === '' && !sending) hintEl.classList.remove('is-warn');
    }
  }

  /**
   * Put a failed send's text back where the user typed it. Only for the
   * composer's own sends: `2 Approve` never took anything out of the box, so
   * it has nothing to give back.
   * @param {string} id
   * @param {string} text
   * @param {boolean} fromComposer
   */
  function restoreComposer(id, text, fromComposer) {
    if (!fromComposer || currentId !== id) return;
    // Never overwrite something typed since. The reply that failed is the
    // one being restored; a newer draft is the user's more recent intent.
    if (textarea.value.trim()) return;
    textarea.value = text;
    drafts.save(id, text);
    renderDraftChip();
    onDraftChange?.(id, true);
  }

  // The composer's own two listeners, on elements of their own.
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    sendText(textarea.value);
  });

  // Every keystroke in the composer is a draft. Saving is local and cheap;
  // the chip and the client-state flag follow it.
  textarea.addEventListener('input', () => {
    const id = currentId;
    if (!id) return;
    const had = drafts.has(id);
    drafts.save(id, textarea.value);
    const has = drafts.has(id);
    renderDraftChip();
    if (had !== has) onDraftChange?.(id, has);
  });

  return {
    sendText,
    restoreComposer,
    setComposerBusy,
    wire: (o) => {
      ({ renderDraftChip, agentFor, beginLive } = o);
    },
  };
}

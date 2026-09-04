/**
 * WP-09's live region, and the panel's own SSE connection (WP-22 follow-up).
 *
 * Split out of `createPanel()` unchanged. Everything written to the DOM here
 * is `textContent`: deltas are the model's own prose arriving a fragment at a
 * time, so there is no complete markdown document to parse — half a fenced
 * block is not a fenced block — and building DOM from a partial string is
 * exactly the pass docs/plan/05-GUI-UX-SPEC.md §4.2 forbids. The finished turn
 * is re-rendered as markdown by `loadConversation()`.
 *
 * The connection is a second one to the SAME endpoint app.js already uses,
 * with `?stream=send`. That filter is why it is affordable.
 */

import { who } from './panel-format.js';
import { currentId, displayedAgent } from './panel-state.js';

/**
 * WP-09 · the turn currently streaming into the live region, if any.
 * `{sendId, id, text, fromComposer}` — `text` is what was sent, kept so a
 * failure can put it back in the composer where the user left it.
 * @type {{sendId:string, id:string, text:string, fromComposer:boolean}|null}
 */
export let streaming = null;
/** @param {{sendId:string, id:string, text:string, fromComposer:boolean}|null} v */
export const setStreaming = (v) => {
  streaming = v;
};

/** @typedef {ReturnType<typeof import('./panel-dom.js').buildPanelDom>} PanelDom */

/**
 * @param {PanelDom & {root: HTMLElement,
 *          toast: (m:string, o?:{isError?:boolean}) => void}} ctx
 */
export function createLivePart(ctx) {
  const { root, toast, liveSection, liveRow, liveWho, liveBody, liveTools, hintEl } = ctx;
  /** The panel's own SSE connection (send progress + transcript tail). */
  let liveSource = null;
  /** Which agent id `liveSource` is watching, so it is not reopened per render. */
  let liveWatching = null;
  let liveBackoff = 1000;
  let liveRetryTimer = null;
  /** Coalesces transcript pings into at most one re-read (WP-09). */
  let tailTimer = null;
  /** Late-bound siblings, wired by panel.js (docs/DEVIATIONS.md §122, rule 3). */
  let loadConversation, restoreComposer;

  // ------------------------------------------------------------- streaming

  /** Show the live row, empty, with the typing state on it. */
  function beginLive() {
    liveBody.textContent = '';
    liveTools.textContent = '';
    liveTools.hidden = true;
    liveWho.textContent = displayedAgent ? who(displayedAgent) : 'Agent';
    liveRow.classList.add('is-typing');
    liveSection.hidden = false;
  }

  /** Take the live row down. */
  function endLive() {
    liveRow.classList.remove('is-typing');
    liveSection.hidden = true;
    liveBody.textContent = '';
    liveTools.textContent = '';
    liveTools.hidden = true;
  }

  /**
   * One `send` event off the SSE channel. Everything it writes to the DOM is
   * `textContent`; see the live region's own note for why the streamed half
   * of a reply is deliberately not put through the markdown renderer.
   * @param {any} event
   */
  function onSendEvent(event) {
    if (!streaming || !event || event.sendId !== streaming.sendId) return;
    const id = streaming.id;
    switch (event.type) {
      case 'accepted':
      case 'status':
        return;
      case 'delta':
        if (typeof event.text === 'string') liveBody.textContent += event.text;
        return;
      case 'text':
        // A runtime that gave whole messages rather than fragments. Same
        // region, same rule.
        if (typeof event.text === 'string') {
          liveBody.textContent += (liveBody.textContent ? '\n\n' : '') + event.text;
        }
        return;
      case 'tool':
        if (typeof event.summary === 'string' && event.summary) {
          const line = document.createElement('div');
          line.className = 'review-live-tool';
          line.textContent = event.summary;
          liveTools.appendChild(line);
          liveTools.hidden = false;
        }
        return;
      case 'turn':
        liveBody.textContent += '\n\n';
        return;
      case 'error':
        restoreComposer(id, streaming.text, streaming.fromComposer);
        if (currentId === id && !root.hidden) {
          hintEl.textContent = `Could not send: ${event.error || 'the turn failed'}`;
          hintEl.classList.add('is-warn');
        }
        toast(`Could not send: ${event.error || 'the turn failed'}`, { isError: true });
        return;
      case 'result':
        if (!event.ok) return; // the `error` event above carries the reason
        return;
      case 'done':
        streaming = null;
        endLive();
        // The canonical text, rendered as markdown from the transcript the
        // runtime actually wrote. A passive GET; it touches no ack state.
        if (currentId === id) loadConversation(id);
        return;
      default:
        return;
    }
  }

  /**
   * Re-read the conversation because the transcript moved. Debounced, and
   * suppressed while a turn is streaming — the live region is the truth for
   * those seconds, and `done` re-reads once at the end anyway.
   * @param {string} id
   */
  function onTranscriptChange(id) {
    if (id !== currentId || streaming) return;
    if (tailTimer) clearTimeout(tailTimer);
    tailTimer = setTimeout(() => {
      tailTimer = null;
      // Reading a conversation is passive. THE INVARIANT: no ack call here.
      if (currentId === id) loadConversation(id);
    }, 120);
  }

  /**
   * The panel's own SSE connection: send progress, and the transcript tail
   * for the session on screen.
   *
   * It is a second connection to the SAME endpoint app.js already uses, with
   * `?stream=send`. That filter is why it is affordable: without it the
   * daemon would serialise the whole floor snapshot twice on every scan for a
   * listener that reads neither copy. app.js owns the snapshot connection and
   * is another package's file this one may not edit (WP-57), so the panel
   * opens its own rather than reaching into it.
   * @param {string|null} id
   */
  function watchLive(id) {
    if (id === liveWatching && liveSource) return;
    closeLive();
    liveWatching = id;
    if (!id) return;
    openLive();
  }

  function openLive() {
    if (!liveWatching || typeof EventSource !== 'function') return;
    const url = `/api/events?stream=send&watch=${encodeURIComponent(liveWatching)}`;
    const es = new EventSource(url);
    liveSource = es;
    es.addEventListener('send', (ev) => {
      liveBackoff = 1000;
      try {
        onSendEvent(JSON.parse(/** @type {MessageEvent} */ (ev).data));
      } catch (err) {
        console.debug('[deckhq] malformed send event', err);
      }
    });
    es.addEventListener('transcript', (ev) => {
      liveBackoff = 1000;
      try {
        const data = JSON.parse(/** @type {MessageEvent} */ (ev).data);
        onTranscriptChange(String(data.id || ''));
      } catch (err) {
        console.debug('[deckhq] malformed transcript event', err);
      }
    });
    es.onerror = () => {
      // Quietly, with backoff, exactly like app.js's own connection. A panel
      // that cannot hold this open still works: it just stops being live.
      es.close();
      if (liveSource === es) liveSource = null;
      if (liveRetryTimer) clearTimeout(liveRetryTimer);
      liveRetryTimer = setTimeout(openLive, liveBackoff);
      liveBackoff = Math.min(liveBackoff * 2, 30000);
    };
  }

  function closeLive() {
    if (liveRetryTimer) clearTimeout(liveRetryTimer);
    liveRetryTimer = null;
    liveBackoff = 1000;
    if (tailTimer) clearTimeout(tailTimer);
    tailTimer = null;
    try {
      liveSource?.close();
    } catch (err) {
      console.debug('[deckhq] could not close the live stream', err);
    }
    liveSource = null;
    liveWatching = null;
  }

  return {
    beginLive,
    endLive,
    watchLive,
    closeLive,
    wire: (o) => {
      ({ loadConversation, restoreComposer } = o);
    },
  };
}

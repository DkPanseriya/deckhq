/**
 * WHAT IT SAID, and the thread folded under it (WP-22 follow-up).
 *
 * Split out of `createPanel()` unchanged. `loadConversation()` is a GET and
 * nothing else: reading a conversation is exactly the passive interaction
 * docs/01-PRODUCT.md §2 forbids from clearing `reviewSince`, and
 * `test/unit/panel-invariant.test.mjs` reads this file to check it stays that
 * way. All message text goes through `renderMarkdown`, which builds DOM with
 * `textContent` and never touches `innerHTML`.
 */

import { renderMarkdown } from './markdown.js';
import { displayedAgent } from './panel-state.js';
import { threadSkeleton } from './panel-dom.js';

/**
 * The conversation as loaded, or null until it is.
 * @type {{role:string,text:string,at:number}[]|null}
 */
export let messages = null;
/** @param {{role:string,text:string,at:number}[]|null} v */
export const setMessages = (v) => {
  messages = v;
};

/** @typedef {ReturnType<typeof import('./panel-dom.js').buildPanelDom>} PanelDom */

/**
 * @param {PanelDom & {getSnapshot: () => any}} ctx
 */
export function createSaidPart(ctx) {
  const { getSnapshot, saidEl, threadDetails, threadSummary, threadEl } = ctx;
  let conversationToken = 0; // guards against a slow fetch clobbering a newer one

  /**
   * Fetch and render the real conversation. This is a passive GET — reading
   * it, and the rendering below, must never touch ack state. See the
   * module-level invariant note.
   * @param {string} id
   */
  async function loadConversation(id) {
    const token = ++conversationToken;
    messages = null;
    saidEl.textContent = '';
    saidEl.appendChild(threadSkeleton());
    threadDetails.hidden = true;
    // An actor on the empty-machine floor (WP-13) has no transcript on disk,
    // and the third coach mark says "Click anyone" — so clicking one has to
    // land somewhere sensible rather than on `Unknown runtime "demo"`. Its
    // one line is shown, and the panel says plainly what it is looking at.
    if (getSnapshot()?.demo) {
      messages = [];
      saidEl.textContent = '';
      if (displayedAgent?.lastText) {
        saidEl.appendChild(renderMarkdown(displayedAgent.lastText, document));
      }
      const note = document.createElement('div');
      note.className = 'msg-empty';
      note.textContent = 'An actor. A real session shows its whole conversation here.';
      saidEl.appendChild(note);
      return;
    }
    try {
      const res = await fetch(`/api/conversation?id=${encodeURIComponent(id)}`);
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
      if (token !== conversationToken) return; // a newer open() superseded this fetch
      messages = body.messages || [];
      renderSaid();
      renderThread();
    } catch (err) {
      if (token !== conversationToken) return;
      messages = [];
      saidEl.textContent = '';
      // The scan's own excerpt still tells the reader something while the
      // full conversation is unavailable.
      if (displayedAgent?.lastRole === 'assistant' && displayedAgent.lastText) {
        saidEl.appendChild(renderMarkdown(displayedAgent.lastText, document));
      }
      const msg = document.createElement('div');
      msg.className = 'msg-empty';
      msg.textContent = `Could not load the conversation: ${err.message}`;
      saidEl.appendChild(msg);
      threadDetails.hidden = true;
    }
  }

  /** The last assistant message, rendered as markdown. */
  function renderSaid() {
    saidEl.textContent = '';
    const list = messages || [];
    let last = null;
    for (let i = list.length - 1; i >= 0; i--) {
      if (list[i].role !== 'user') {
        last = list[i];
        break;
      }
    }
    if (!last) {
      const empty = document.createElement('div');
      empty.className = 'msg-empty';
      empty.textContent = list.length ? 'Nothing from the agent yet.' : 'No messages yet.';
      saidEl.appendChild(empty);
      return;
    }
    // Untrusted daemon data → token tree → textContent. Never innerHTML.
    saidEl.appendChild(renderMarkdown(last.text, document));
  }

  /**
   * Everything before the last assistant message, folded under a summary so
   * the card leads with what matters and the history is one click away.
   * Scrolling and expanding this are passive — no ack call here.
   */
  function renderThread() {
    threadEl.textContent = '';
    const list = messages || [];
    let lastIdx = -1;
    for (let i = list.length - 1; i >= 0; i--) {
      if (list[i].role !== 'user') {
        lastIdx = i;
        break;
      }
    }
    const earlier = lastIdx === -1 ? list : list.slice(0, lastIdx);
    if (earlier.length === 0) {
      threadDetails.hidden = true;
      return;
    }
    threadDetails.hidden = false;
    threadDetails.open = false;
    threadSummary.textContent = `earlier in this conversation · ${earlier.length} ${
      earlier.length === 1 ? 'message' : 'messages'
    }`;
    for (const m of earlier) {
      const wrap = document.createElement('div');
      wrap.className = `msg msg--${m.role === 'user' ? 'user' : 'assistant'}`;
      const who = document.createElement('div');
      who.className = 'msg-who';
      who.textContent = m.role === 'user' ? 'You' : 'Agent';
      const body = document.createElement('div');
      body.className = 'msg-body';
      if (m.role === 'user') {
        // What the user typed is shown exactly as typed.
        body.classList.add('msg-body--plain');
        body.textContent = m.text;
      } else {
        body.appendChild(renderMarkdown(m.text, document));
      }
      wrap.append(who, body);
      threadEl.appendChild(wrap);
    }
  }

  return { loadConversation, renderSaid, renderThread };
}

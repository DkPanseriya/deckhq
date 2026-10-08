/**
 * WHAT IT SAID, and the thread folded above it (WP-22 follow-up; WP-100).
 *
 * `loadConversation()` is a GET and nothing else: reading a conversation is
 * exactly the passive interaction docs/01-PRODUCT.md §2 forbids from clearing
 * `reviewSince`, and `test/unit/panel-invariant.test.mjs` reads this file to
 * check it stays that way. All message text goes through `renderMarkdown` or
 * `panel-transcript.js`, which build DOM with `textContent` and never touch
 * `innerHTML`.
 *
 * WP-100 changed three things about how this reads, and nothing about what it
 * may do:
 *
 * - The conversation is asked for WITH what the agent did (`?detail=1`): tool
 *   calls, their results and its reasoning arrive as entries of their own and
 *   are drawn collapsed, one line each.
 * - The latest thing the agent said is the card's first-class content, and
 *   everything before it is folded ABOVE it — the order it happened in — with
 *   a `latest ↓` control that brings the answer back from anywhere in a long
 *   thread.
 * - Three controls inside rendered text are wired here, by one listener on
 *   the scrolling body: `copy` on a code block, a file reference (through the
 *   existing `POST /api/open-in-editor`, which decides whether the path is
 *   inside the session's repository), and "open in the session" (through the
 *   card's own go-to-session button). None of the three reaches `/api/ack`.
 */

import { renderMarkdown } from './markdown.js';
import { currentId, displayedAgent } from './panel-state.js';
import { threadSkeleton } from './panel-dom.js';
import {
  earlierSummary,
  renderAttachments,
  renderEntries,
  splitTranscript,
} from './panel-transcript.js';

/**
 * The conversation as loaded, or null until it is.
 * @type {import('./panel-transcript.js').Entry[]|null}
 */
export let messages = null;
/** @param {import('./panel-transcript.js').Entry[]|null} v */
export const setMessages = (v) => {
  messages = v;
};

/** How many entries one card asks for. A turn is mostly tool calls. */
const DETAIL_LIMIT = 400;

/** @typedef {ReturnType<typeof import('./panel-dom.js').buildPanelDom>} PanelDom */

/**
 * @param {PanelDom & {getSnapshot: () => any,
 *          toast?: (m:string, o?:{isError?:boolean}) => void,
 *          goToSession?: () => void}} ctx
 */
export function createSaidPart(ctx) {
  const {
    getSnapshot,
    body,
    saidSection,
    saidEl,
    sinceEl,
    threadDetails,
    threadSummary,
    threadEl,
    jumpBtn,
  } = ctx;
  const toast = ctx.toast || (() => {});
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
    sinceEl.textContent = '';
    sinceEl.hidden = true;
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
      const res = await fetch(
        `/api/conversation?id=${encodeURIComponent(id)}&detail=1&limit=${DETAIL_LIMIT}`,
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      if (token !== conversationToken) return; // a newer open() superseded this fetch
      messages = data.messages || [];
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

  /** The last thing the agent said, rendered as markdown — and what it has done since. */
  function renderSaid() {
    saidEl.textContent = '';
    sinceEl.textContent = '';
    sinceEl.hidden = true;
    const { latest, earlier, since } = splitTranscript(messages);
    if (!latest) {
      const empty = document.createElement('div');
      empty.className = 'msg-empty';
      empty.textContent = earlier.length ? 'Nothing from the agent yet.' : 'No messages yet.';
      saidEl.appendChild(empty);
      return;
    }
    // Untrusted daemon data → token tree → textContent. Never innerHTML.
    saidEl.appendChild(renderMarkdown(latest.text, document));
    if (latest.images) saidEl.appendChild(renderAttachments(latest.images, document));
    // What has happened AFTER the last thing it said: a turn in progress.
    // Neither the answer nor history, so it is neither promoted nor folded.
    if (since.length) {
      const label = document.createElement('div');
      label.className = 'review-since-label';
      label.textContent = 'since then';
      sinceEl.appendChild(label);
      for (const node of renderEntries(since, document)) sinceEl.appendChild(node);
      sinceEl.hidden = false;
    }
  }

  /**
   * Everything before the last assistant message, folded under a summary so
   * the card leads with what matters and the history is one click away.
   * Scrolling and expanding this are passive — no ack call here.
   */
  function renderThread() {
    threadEl.textContent = '';
    const { latest, earlier } = splitTranscript(messages);
    // With nothing from the agent yet, `renderSaid()` has said so and the
    // person's own words are the whole thread; they are shown, not hidden.
    if (earlier.length === 0) {
      threadDetails.hidden = true;
      return;
    }
    threadDetails.hidden = false;
    threadDetails.open = !latest;
    threadSummary.textContent = earlierSummary(earlier);
    for (const node of renderEntries(earlier, document)) threadEl.appendChild(node);
  }

  /** Bring the latest answer to the top of the card, from wherever the reader is. */
  function jumpToLatest() {
    saidSection.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }
  jumpBtn.addEventListener('click', jumpToLatest);

  /**
   * Copy a code block. The clipboard is the browser's to grant; where it is
   * not granted the block is selected instead, so Ctrl+C is one keystroke
   * away rather than the button doing nothing.
   * @param {HTMLElement} btn
   */
  async function copyCode(btn) {
    const code = btn.closest('.md-codeblock')?.querySelector('pre code');
    if (!code) return;
    const text = code.textContent || '';
    try {
      await navigator.clipboard.writeText(text);
      btn.textContent = 'copied';
    } catch {
      const range = document.createRange();
      range.selectNodeContents(code);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      btn.textContent = 'selected — press Ctrl+C';
    }
    setTimeout(() => {
      btn.textContent = 'copy';
    }, 1600);
  }

  /**
   * Open a file reference in the user's editor, through the route WP-47
   * built. The page sends a session id, a path and a line; which program that
   * means, and whether the path is inside the session's repository, are the
   * daemon's decisions (`src/http/routes/diff.mjs`, `core/editor.mjs`).
   * @param {HTMLElement} btn
   */
  async function openFile(btn) {
    const id = currentId;
    const file = btn.getAttribute('data-file') || '';
    if (!id || !file) return;
    const line = Number(btn.getAttribute('data-line')) || 1;
    try {
      const res = await fetch('/api/open-in-editor', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id, file, line }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      toast(`Opened ${file}:${line} in ${data.label || 'your editor'}`);
    } catch (err) {
      toast(`Could not open ${file}: ${err.message}`, { isError: true });
    }
  }

  // One listener for the three controls the renderers build, on the scrolling
  // body, so text rendered later — a new turn, an opened fold — needs no
  // wiring of its own. Each is an explicit click on a named control; nothing
  // here acts on a hover, a scroll or a selection.
  body.addEventListener('click', (e) => {
    const t = /** @type {HTMLElement|null} */ (e.target);
    if (!t || typeof t.closest !== 'function') return;
    const copy = /** @type {HTMLElement|null} */ (t.closest('.md-copy'));
    if (copy) {
      copyCode(copy);
      return;
    }
    const file = /** @type {HTMLElement|null} */ (t.closest('.md-fileref'));
    if (file) {
      openFile(file);
      return;
    }
    if (t.closest('.md-in-session')) ctx.goToSession?.();
  });

  return { loadConversation, renderSaid, renderThread, jumpToLatest };
}

/**
 * THE REVIEW GATE, in the panel — WP-70, `docs/07-STUDIO-DESIGN.md` §6.
 *
 * *"That session enters the existing review surface with the handover above
 * **what it said**, beside the working-tree diff the panel already draws for
 * its worktree; the reviewer — a role like any other, or the user — presses
 * **Accept handover** (the card moves where the user names) or **Bounce**
 * with a note."*
 *
 * So this block sits between the Studio artefacts and WHAT IT SAID, and the
 * diff is already at the bottom of the same card: a hired role's session runs
 * IN its worktree, and `/api/changes` follows the session, so pointing the
 * diff at the worktree is a thing this product already did rather than a
 * thing this package had to add.
 *
 * ## Waiting, and what that word is allowed to mean here
 *
 * The heading says **waiting on you**, because that is what a handover is: an
 * agent has stopped and is asking. It is a description of a file on disk, not
 * a state DeckHQ computed about a session — nothing here reads a transcript,
 * a hook or an ack, and reading this block clears no review debt
 * (`docs/01-PRODUCT.md` §2). Both requests it can make are the user's own
 * press.
 *
 * ## The test counts are a QUOTATION
 *
 * `quote` arrives from the daemon as the whole sentence — "the handover says
 * 43 passed" — built by `testsQuote()` in `src/studio/handover.mjs`. This file
 * does not take it apart, does not re-format the number and has no code path
 * that prints a count on its own. §7: *"Tests run: quoted verbatim from the
 * handover."* `test/unit/panel-handover.test.mjs` is the copy test.
 *
 * Every string below is `textContent`, or goes through `renderMarkdown`, which
 * builds DOM and never touches `innerHTML`. A handover is a file a language
 * model wrote; it is text and is never markup.
 */

import { renderMarkdown } from './markdown.js';

/** The four sections, in §6's order, with the heading each one is drawn under. */
export const SECTION_LABELS = /** @type {const} */ ([
  ['changed', 'What changed'],
  ['tests', 'Tests run'],
  ['questions', 'Open questions'],
  ['next', 'Next step'],
]);

/** The columns Accept offers, and the daemon's `ACCEPT_COLUMNS`. */
export const ACCEPT_COLUMNS = /** @type {const} */ (['review', 'done']);

/**
 * The handover this session should be reviewing, out of a `GET /api/studio`
 * body, or null.
 *
 * The join is the CARD's `agentId`, not the role's: a card names the session
 * that is working it, and a role may have been hired twice. A handover with
 * no card (`cardId: null`) is the unattached one — it belongs to no session
 * and is never drawn on one, because drawing it here would attach it.
 *
 * Pure, so `test/unit/panel-handover.test.mjs` drives it without a browser.
 *
 * @param {any} body the `GET /api/studio` response
 * @param {string|null} agentId the session the panel is open on
 * @returns {{handover:any, card:any}|null}
 */
export function handoverForSession(body, agentId) {
  if (!agentId) return null;
  const cards = body?.studio?.board?.board?.cards || [];
  const card = cards.find((c) => c && c.agentId === agentId) || null;
  if (!card) return null;
  const list = Array.isArray(body?.handovers) ? body.handovers : [];
  const mine = list
    .filter((h) => h && h.cardId === card.id)
    .sort((a, b) => (b.mtime || 0) - (a.mtime || 0))[0];
  return mine ? { handover: mine, card } : null;
}

/**
 * The one line under the heading.
 *
 * A missing section is REPORTED and never invented (§6): "waiting on you — 2
 * of the four sections are missing: Tests run, Next step". An agent that left
 * the tests out is the most important thing this line can say, and a line
 * that said "waiting on you" and nothing else would be hiding it.
 *
 * @param {any} handover one entry of `handovers`
 * @returns {string}
 */
export function handoverState(handover) {
  const missing = Array.isArray(handover?.missing) ? handover.missing : [];
  if (!missing.length) return 'waiting on you — all four sections are here.';
  const which = missing.join(', ');
  return missing.length === 1
    ? `waiting on you — one section is missing: ${which}.`
    : `waiting on you — ${missing.length} sections are missing: ${which}.`;
}

/**
 * Wire the block.
 *
 * @param {{handoverSection:any, handoverState:any, handoverBody:any,
 *          handoverActions:any, document?:Document,
 *          fetch?:typeof fetch,
 *          toast:(m:string, o?:{isError?:boolean}) => void,
 *          onDecided?:() => void}} ctx
 */
export function createHandoverPart(ctx) {
  const doc = ctx.document || document;
  const send = ctx.fetch || ((...args) => globalThis.fetch(...args));
  const section = ctx.handoverSection;
  const stateEl = ctx.handoverState;
  const bodyEl = ctx.handoverBody;
  const actionsEl = ctx.handoverActions;

  /** The project and card the block is currently about. */
  let shown = /** @type {{project:string, cardId:string}|null} */ (null);
  let busy = false;

  function hide() {
    shown = null;
    section.hidden = true;
    bodyEl.textContent = '';
    actionsEl.textContent = '';
    stateEl.textContent = '';
  }

  /**
   * Draw it, or hide it.
   * @param {any} body the `GET /api/studio` response
   * @param {string|null} agentId
   */
  function render(body, agentId) {
    const found = body?.enabled ? handoverForSession(body, agentId) : null;
    if (!found) return hide();
    shown = { project: String(body.project || ''), cardId: String(found.card.id) };

    stateEl.textContent = handoverState(found.handover);
    bodyEl.textContent = '';

    const where = doc.createElement('p');
    where.className = 'handover-file mono';
    where.textContent = `${found.card.id} — ${found.handover.path}`;
    bodyEl.appendChild(where);

    // The quotation, first and on its own line, because it is the line a
    // reviewer looks for and the line this product must never restate.
    if (found.handover.quote) {
      const quote = doc.createElement('blockquote');
      quote.className = 'handover-quote';
      quote.textContent = found.handover.quote;
      bodyEl.appendChild(quote);
    }

    for (const [key, label] of SECTION_LABELS) {
      const text = found.handover.sections?.[key];
      const part = doc.createElement('div');
      part.className = `handover-part handover-part--${key}`;
      const head = doc.createElement('h4');
      head.className = 'handover-part-heading';
      head.textContent = label;
      part.appendChild(head);
      if (text == null) {
        const gap = doc.createElement('p');
        gap.className = 'handover-missing';
        gap.textContent = 'not in the handover.';
        part.appendChild(gap);
      } else if (!text.trim()) {
        const gap = doc.createElement('p');
        gap.className = 'handover-missing';
        gap.textContent = 'the heading is there and nothing is under it.';
        part.appendChild(gap);
      } else {
        part.appendChild(renderMarkdown(text, doc));
      }
      bodyEl.appendChild(part);
    }

    drawActions();
    section.hidden = false;
  }

  /**
   * Accept — with the column named, because a handover does not get to name
   * one — and Bounce, with a note.
   */
  function drawActions() {
    actionsEl.textContent = '';
    const label = doc.createElement('label');
    label.className = 'sr-only';
    label.setAttribute('for', 'handover-column');
    label.textContent = 'Move the card to';
    const select = doc.createElement('select');
    select.id = 'handover-column';
    select.className = 'handover-column';
    for (const column of ACCEPT_COLUMNS) {
      const option = doc.createElement('option');
      option.value = column;
      option.textContent = column;
      select.appendChild(option);
    }

    const accept = doc.createElement('button');
    accept.type = 'button';
    accept.className = 'btn btn-primary';
    accept.textContent = 'Accept handover';
    accept.setAttribute('aria-label', 'Accept this handover and move the card');
    accept.addEventListener('click', () => void decide('accept', { column: select.value }));

    const bounce = doc.createElement('button');
    bounce.type = 'button';
    bounce.className = 'btn';
    bounce.textContent = 'Bounce';
    bounce.setAttribute('aria-label', 'Send this card back with a note');
    bounce.addEventListener('click', () => void askAndBounce());

    actionsEl.append(label, select, accept, bounce);
  }

  /** The note. One prompt, and an empty one is a cancel rather than a bounce. */
  async function askAndBounce() {
    const note = globalThis.prompt?.('Why is this going back? The note joins their next brief.');
    if (note == null || !String(note).trim()) return;
    await decide('bounce', { note: String(note).trim() });
  }

  /**
   * @param {'accept'|'bounce'} decision
   * @param {{column?:string, note?:string}} extra
   */
  async function decide(decision, extra) {
    if (busy || !shown) return;
    busy = true;
    try {
      const res = await send('/api/studio/handover', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ cwd: shown.project, cardId: shown.cardId, decision, ...extra }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
      ctx.toast(
        decision === 'accept'
          ? `Accepted — ${shown.cardId} is in ${extra.column}.`
          : `Bounced — the note joins ${shown.cardId}’s next brief.`,
      );
      hide();
      ctx.onDecided?.();
    } catch (err) {
      ctx.toast(`That was refused: ${err.message}`, { isError: true });
    } finally {
      busy = false;
    }
  }

  return { render, hide };
}

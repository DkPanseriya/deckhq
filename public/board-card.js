/**
 * The card editor — WP-69, `docs/07-STUDIO-DESIGN.md` §5.4.
 *
 * One small dialog, for creating a card and for editing one. Five things: the
 * title, the acceptance criteria, the milestone, the assignee role and the
 * budget. Both verbs go through `POST /api/studio/card`, which is the only
 * writer of a column (§5.2) and therefore the only place a card is refused —
 * so every validation message the user sees below is the DAEMON'S, shown where
 * it happened and never re-worded here. A second copy of the rules kept in the
 * page is a second set of rules.
 *
 * ## `op: 'edit'` never carries a column
 *
 * §150.2 item 7: a column changes on `op:'move'` alone, and an edit that
 * carried one is a 400 naming the verb. So this dialog does not draw a column
 * control at all. Moving a card is the drag, or `[` and `]` — a thing you do to
 * the board, in front of you, rather than a dropdown in a form.
 *
 * ## It is also where the board asks
 *
 * §5.4: dragging a card into Ready with no assignee *"asks which role and
 * refuses rather than choosing"*. The place an assignee is named is this
 * dialog, so `open()` takes an `ask` line, shows it above the fields and puts
 * the focus on the role control. Nothing is started; the caller has already
 * decided not to guess.
 *
 * ## And it is where a handover is reviewed from the board (WP-70)
 *
 * §6's two presses are on the panel, where the session's own diff is. They
 * are here too, because the board is where a person looks at a card: a chip
 * says a handover arrived, and opening the card shows what it said and offers
 * the same two answers. The wording, the section order and the columns Accept
 * may name are IMPORTED from `panel-handover.js` rather than restated — two
 * copies of a sentence is two sentences, and this one is a quotation.
 *
 * The handover is DRAWN, never edited: it is a file the agent wrote.
 *
 * Every string is set with `textContent`, through a form value, or through
 * `renderMarkdown`, which builds DOM and never touches `innerHTML`. There is
 * no `innerHTML` in this file.
 */

import { renderMarkdown } from './markdown.js';
import { ACCEPT_COLUMNS, SECTION_LABELS, handoverState } from './panel-handover.js';

/** The dialog's own elements, looked up once. @param {Document} doc */
function partsOf(doc) {
  return {
    dialog: /** @type {any} */ (doc.getElementById('card-dialog')),
    heading: doc.getElementById('card-dialog-title'),
    ask: doc.getElementById('card-ask'),
    title: /** @type {any} */ (doc.getElementById('card-title')),
    acceptance: /** @type {any} */ (doc.getElementById('card-acceptance')),
    milestone: /** @type {any} */ (doc.getElementById('card-milestone')),
    role: /** @type {any} */ (doc.getElementById('card-role')),
    tokens: /** @type {any} */ (doc.getElementById('card-tokens')),
    minutes: /** @type {any} */ (doc.getElementById('card-minutes')),
    // WP-71. The criteria the user has ticked, for §7's burn-down. Optional for
    // the same reason the handover block below is.
    ticks: /** @type {any} */ (doc.getElementById('card-ticks')),
    ticksList: doc.getElementById('card-ticks-list'),
    error: doc.getElementById('card-error'),
    save: /** @type {any} */ (doc.getElementById('card-save')),
    close: /** @type {any} */ (doc.getElementById('card-dialog-close')),
    // WP-70. Absent in a document built before this package, which is why
    // every use below is optional-chained: this dialog is also driven by
    // `test/unit/board-card.test.mjs` against a stub.
    handover: /** @type {any} */ (doc.getElementById('card-handover')),
    handoverState: doc.getElementById('card-handover-state'),
    handoverQuote: /** @type {any} */ (doc.getElementById('card-handover-quote')),
    handoverBody: doc.getElementById('card-handover-body'),
    handoverColumn: /** @type {any} */ (doc.getElementById('card-handover-column')),
    handoverAccept: /** @type {any} */ (doc.getElementById('card-handover-accept')),
    handoverBounce: /** @type {any} */ (doc.getElementById('card-handover-bounce')),
  };
}

/**
 * A count typed into the budget fields, or a refusal.
 *
 * Empty is `null` — no budget, which is a real answer and the one every card
 * starts with. Anything else must be a whole count of 0 or more, and the
 * refusal says which field and what it wanted rather than silently dropping
 * the value, which is how a cap the user thinks they set turns out not to be.
 *
 * @param {string} raw
 * @param {string} what
 * @returns {{value:number|null}|{error:string}}
 */
export function parseCount(raw, what) {
  const text = String(raw ?? '')
    .replace(/[,\s_]/g, '')
    .trim();
  if (!text) return { value: null };
  const n = Number(text);
  if (!Number.isFinite(n) || n < 0 || !Number.isInteger(n)) {
    return { error: `${what} is a whole count of 0 or more, or empty for no budget.` };
  }
  return { value: n };
}

/**
 * The card the form is describing, or the first thing wrong with it.
 *
 * Only the two things a form can know on its own: a title, because a card with
 * no title is a card nobody can find again on a board, and the shape of the
 * two counts. Everything else — the role name's characters, the ceilings, the
 * column — is the daemon's, and asking twice would mean two answers.
 *
 * Pure, so `test/unit/board-card.test.mjs` drives it without a dialog.
 *
 * @param {{title:string, acceptance:string, milestone:string, role:string,
 *          tokens:string, minutes:string, done?:string[]}} values
 *   `done` is WP-71's: the criteria ticked in the list, by their text. A tick
 *   whose criterion the user has just deleted from the textarea is dropped
 *   here, and the daemon drops it again if it was not.
 * @returns {{card:any}|{error:string}}
 */
export function cardFromForm(values) {
  const title = String(values.title || '').trim();
  if (!title) return { error: 'A card needs a title — it is what you will look for on the board.' };

  const tokens = parseCount(values.tokens, 'Budget — tokens');
  if ('error' in tokens) return tokens;
  const minutes = parseCount(values.minutes, 'Budget — minutes');
  if ('error' in minutes) return minutes;

  const acceptance = String(values.acceptance || '')
    .split('\n')
    .map((line) => line.replace(/^\s*[-*]\s*/, '').trim())
    .filter(Boolean);

  const milestone = String(values.milestone || '').trim();
  const role = String(values.role || '').trim();
  const budget =
    tokens.value == null && minutes.value == null
      ? null
      : { tokens: tokens.value, minutes: minutes.value };

  const done = Array.isArray(values.done) ? values.done : [];
  const acceptanceDone = acceptance.filter((line) => done.includes(line));

  return {
    card: {
      title,
      acceptance,
      acceptanceDone,
      milestone: milestone || null,
      role: role || null,
      budget,
    },
  };
}

/** The lines the acceptance textarea shows for a card. */
export function acceptanceText(card) {
  return (Array.isArray(card?.acceptance) ? card.acceptance : []).filter(Boolean).join('\n');
}

/**
 * Wire the card editor.
 *
 * @param {{document?:Document,
 *          onSave:(card:any, cardId:string|null) => Promise<{error?:string}|void>,
 *          onDecide?:(decision:'accept'|'bounce', extra:{column?:string, note?:string},
 *                     cardId:string) => Promise<{error?:string}|void>,
 *          ask?:(question:string) => (string|null)}} opts
 *   `onSave` and `onDecide` are the CALLER'S — this module posts nothing.
 *   Each resolves to `{ error }` when the daemon refused, and the message is
 *   shown inline and the dialog stays open, because a refusal that closed the
 *   form would take the user's typing with it. `ask` is the bounce note's
 *   prompt, a seam so a test can answer it.
 */
export function createCardEditor(opts) {
  const doc = opts.document || document;
  const el = partsOf(doc);
  /** The card being edited, or null while creating one. */
  let editingId = null;
  let busy = false;

  /** @param {string|null} message */
  function showError(message) {
    if (!el.error) return;
    el.error.textContent = message || '';
    el.error.hidden = !message;
  }

  function values() {
    return {
      title: el.title?.value ?? '',
      acceptance: el.acceptance?.value ?? '',
      milestone: el.milestone?.value ?? '',
      role: el.role?.value ?? '',
      tokens: el.tokens?.value ?? '',
      minutes: el.minutes?.value ?? '',
      done: ticked(),
    };
  }

  /** The criteria currently ticked in the list, by their text. */
  function ticked() {
    const boxes = el.ticksList?.querySelectorAll?.('input[type="checkbox"]') || [];
    return [...boxes]
      .filter((box) => box.checked)
      .map((box) => String(box.getAttribute('data-criterion') || ''));
  }

  /**
   * One checkbox per criterion the card carries, ticked where the user
   * ticked it (WP-71). Built from the card as it was opened: a criterion
   * typed into the textarea since is ticked the next time, once it exists.
   * @param {any} card
   */
  function fillTicks(card) {
    if (!el.ticksList) return;
    el.ticksList.textContent = '';
    const criteria = Array.isArray(card?.acceptance) ? card.acceptance.filter(Boolean) : [];
    const done = Array.isArray(card?.acceptanceDone) ? card.acceptanceDone : [];
    for (const line of criteria) {
      const label = doc.createElement('label');
      label.className = 'card-tick';
      const box = /** @type {any} */ (doc.createElement('input'));
      box.type = 'checkbox';
      box.setAttribute('data-criterion', String(line));
      box.checked = done.includes(line);
      const text = doc.createElement('span');
      text.textContent = String(line);
      label.append(box, text);
      el.ticksList.appendChild(label);
    }
    if (el.ticks) el.ticks.hidden = criteria.length === 0;
  }

  /**
   * Fill the role control from the roster.
   *
   * "Nobody" is a real option and is first: §5.4 makes an unassigned card a
   * state the board holds rather than a mistake it corrects, and taking the
   * option away would mean a card could never be un-assigned once it had been.
   * A role the roster no longer has, but the card still names, is kept as its
   * own option so an edit cannot silently drop it.
   *
   * @param {Array<{name?:string}>} roles
   * @param {string|null} current
   */
  function fillRoles(roles, current) {
    if (!el.role) return;
    el.role.textContent = '';
    const names = [];
    for (const role of roles || []) {
      const name = String(role?.name || '').trim();
      if (name && !names.includes(name)) names.push(name);
    }
    if (current && !names.includes(current)) names.push(current);
    const nobody = doc.createElement('option');
    nobody.value = '';
    nobody.textContent = 'nobody yet';
    el.role.appendChild(nobody);
    for (const name of names) {
      const option = doc.createElement('option');
      option.value = name;
      option.textContent = name;
      el.role.appendChild(option);
    }
    el.role.value = current || '';
  }

  /**
   * @param {{card?:any, roles?:Array<any>, ask?:string|null, handover?:any}} what
   *   `card` absent means create. `ask` is §5.4's question, shown above the
   *   fields when the board sent the user here rather than the user opening it.
   *   `handover` is WP-70's, and a card with none simply has no block.
   */
  function open(what = {}) {
    const card = what.card || null;
    editingId = card ? String(card.id || '') : null;
    showError(null);
    if (el.heading) el.heading.textContent = card ? `Card ${card.id}` : 'New card';
    if (el.title) el.title.value = String(card?.title || '');
    if (el.acceptance) el.acceptance.value = acceptanceText(card);
    if (el.milestone) el.milestone.value = String(card?.milestone || '');
    if (el.tokens) el.tokens.value = card?.budget?.tokens == null ? '' : String(card.budget.tokens);
    if (el.minutes) {
      el.minutes.value = card?.budget?.minutes == null ? '' : String(card.budget.minutes);
    }
    fillRoles(what.roles || [], card?.role || null);
    fillTicks(card);
    if (el.ask) {
      el.ask.textContent = what.ask || '';
      el.ask.hidden = !what.ask;
    }
    showHandover(card ? what.handover || null : null);
    if (el.save) el.save.textContent = card ? 'Save card' : 'Create card';
    el.dialog?.showModal?.();
    // The question, if there was one, is about the role — so that is where the
    // cursor goes. Otherwise the title, which is where a new card starts.
    (what.ask ? el.role : el.title)?.focus?.();
  }

  function close() {
    el.dialog?.close?.();
  }

  async function save() {
    if (busy) return;
    const built = cardFromForm(values());
    if ('error' in built) {
      showError(built.error);
      return;
    }
    busy = true;
    if (el.save) el.save.disabled = true;
    try {
      const outcome = await opts.onSave(built.card, editingId);
      if (outcome && outcome.error) {
        showError(outcome.error);
        return;
      }
      close();
    } finally {
      busy = false;
      if (el.save) el.save.disabled = false;
    }
  }

  /**
   * Draw the handover this card has, or take the block away.
   *
   * It is drawn, not edited. The state line, the section order and the
   * columns Accept offers all come from `panel-handover.js`, so the board and
   * the panel say the same words about the same file.
   *
   * @param {any} handover one entry of `GET /api/studio`'s `handovers`
   */
  function showHandover(handover) {
    if (!el.handover) return;
    if (!handover) {
      el.handover.hidden = true;
      if (el.handoverBody) el.handoverBody.textContent = '';
      return;
    }
    if (el.handoverState) el.handoverState.textContent = handoverState(handover);
    if (el.handoverQuote) {
      // The count is the AGENT'S sentence, whole, as the daemon built it.
      // Nothing here parses a number out of it (§7).
      el.handoverQuote.textContent = handover.quote || '';
      el.handoverQuote.hidden = !handover.quote;
    }
    if (el.handoverBody) {
      el.handoverBody.textContent = '';
      for (const [key, label] of SECTION_LABELS) {
        const text = handover.sections?.[key];
        const part = doc.createElement('div');
        part.className = 'handover-part';
        const head = doc.createElement('h4');
        head.className = 'handover-part-heading';
        head.textContent = label;
        part.appendChild(head);
        if (text == null || !String(text).trim()) {
          const gap = doc.createElement('p');
          gap.className = 'handover-missing';
          gap.textContent = text == null ? 'not in the handover.' : 'nothing under the heading.';
          part.appendChild(gap);
        } else {
          part.appendChild(renderMarkdown(String(text), doc));
        }
        el.handoverBody.appendChild(part);
      }
    }
    if (el.handoverColumn) {
      el.handoverColumn.textContent = '';
      for (const column of ACCEPT_COLUMNS) {
        const option = doc.createElement('option');
        option.value = column;
        option.textContent = column;
        el.handoverColumn.appendChild(option);
      }
    }
    el.handover.hidden = false;
  }

  /**
   * @param {'accept'|'bounce'} decision
   */
  async function decide(decision) {
    if (busy || !editingId || typeof opts.onDecide !== 'function') return;
    /** @type {{column?:string, note?:string}} */
    const extra = {};
    if (decision === 'accept') extra.column = el.handoverColumn?.value || ACCEPT_COLUMNS[0];
    else {
      const asker = opts.ask || ((q) => globalThis.prompt?.(q));
      const note = asker('Why is this going back? The note joins their next brief.');
      // An empty answer is a CANCEL, not a bounce with no reason: the daemon
      // refuses a note-less bounce, and sending one to be refused would be
      // this dialog turning a change of mind into an error message.
      if (note == null || !String(note).trim()) return;
      extra.note = String(note).trim();
    }
    busy = true;
    try {
      const outcome = await opts.onDecide(decision, extra, editingId);
      if (outcome && outcome.error) {
        showError(outcome.error);
        return;
      }
      close();
    } finally {
      busy = false;
    }
  }

  el.handoverAccept?.addEventListener?.('click', () => void decide('accept'));
  el.handoverBounce?.addEventListener?.('click', () => void decide('bounce'));
  el.save?.addEventListener?.('click', () => void save());
  // The ✕ is a `type="submit"` inside a `method="dialog"` form, which is how
  // every other dialog in this document closes; nothing here calls a global.
  el.close?.addEventListener?.('click', () => showError(null));

  return { open, close, save, decide, isOpen: () => Boolean(el.dialog?.open) };
}

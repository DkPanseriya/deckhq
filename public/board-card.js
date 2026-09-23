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
 * Every string is set with `textContent` or through a form value. There is no
 * `innerHTML` in this file.
 */

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
    error: doc.getElementById('card-error'),
    save: /** @type {any} */ (doc.getElementById('card-save')),
    close: /** @type {any} */ (doc.getElementById('card-dialog-close')),
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
 *          tokens:string, minutes:string}} values
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

  return { card: { title, acceptance, milestone: milestone || null, role: role || null, budget } };
}

/** The lines the acceptance textarea shows for a card. */
export function acceptanceText(card) {
  return (Array.isArray(card?.acceptance) ? card.acceptance : []).filter(Boolean).join('\n');
}

/**
 * Wire the card editor.
 *
 * @param {{document?:Document,
 *          onSave:(card:any, cardId:string|null) => Promise<{error?:string}|void>}} opts
 *   `onSave` is the CALLER'S — this module posts nothing. It resolves to
 *   `{ error }` when the daemon refused, and the message is shown inline and
 *   the dialog stays open, because a refusal that closed the form would take
 *   the user's typing with it.
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
    };
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
   * @param {{card?:any, roles?:Array<any>, ask?:string|null}} what
   *   `card` absent means create. `ask` is §5.4's question, shown above the
   *   fields when the board sent the user here rather than the user opening it.
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
    if (el.ask) {
      el.ask.textContent = what.ask || '';
      el.ask.hidden = !what.ask;
    }
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

  el.save?.addEventListener?.('click', () => void save());
  // The ✕ is a `type="submit"` inside a `method="dialog"` form, which is how
  // every other dialog in this document closes; nothing here calls a global.
  el.close?.addEventListener?.('click', () => showError(null));

  return { open, close, save, isOpen: () => Boolean(el.dialog?.open) };
}

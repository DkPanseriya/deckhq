/**
 * The Studio board, as a picture — WP-69, `docs/07-STUDIO-DESIGN.md` §5.
 *
 * Six columns, the cards in them, and a real `<table>` underneath carrying the
 * same cards in the same order. Everything in this file is PURE: it takes a
 * board and a `document` and returns elements, the technique `deck-view.js`,
 * `diff-view.js` and `markdown.js` use, so the DOM the board builds is asserted
 * directly in `test/unit/board-view.test.mjs` without a browser. The controller
 * — fetching, dragging, moving, the editor — is `./board-ui.js`.
 *
 * ============================================================================
 * THE TABLE IS THE READING, THE COLUMNS ARE THE PICTURE (§5.4, §10)
 *
 * §5.4: *a real table underneath so a screen reader gets the same cards in the
 * same order — the deck's rule, not a new one.* So:
 *
 *   - the six columns are `role="presentation"`. They are a layout of one list,
 *     and announcing them as six lists would make the board six boards;
 *   - every CARD is a real tab stop with a complete `aria-label` — its column,
 *     its title, its assignee, its acceptance count, its budget and its flags —
 *     so the kanban is operable and self-describing without the table;
 *   - and `renderBoardTable()` below is the board in one order: column by
 *     column, and inside a column the order the user put the cards in. It ships
 *     `sr-only` because it says exactly what the columns already show, and a
 *     surface that says everything twice on screen is a surface nobody reads.
 *
 * `boardOrder()` is that order, and it is the ONE order: the table rows, the
 * `[`/`]` walk and the drop positions all come from it, so the three cannot
 * drift apart the way two orderings always eventually do.
 * ============================================================================
 *
 * ONE COLUMN LIST, TWO PROCESSES. `BOARD_COLUMNS` below is the same six, in the
 * same order, as `COLUMNS` in `src/studio/schema.mjs` — separate because `src/`
 * is never served to the browser, pinned together by a test that reads both, on
 * `deck-view.js`'s own precedent. A column this file knew about and the
 * validator did not would be a card the user could drag into a board that would
 * then refuse to load.
 *
 * Everything a planner or a user wrote — a title, a criterion, a flag, a role
 * name — is written with `textContent`. There is no `innerHTML` in this file.
 */

/**
 * The six columns in board order, with what each is called on screen.
 *
 * The ids are `board.json`'s and the labels are §5's own words. `blocked` is
 * last and is the only column a system write may ever reach (§8's budget stop);
 * everything else here moves because a person moved it.
 */
export const BOARD_COLUMNS = Object.freeze([
  Object.freeze({ id: 'backlog', label: 'Backlog' }),
  Object.freeze({ id: 'ready', label: 'Ready' }),
  Object.freeze({ id: 'in_progress', label: 'In progress' }),
  Object.freeze({ id: 'review', label: 'Review' }),
  Object.freeze({ id: 'done', label: 'Done' }),
  Object.freeze({ id: 'blocked', label: 'Blocked' }),
]);

/** The column a card lands in when a session is to start on it (§5.4). */
export const READY_COLUMN = 'ready';

/** Just the ids, for a caller that only needs the order. */
export const COLUMN_IDS = /** @type {readonly string[]} */ (
  Object.freeze(BOARD_COLUMNS.map((c) => c.id))
);

/** What a column is called, or the raw id for one this build does not know. */
export function columnLabel(id) {
  return BOARD_COLUMNS.find((c) => c.id === id)?.label || String(id || '');
}

/**
 * The cards of one board, grouped by column, in board order.
 *
 * Every column is present even when it is empty: a kanban that drew four
 * columns today and six tomorrow would move under the user's hand, and an
 * empty column is where a card is dropped.
 *
 * @param {{cards?:Array<any>}|null|undefined} board
 * @returns {Array<{id:string, label:string, cards:any[]}>}
 */
export function cardsByColumn(board) {
  const cards = Array.isArray(board?.cards) ? board.cards : [];
  return BOARD_COLUMNS.map((column) => ({
    id: column.id,
    label: column.label,
    cards: cards.filter((card) => String(card?.column || '') === column.id),
  }));
}

/**
 * THE ONE ORDER. Column by column, and inside a column the order the file has
 * them in — which is the order the user put them in, because nothing sorts a
 * board. The table reads it, the keyboard walks it, and the drop positions come
 * from it.
 *
 * A card in a column this build does not know is not dropped: it comes last,
 * so a board written by a later build is still entirely readable here. It is
 * also unreachable by `validateBoard`, which refuses such a column outright —
 * this is the belt to that braces.
 *
 * @param {{cards?:Array<any>}|null|undefined} board
 * @returns {any[]}
 */
export function boardOrder(board) {
  const grouped = cardsByColumn(board).flatMap((c) => c.cards);
  const seen = new Set(grouped);
  const rest = (Array.isArray(board?.cards) ? board.cards : []).filter((c) => !seen.has(c));
  return [...grouped, ...rest];
}

/**
 * The column `[`/`]` or an arrow key lands on, or `null` at either end.
 *
 * Deliberately NOT wrapping. A board is a line from Backlog to Blocked and the
 * ends are ends; a `]` on a Blocked card that silently returned it to Backlog
 * would be the one keystroke this product could least afford to get wrong.
 *
 * @param {string} from the card's current column
 * @param {1|-1} direction
 * @returns {string|null}
 */
export function stepColumn(from, direction) {
  const at = COLUMN_IDS.indexOf(String(from || ''));
  if (at === -1) return direction === 1 ? COLUMN_IDS[0] : null;
  const next = at + direction;
  if (next < 0 || next >= COLUMN_IDS.length) return null;
  return COLUMN_IDS[next];
}

/** How many acceptance criteria a card carries, and the word for it. */
export function acceptanceCount(card) {
  const n = Array.isArray(card?.acceptance) ? card.acceptance.filter(Boolean).length : 0;
  return { n, text: n === 1 ? '1 criterion' : `${n} criteria` };
}

/** `400,000` — grouped, because a token count is read rather than computed. */
function groupDigits(n) {
  return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/**
 * The budget as one short phrase, or `null` when the card carries none.
 *
 * Both halves when both are set (§11.5: *both shown, either trips the stop*),
 * and no number at all is invented — a card with no budget says nothing about
 * one rather than saying zero.
 */
export function budgetText(card) {
  const budget = card?.budget;
  if (!budget) return null;
  const parts = [];
  if (budget.tokens != null) parts.push(`${groupDigits(budget.tokens)} tokens`);
  if (budget.minutes != null) parts.push(`${groupDigits(budget.minutes)} min`);
  return parts.length ? parts.join(' · ') : null;
}

/**
 * The chips a card wears, in the order it wears them.
 *
 * A flag is a chip and never a move (§5.2): an observed event may flag a card
 * and may never move it, so everything a flag can do to this board is be drawn
 * here. Its own text is used verbatim — it was written by a planner pass and
 * quoting it is the honest thing to do with it.
 *
 * @param {any} card
 * @returns {Array<{kind:string, text:string}>}
 */
export function cardChips(card) {
  /** @type {Array<{kind:string, text:string}>} */
  const chips = [];
  const acceptance = acceptanceCount(card);
  if (acceptance.n > 0) chips.push({ kind: 'acceptance', text: acceptance.text });
  const budget = budgetText(card);
  if (budget) chips.push({ kind: 'budget', text: budget });
  for (const flag of Array.isArray(card?.flags) ? card.flags : []) {
    if (!flag) continue;
    const text = String(flag.text || '').trim();
    chips.push({
      kind: `flag flag--${String(flag.kind || 'note')}`,
      text: text || String(flag.kind || 'note'),
    });
  }
  return chips;
}

/**
 * What a screen reader is told about one card, as one sentence.
 *
 * Everything on the card, because this label is the card: the kanban's columns
 * are presentational (see the header) and a label that left the column out
 * would leave out the one thing the picture is arranged by.
 *
 * @param {any} card
 * @returns {string}
 */
export function cardLabel(card) {
  const parts = [
    `${columnLabel(card?.column)}.`,
    String(card?.title || '').trim() || '(untitled)',
    `— card ${String(card?.id || '')}.`,
  ];
  parts.push(card?.role ? `Assigned to ${card.role}.` : 'No assignee.');
  const acceptance = acceptanceCount(card);
  parts.push(acceptance.n ? `${acceptance.text}.` : 'No acceptance criteria.');
  const budget = budgetText(card);
  if (budget) parts.push(`Budget ${budget}.`);
  if (card?.milestone) parts.push(`Milestone ${card.milestone}.`);
  for (const flag of Array.isArray(card?.flags) ? card.flags : []) {
    if (flag?.text) parts.push(`Flag: ${flag.text}.`);
  }
  return parts.join(' ');
}

/**
 * THE MESSAGE A LIVE SESSION IS SENT WHEN A CARD REACHES READY (§5.4).
 *
 * Not the brief. A brief is a FILE, written before a spawn and never under a
 * running session (§6.1), and `src/studio/brief-role.mjs` is the only thing
 * that writes one. A session already at a desk cannot be given a new system
 * prompt, so what it gets is what a person would type: the card, in full, and
 * one instruction. `test/unit/board-view.test.mjs` pins this against
 * `cardSection()` — every field one carries, the other carries — for the reason
 * `deck-view.test.mjs` pins the deck against `src/cli/deck.mjs`.
 *
 * @param {any} card
 * @returns {string}
 */
export function cardMessage(card) {
  const lines = [
    `Your next card is ${String(card?.id || '')} — ${String(card?.title || '').trim() || '(untitled)'}.`,
    '',
  ];
  if (card?.milestone) lines.push(`Milestone: ${card.milestone}`);
  const budget = budgetText(card);
  if (budget) lines.push(`Budget on the card: ${budget}`);
  const acceptance = Array.isArray(card?.acceptance) ? card.acceptance.filter(Boolean) : [];
  if (acceptance.length) {
    lines.push('', 'Accepted when:');
    for (const line of acceptance) lines.push(`- ${line}`);
  } else {
    lines.push('', 'This card carries no acceptance criteria. Ask for them before you start.');
  }
  lines.push(
    '',
    'Work it in the worktree you are already in. When you believe it is done, write',
    `.deckhq/studio/handovers/${String(card?.id || '')}.md with what changed, the tests you ran`,
    'and their real counts, open questions, and the next step. Do not move the card:',
    'the board is the user’s.',
  );
  return lines.join('\n');
}

// --------------------------------------------------------------- the picture

/** @param {any} doc @param {string} tag @param {string} [className] */
function make(doc, tag, className) {
  const node = doc.createElement(tag);
  if (className) node.className = className;
  return node;
}

/**
 * One card, as the element the pointer drags and the keyboard focuses.
 *
 * `role="button"` and `tabindex="0"`: the card IS the control. Enter opens its
 * editor, `[` and `]` move it a column, and the label above says everything a
 * sighted reader can see on it.
 *
 * The face is an empty `<canvas>` with the agent id on it and nothing drawn
 * here — this module is pure and has no renderer. `board-ui.js` fills the ones
 * that have an id, through the same `rig.drawCharacter()` the floor and the
 * panel's close-up use. A role with no live session gets NO canvas at all: a
 * face is a pure function of the session id (§4, §105), so a role nobody has
 * hired has no face and drawing one would be inventing a person.
 *
 * @param {any} card
 * @param {{agentIdFor?:(role:string) => string|null}} opts
 * @param {any} doc
 */
export function buildCard(card, opts, doc) {
  const el = make(doc, 'div', 'board-card');
  el.setAttribute('data-card', String(card?.id || ''));
  el.setAttribute('data-column', String(card?.column || ''));
  el.setAttribute('draggable', 'true');
  el.setAttribute('tabindex', '0');
  el.setAttribute('role', 'button');
  el.setAttribute('aria-label', cardLabel(card));

  const title = make(doc, 'p', 'board-card-title');
  title.textContent = String(card?.title || '').trim() || '(untitled)';
  el.appendChild(title);

  const who = make(doc, 'p', 'board-card-who');
  const role = String(card?.role || '').trim();
  if (role) {
    const agentId = opts.agentIdFor?.(role) || null;
    if (agentId) {
      const face = make(doc, 'canvas', 'board-face');
      face.setAttribute('width', '56');
      face.setAttribute('height', '56');
      face.setAttribute('data-agent', agentId);
      face.setAttribute('aria-hidden', 'true');
      who.appendChild(face);
    }
    const name = make(doc, 'span', 'board-card-role');
    name.textContent = role;
    who.appendChild(name);
  } else {
    const none = make(doc, 'span', 'board-card-role board-card-role--none');
    none.textContent = 'no assignee';
    who.appendChild(none);
  }
  el.appendChild(who);

  const chips = cardChips(card);
  if (chips.length) {
    const row = make(doc, 'p', 'board-card-chips');
    for (const chip of chips) {
      const span = make(doc, 'span', `board-chip board-chip--${chip.kind.split(' ')[0]}`);
      span.textContent = chip.text;
      row.appendChild(span);
    }
    el.appendChild(row);
  }
  return el;
}

/**
 * The six columns, with their cards.
 *
 * Presentational, for the reason in the header: this is one list drawn in six
 * places, and six announced lists would be six boards.
 *
 * @param {{cards?:Array<any>}|null|undefined} board
 * @param {{agentIdFor?:(role:string) => string|null}} opts
 * @param {any} doc
 */
export function renderBoardColumns(board, opts, doc) {
  const wrap = make(doc, 'div', 'board-columns');
  wrap.setAttribute('role', 'presentation');
  for (const column of cardsByColumn(board)) {
    const section = make(doc, 'section', 'board-col');
    section.setAttribute('data-column', column.id);
    section.setAttribute('role', 'presentation');

    const head = make(doc, 'h3', 'board-col-head');
    head.setAttribute('aria-hidden', 'true');
    const name = make(doc, 'span', 'board-col-name');
    name.textContent = column.label;
    const count = make(doc, 'span', 'board-col-count');
    count.textContent = String(column.cards.length);
    head.append(name, count);
    section.appendChild(head);

    const drop = make(doc, 'div', 'board-drop');
    drop.setAttribute('data-column', column.id);
    for (const card of column.cards) drop.appendChild(buildCard(card, opts, doc));
    section.appendChild(drop);
    wrap.appendChild(section);
  }
  return wrap;
}

/** The table's columns, in the order a row states them. */
const TABLE_COLUMNS = Object.freeze([
  { key: 'column', label: 'Column' },
  { key: 'id', label: 'Card' },
  { key: 'title', label: 'Title' },
  { key: 'role', label: 'Assignee' },
  { key: 'acceptance', label: 'Acceptance' },
  { key: 'budget', label: 'Budget' },
  { key: 'flags', label: 'Flags' },
]);

/**
 * THE SAME CARDS, IN THE SAME ORDER, AS A TABLE (§5.4).
 *
 * `boardOrder()` and nothing else, so the rows cannot disagree with the
 * columns. Every cell is text; the board is read here rather than operated,
 * and the cards above are where it is operated.
 *
 * @param {{cards?:Array<any>}|null|undefined} board
 * @param {any} doc
 */
export function renderBoardTable(board, doc) {
  const table = make(doc, 'table', 'board-table sr-only');

  const caption = doc.createElement('caption');
  caption.textContent =
    'Every card on this board, in board order: Backlog, Ready, In progress, Review, Done, ' +
    'Blocked, and inside each column the order they were put in.';
  table.appendChild(caption);

  const thead = doc.createElement('thead');
  const headRow = doc.createElement('tr');
  for (const col of TABLE_COLUMNS) {
    const th = doc.createElement('th');
    th.setAttribute('scope', 'col');
    th.textContent = col.label;
    headRow.appendChild(th);
  }
  thead.appendChild(headRow);
  table.appendChild(thead);

  const tbody = doc.createElement('tbody');
  for (const card of boardOrder(board)) {
    const row = doc.createElement('tr');
    row.setAttribute('data-card', String(card?.id || ''));

    const column = doc.createElement('td');
    column.textContent = columnLabel(card?.column);
    row.appendChild(column);

    const id = doc.createElement('th');
    id.setAttribute('scope', 'row');
    id.textContent = String(card?.id || '');
    row.appendChild(id);

    const cells = [
      String(card?.title || '').trim() || '(untitled)',
      String(card?.role || '').trim() || 'nobody',
      acceptanceCount(card).text,
      budgetText(card) || 'no budget',
      (Array.isArray(card?.flags) ? card.flags : [])
        .map((f) => String(f?.text || f?.kind || '').trim())
        .filter(Boolean)
        .join('; ') || 'none',
    ];
    for (const text of cells) {
      const td = doc.createElement('td');
      td.textContent = text;
      row.appendChild(td);
    }
    tbody.appendChild(row);
  }
  table.appendChild(tbody);
  return table;
}

/**
 * What an empty board says, and it says how to get a card rather than that
 * there are none — §5's board is the output of a plan, so the answer to "no
 * cards" is always the same one.
 */
export const EMPTY_BOARD_LINES = Object.freeze([
  'No cards yet.',
  'The board is written by the planner: run Studio: plan this project from ⌘K, answer its ' +
    'questions, and it writes board.json along with the blueprint and the roster. You can also ' +
    'add a card here with New card, and edit board.json by hand at any time — these files ' +
    'are yours.',
]);

/**
 * The board's empty state, as the element that replaces the columns.
 * @param {any} doc
 */
export function renderEmptyBoard(doc) {
  const wrap = make(doc, 'div', 'board-empty');
  const [head, body] = EMPTY_BOARD_LINES;
  const h = make(doc, 'p', 'board-empty-head');
  h.textContent = head;
  const p = make(doc, 'p', 'board-empty-body');
  p.textContent = body;
  wrap.append(h, p);
  return wrap;
}

/**
 * What the board says when the project has not enabled Studio, which is every
 * project until somebody turns it on (§1). The daemon's own refusal is shown
 * where there is one; this is the line for "you have not picked a project".
 */
export const NO_PROJECT_LINE =
  'Select a session first — a board belongs to one project, and Studio is enabled per project.';

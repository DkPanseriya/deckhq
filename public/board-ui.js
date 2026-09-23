/**
 * The Studio board, driven — WP-69, `docs/07-STUDIO-DESIGN.md` §5.
 *
 * `./board-view.js` is the picture and is pure; this is everything that
 * touches an element, a network or a user. Four things:
 *
 *   1. opening and closing a full-surface view (WP-84, `./surfaces.js`);
 *   2. moving a card — by pointer and by keyboard — through the one door a
 *      column moves through;
 *   3. the card editor, `./board-card.js`, for create and edit;
 *   4. card → session (§5.4), which is a hire or a send and never a guess.
 *
 * ============================================================================
 * EVERY MOVE GOES THROUGH `POST /api/studio/card` (§5.2, §5.3)
 *
 * The column is user-owned state. Nothing in this file writes one anywhere but
 * in that request, and nothing that is not a press reaches it at all: there is
 * no timer, no snapshot handler and no event subscription here that could move
 * a card. A session ending, a hook arriving and a scan completing move NO card
 * — `test/integration/studio-board.test.mjs` drives all three against a
 * fixture board and asserts `board.json` is byte-identical afterwards.
 *
 * The UI is optimistic and the revert is the point. A move repaints
 * immediately, because a board that lags the hand is a board you drop cards
 * on; and if the daemon refuses, the PREVIOUS board is put back and the
 * daemon's own sentence is shown. Not a re-fetch — a re-fetch would show
 * whatever the file says now, which on a refusal is the same thing but on a
 * race is somebody else's board appearing as if it were the answer to your
 * drag.
 * ============================================================================
 *
 * WHAT OPENS IT. `Studio: board` in ⌘K, and the `[ board ]` control in the
 * panel's Studio block — which is drawn only for a project that has enabled
 * Studio, so it is the Studio-enabled project's own way in. Escape, ✕ and
 * "Back to floor" all close it, and closing it selects the assignee of the
 * last card that was clicked (§5.4: *clicking a card selects its assignee and
 * lights that desk*) — on the way out, so the floor is what you land on.
 */

import { wireSurfaceControls } from './surfaces.js';
import { createCardEditor } from './board-card.js';
import {
  NO_PROJECT_LINE,
  READY_COLUMN,
  cardMessage,
  columnLabel,
  renderBoardColumns,
  renderBoardTable,
  renderEmptyBoard,
  stepColumn,
} from './board-view.js';

/**
 * The runtime a Hire started from the client runs a role on.
 *
 * Named once here for both callers — the palette's `Studio: hire <role>` row
 * (`app-studio.js`) and the board's hand-off below — and sent on every
 * `/api/studio/hire`, rather than left to the route's own documented default.
 * WP-92j's reason (`test/unit/runtime-required.test.mjs`): which of four
 * runtimes a spawn was about is the caller's to say, and a page that let the
 * daemon pick would be a page that never showed the user which one it picked.
 * `claude-code` because it is the one runtime §4 does not have to mark
 * *unverified*.
 */
export const HIRE_RUNTIME = 'claude-code';

/** The keys that move a card one column, and which way each goes. */
const MOVE_KEYS = /** @type {Record<string, 1|-1>} */ ({
  '[': -1,
  ']': 1,
  ArrowLeft: -1,
  ArrowRight: 1,
});

/**
 * Build the board's controller over a set of elements.
 *
 * EVERYTHING IT TOUCHES ARRIVES THROUGH THIS ARGUMENT — the document, the
 * fetch, the toast, the project in view, the selection, the live region. Not
 * one of them is read off a module this file imports, which is what lets
 * `test/unit/board-ui.test.mjs` drive the whole of it — a keyboard move, a
 * refusal and its revert, and the hand-off in all three of its shapes —
 * against stubs, with no browser and no socket. `public/board-shell.js` is
 * where the page's real ones are handed in, and it is the only module that
 * reaches `app-state.js`.
 *
 * The defaults below are inert rather than clever: a board built with no
 * `getProject` has no project and says so, and one built with no `notify`
 * swallows its toast. Nothing here falls back to a global.
 *
 * @param {{host:any, body:any, projectEl?:any, newCardEl?:any, stageEl?:any,
 *          document?:any, fetch?:typeof globalThis.fetch,
 *          editor?:{open:Function, close:Function},
 *          getProject?:() => any, onSelect?:(id:string) => void,
 *          notify?:(text:string, opts?:{isError?:boolean}) => void,
 *          announce?:(text:string) => void,
 *          drawFaces?:(root:any) => void}} opts
 */
export function createBoardUI(opts) {
  const doc = opts.document || globalThis.document;
  /** @type {typeof globalThis.fetch} */
  const get = (url, init) => (opts.fetch || globalThis.fetch)(url, init);
  const say = opts.notify || (() => {});
  const project = opts.getProject || (() => null);
  const select = opts.onSelect || (() => {});

  let open = false;
  /** The `GET /api/studio` answer this board was painted from. */
  let snapshot = /** @type {any} */ (null);
  /** The project directory it was about, so a stale answer is never drawn. */
  let cwd = '';
  /** The card the keyboard acts on. */
  let focused = /** @type {string|null} */ (null);
  /** The desk to light on the way out (§5.4). */
  let pendingSelection = /** @type {string|null} */ (null);

  const editor =
    opts.editor ||
    createCardEditor({
      document: doc,
      onSave: (card, cardId) => saveCard(card, cardId),
    });

  /** The board as it currently stands, never shared with the renderer. */
  const boardNow = () => snapshot?.studio?.board?.board || { cards: [] };
  /** The roster roles, for the editor's control and for the hand-off. */
  const rolesNow = () => (Array.isArray(snapshot?.roles) ? snapshot.roles : []);
  /** @param {string} id */
  const cardById = (id) => boardNow().cards.find((c) => String(c.id) === String(id)) || null;

  /** A role's live session id, or null. The registry's answer, never a guess. */
  function agentIdFor(roleName) {
    const role = rolesNow().find(
      (r) => String(r?.name || '').toLowerCase() === String(roleName || '').toLowerCase(),
    );
    return role?.live && role.agentId ? String(role.agentId) : null;
  }

  // ------------------------------------------------------------- painting

  /** @param {string} text @param {string} [className] */
  function message(text, className = 'board-empty') {
    const wrap = doc.createElement('div');
    wrap.className = className;
    const line = doc.createElement('p');
    line.className = 'board-empty-head';
    line.textContent = text;
    wrap.appendChild(line);
    return wrap;
  }

  function paint() {
    opts.body.textContent = '';
    if (opts.projectEl) {
      opts.projectEl.textContent = snapshot?.project ? String(snapshot.project) : '';
    }
    if (opts.newCardEl) opts.newCardEl.hidden = !snapshot?.enabled;

    if (!cwd) {
      opts.body.appendChild(message(NO_PROJECT_LINE));
      return;
    }
    if (!snapshot) {
      opts.body.appendChild(message('Reading this project\u2019s board\u2026'));
      return;
    }
    if (!snapshot.enabled) {
      opts.body.appendChild(
        message(
          `Studio is not enabled for ${snapshot.project}. Run Studio: plan this project from ` +
            '\u2318K and you will be shown every path it would write before anything is written.',
        ),
      );
      return;
    }
    // A `board.json` that does not parse is REPORTED with its path and its
    // line, and nothing is drawn over it (§150.2 item 5). Drawing an empty
    // board here would be this surface saying there are no cards when what is
    // true is that it could not read them.
    const entry = snapshot.studio?.board;
    if (entry?.error) {
      const line = entry.line == null ? '' : ` line ${entry.line}:`;
      opts.body.appendChild(
        message(`board.json could not be read.${line} ${entry.error}`, 'board-empty board-broken'),
      );
      return;
    }
    const board = boardNow();
    const scroller = doc.createElement('div');
    scroller.className = 'board-scroll';
    if (board.cards.length === 0) scroller.appendChild(renderEmptyBoard(doc));
    else scroller.appendChild(renderBoardColumns(board, { agentIdFor }, doc));
    // The table is drawn even for an empty board: it is the accessible reading
    // of the surface, and a reading that disappeared when the answer was "none"
    // would be the one case a screen reader got nothing at all.
    scroller.appendChild(renderBoardTable(board, doc));
    opts.body.appendChild(scroller);

    for (const el of opts.body.querySelectorAll('.board-card')) bindCard(el);
    for (const drop of opts.body.querySelectorAll('.board-drop')) bindDrop(drop);
    opts.drawFaces?.(opts.body);
    if (focused) {
      const el = opts.body.querySelector(`.board-card[data-card="${cssId(focused)}"]`);
      el?.focus?.();
    }
  }

  /** A card id inside an attribute selector. Ids are `[\w.-]{1,64}` (schema). */
  function cssId(id) {
    return String(id).replace(/["\\]/g, '');
  }

  // ------------------------------------------------------------- the moves

  /**
   * Move one card to one column — the ONLY place this client writes a column.
   *
   * @param {string} cardId
   * @param {string} column
   * @param {{handOff?:boolean}} [how] `handOff` false is a move that must not
   *   start anything: the revert path, and a move the user made away from Ready.
   */
  async function moveCard(cardId, column, how = {}) {
    const card = cardById(cardId);
    if (!card || card.column === column) return;
    const was = card.column;
    // Optimistic, and the previous column is held so the revert is exact.
    card.column = column;
    focused = cardId;
    paint();
    opts.announce?.(`${card.title || cardId} moved to ${columnLabel(column)}.`);

    let body;
    try {
      const res = await get('/api/studio/card', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ cwd, op: 'move', cardId, column }),
      });
      body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
    } catch (err) {
      // THE REVERT. The card goes back where it was and the daemon's own
      // sentence is what the user reads — the board never invents a reason.
      card.column = was;
      paint();
      const line = body?.line == null ? '' : ` (line ${body.line})`;
      say(`Studio: ${err.message}${line}`, { isError: true });
      opts.announce?.(`Refused. ${card.title || cardId} is back in ${columnLabel(was)}.`);
      return;
    }
    // The daemon's board is the one that counts, so the answer replaces ours.
    if (body?.board && snapshot?.studio?.board) snapshot.studio.board.board = body.board;
    paint();
    if (column === READY_COLUMN && how.handOff !== false) await handOff(cardId);
  }

  /**
   * CARD → SESSION (§5.4).
   *
   * A card reaching Ready with an assignee *"spawns or continues that role's
   * session with the card as its brief"*, and with no assignee the board
   * *"asks which role and refuses rather than choosing"*.
   *
   *   no assignee  the card editor opens on the role control with the question
   *                above it. NOTHING is started, and the card stays in Ready —
   *                the move was the user's and is not undone by their not
   *                having answered a question yet.
   *   no session   `POST /api/studio/hire` with the card id, so the brief the
   *                role is started under is about THIS card (WP-68, §4).
   *   a session    `POST /api/send` — the existing streaming-send path, the
   *                one the composer uses — with the card as the next thing to
   *                do. Not a brief: a brief is a file written before a spawn
   *                and never under a running session (§6.1).
   *
   * @param {string} cardId
   * @returns {Promise<{asked?:boolean, hired?:boolean, sent?:boolean}>}
   */
  async function handOff(cardId) {
    const card = cardById(cardId);
    if (!card) return {};
    const role = String(card.role || '').trim();
    if (!role) {
      editor.open({
        card,
        roles: rolesNow(),
        ask:
          `${card.id} is in Ready and has no assignee. A session is started for a role, so ` +
          'name one — the board does not choose for you.',
      });
      say('Studio: that card has no assignee. Name a role and nothing is started until you do.', {
        isError: true,
      });
      return { asked: true };
    }

    const agentId = agentIdFor(role);
    const route = agentId ? '/api/send' : '/api/studio/hire';
    const payload = agentId
      ? { id: agentId, text: cardMessage(card) }
      : { cwd, role, cardId: card.id, runtime: HIRE_RUNTIME };
    try {
      const res = await get(route, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
      const refused = (body.refused || [])[0];
      if (refused) throw new Error(refused.error || refused.reason);
      say(
        agentId
          ? `${role} has ${card.id} as its next card.`
          : `${role} started on ${card.id}. It walks in on the next scan.`,
      );
      await load();
      return agentId ? { sent: true } : { hired: true };
    } catch (err) {
      // The card stays where the user put it. A hand-off that failed is a
      // session that did not start, not a move that did not happen — and
      // moving the card back would be this surface editing the board on its
      // own behalf, which is the one thing §5.2 forbids.
      say(`Studio: ${role} \u2014 ${err.message}`, { isError: true });
      return {};
    }
  }

  /** `[`, `]` and the arrows, on the focused card. */
  function nudge(cardId, direction) {
    const card = cardById(cardId);
    if (!card) return;
    const column = stepColumn(card.column, direction);
    if (!column) {
      opts.announce?.(
        direction === 1
          ? `${card.title || cardId} is already in the last column.`
          : `${card.title || cardId} is already in the first column.`,
      );
      return;
    }
    void moveCard(cardId, column);
  }

  // ------------------------------------------------------------- the wiring

  /** @param {any} el a `.board-card` */
  function bindCard(el) {
    const id = el.getAttribute('data-card');
    if (!id) return;
    el.addEventListener('click', () => {
      focused = id;
      // §5.4. The desk lights on the way out, so the click is remembered
      // rather than acted on — leaving the board IS going to the floor.
      const card = cardById(id);
      pendingSelection = card?.role ? agentIdFor(card.role) : null;
      if (card?.role && !pendingSelection) {
        say(`${card.role} is not at a desk yet \u2014 nothing to light on the floor.`);
      }
    });
    el.addEventListener('focus', () => {
      focused = id;
    });
    el.addEventListener('dblclick', () => editor.open({ card: cardById(id), roles: rolesNow() }));
    el.addEventListener('keydown', (event) => {
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      const direction = MOVE_KEYS[event.key];
      if (direction) {
        event.preventDefault();
        nudge(id, direction);
        return;
      }
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        editor.open({ card: cardById(id), roles: rolesNow() });
      }
    });
    el.addEventListener('dragstart', (event) => {
      focused = id;
      el.classList?.add?.('is-dragging');
      event.dataTransfer?.setData?.('text/plain', id);
      if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
    });
    el.addEventListener('dragend', () => el.classList?.remove?.('is-dragging'));
  }

  /** @param {any} drop a `.board-drop` */
  function bindDrop(drop) {
    const column = drop.getAttribute('data-column');
    if (!column) return;
    drop.addEventListener('dragover', (event) => {
      event.preventDefault?.();
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
      drop.classList?.add?.('is-over');
    });
    drop.addEventListener('dragleave', () => drop.classList?.remove?.('is-over'));
    drop.addEventListener('drop', (event) => {
      event.preventDefault?.();
      drop.classList?.remove?.('is-over');
      const id = event.dataTransfer?.getData?.('text/plain') || focused;
      if (id) void moveCard(String(id), column);
    });
  }

  // ------------------------------------------------------------- the editor

  /**
   * Create or edit, through the one route. The daemon's refusal is returned
   * rather than toasted, so the dialog can show it beside the field it is
   * about and keep what the user typed.
   *
   * @param {any} card the five fields
   * @param {string|null} cardId null to create
   */
  async function saveCard(card, cardId) {
    try {
      const res = await get('/api/studio/card', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(
          cardId ? { cwd, op: 'edit', cardId, card } : { cwd, op: 'create', card },
        ),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        const line = body.line == null ? '' : ` (line ${body.line})`;
        return { error: `${body.error || `HTTP ${res.status}`}${line}` };
      }
      if (body.board && snapshot?.studio?.board) snapshot.studio.board.board = body.board;
      focused = cardId || body.board?.cards?.[body.board.cards.length - 1]?.id || null;
      paint();
      return {};
    } catch (err) {
      return { error: String(err?.message || err) };
    }
  }

  // ------------------------------------------------------------- lifecycle

  /** Re-read this project's Studio snapshot. A GET, and it writes nothing. */
  async function load() {
    const found = project();
    cwd = found?.cwd || '';
    if (!cwd) {
      snapshot = null;
      paint();
      return;
    }
    try {
      const res = await get(`/api/studio?project=${encodeURIComponent(cwd)}`);
      const body = res.ok ? await res.json() : null;
      // The floor may have moved on while that was in flight. A board drawn
      // under another project's name is worse than no board at all.
      if (cwd !== (project()?.cwd || '')) return;
      snapshot = body;
    } catch {
      snapshot = null;
    }
    paint();
  }

  function openBoard() {
    if (open) {
      void load();
      return;
    }
    open = true;
    pendingSelection = null;
    opts.stageEl?.classList?.add?.('is-studio-board');
    opts.host.hidden = false;
    paint();
    opts.host.focus?.();
    void load();
    opts.announce?.('The Studio board. Six columns, oldest first inside each.');
  }

  function closeBoard() {
    if (!open) return;
    open = false;
    opts.stageEl?.classList?.remove?.('is-studio-board');
    opts.host.hidden = true;
    // The body, not the host: the host carries the chrome, and emptying it
    // would delete the ✕ that was just clicked (WP-84, §156.1).
    opts.body.textContent = '';
    // §5.4's desk, lit on the way back to the floor.
    if (pendingSelection) select(pendingSelection);
    pendingSelection = null;
    opts.announce?.('The floor.');
  }

  function toggle() {
    if (open) closeBoard();
    else openBoard();
  }

  wireSurfaceControls(opts.host, () => closeBoard());
  opts.newCardEl?.addEventListener?.('click', () => editor.open({ roles: rolesNow() }));

  return {
    open: openBoard,
    close: closeBoard,
    toggle,
    isOpen: () => open,
    refresh: load,
    moveCard,
    handOff,
    nudge,
    saveCard,
    editor,
  };
}

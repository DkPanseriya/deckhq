/**
 * The three Studio artefacts, as a small block above the transcript — WP-67,
 * `docs/07-STUDIO-DESIGN.md` §2 and §3.
 *
 * A planner session's output is FILES, not transcript (§2, Grill). So the one
 * thing the panel has to say about a Studio project that it cannot say any
 * other way is: are the three files there, do they validate, and where is the
 * one that does not. Three rows, one line each, and a link into the editor.
 *
 * ## What it is not
 *
 * It is not the board. `board.json`'s cards are WP-69's tab, and drawing a
 * column here would be a second place a card lives. It is not a writer either:
 * nothing in this file POSTs an artefact, and the only request it makes that
 * is not a GET is `/api/open-in-editor`, which spawns the user's editor through
 * the daemon's own allowlist and touches no file itself.
 *
 * It is not drawn at all unless the session's project has granted Studio
 * consent, which is off by default everywhere (§1). `GET /api/studio` is how
 * that is found out, and it is the one request this part makes per panel open.
 *
 * Every string below is set with `textContent`. The error text in a `problem`
 * row is a validator message carrying a path and a line out of a file the user
 * or a planner wrote, so it is text and is never treated as markup
 * (`02-ARCHITECTURE.md` §9).
 */

import { currentId, displayedAgent } from './panel-state.js';

/**
 * THE BOARD IS REACHED BY A DYNAMIC IMPORT, AND THAT IS NOT AN ACCIDENT.
 *
 * `board-ui.js` is a DOM module: it reaches `app-state.js`, whose `el` table
 * is built from `document.getElementById` at module scope. A STATIC import of
 * it here would make this file — and `panel.js`, which builds this part —
 * impossible to load under `node --test`, and four test files that have
 * nothing to do with Studio (`permission-keys`, `rates`, `studio-roster-ui`,
 * `subagents`) would fail at import with `document is not defined` before a
 * single assertion ran. They did, for exactly one commit.
 *
 * So the opener arrives the way `panel-header.js` reaches the rig and
 * `app-floor.js` reaches the renderer: `await import()` at the moment of use.
 * The pure half of this file (`artefactState`, `artefactLine`, `roleLine`)
 * stays importable in a bare Node process, which is what those tests assert
 * against.
 */
async function openStudioBoard() {
  const mod = await import('./board-ui.js');
  mod.openStudioBoard();
}

/** @typedef {ReturnType<typeof import('./panel-dom.js').buildPanelDom>} PanelDom */

/**
 * The three files, in the order §3's table names them, with the snapshot key
 * each one's status lives under.
 */
export const ARTEFACTS = [
  { name: 'blueprint.md', key: 'blueprint', what: 'the plan' },
  { name: 'roster.json', key: 'roster', what: 'the roles' },
  { name: 'board.json', key: 'board', what: 'the cards' },
];

/**
 * One artefact's state, as the three words the block draws.
 *
 * Pure, so the rule can be asserted without a browser:
 *
 *   `absent`   no file. Not an error — a plan nobody has written yet.
 *   `valid`    present, and this build understands it.
 *   `problem`  present, and it does not validate. Carries the reason and,
 *              when the raw text gave one, the line.
 *
 * @param {any} entry the snapshot's `blueprint` / `roster` / `board` object
 * @returns {{state:'absent'|'valid'|'problem', error:string|null, line:number|null}}
 */
export function artefactState(entry) {
  if (!entry || !entry.present) return { state: 'absent', error: null, line: null };
  if (entry.error) {
    return { state: 'problem', error: String(entry.error), line: entry.line ?? null };
  }
  return { state: 'valid', error: null, line: null };
}

/** The one line a row says, after its filename. */
export function artefactLine(status) {
  if (status.state === 'absent') return 'not written yet';
  if (status.state === 'valid') return 'valid';
  return status.line == null ? status.error : `line ${status.line} — ${status.error}`;
}

/**
 * ONE LINE PER ROLE — WP-68, §4.
 *
 * The block already says whether `roster.json` parses. This says what is IN it,
 * which is the question the three artefact rows cannot answer: who has been
 * hired, and who is still a name on a list.
 *
 * Four states, and they are different things:
 *
 *   `not hired`   no `agentId`, or one the scan no longer sees. A role whose
 *                 terminal the user closed reads this way within one scan,
 *                 which is right: it has no session, and Hire will start one.
 *   `hired`       a live session, and its id, because the id is what the user
 *                 types into every other surface that takes one.
 *   `unverified`  hired on Codex, Gemini CLI or OpenCode. §4's own sentence,
 *                 said here rather than implied: a Codex role cannot raise a
 *                 permission card and reports liveness from file mtime, so a
 *                 line that drew it exactly like a Claude Code one would be
 *                 claiming something nobody has measured.
 *   `cannot hire` a name git will not take a branch from. The daemon's own
 *                 `refusal`, so the user can go and fix `roster.json`.
 *
 * Pure, so `test/unit/panel-studio.test.mjs` drives it without a browser.
 *
 * @param {any} role one entry of `GET /api/studio`'s `roles`
 * @returns {{state:'hired'|'unverified'|'not-hired'|'refused', line:string}}
 */
export function roleLine(role) {
  if (role?.hireable === false) {
    return { state: 'refused', line: role.refusal || 'this name cannot be a branch' };
  }
  if (!role?.live) return { state: 'not-hired', line: 'not hired' };
  const id = role.agentId ? ` — ${role.agentId}` : '';
  if (role.unverified) return { state: 'unverified', line: `hired, unverified${id}` };
  return { state: 'hired', line: `hired${id}` };
}

/**
 * @param {PanelDom & {toast:(m:string, o?:{isError?:boolean}) => void}} ctx
 */
export function createStudioPart(ctx) {
  const { studioSection, studioList, studioNote, toast } = ctx;

  /** The project directory the block currently describes, or null. */
  let shownFor = null;

  /**
   * Ask whether this session's project has Studio on, and what its three files
   * look like. A GET, of three small files on the user's own disk, once per
   * panel open. It reads no ack state and writes nothing — see the INVARIANT
   * note at the top of `panel.js`.
   *
   * Every `GET /api/studio` re-reads the files from disk, so this is also the
   * whole of the artefact watch: there is nothing cached to go stale.
   *
   * @param {{id?:string, cwd?:string}} agent
   */
  function loadStudio(agent) {
    const cwd = agent?.cwd || '';
    const id = agent?.id || null;
    shownFor = null;
    studioSection.hidden = true;
    if (!cwd) return;
    fetch(`/api/studio?project=${encodeURIComponent(cwd)}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((body) => {
        // The panel may have moved on, or been closed, while that was in
        // flight. A block describing somebody else's project is worse than no
        // block at all.
        if (!body || currentId !== id) return;
        if (!body.enabled) return;
        shownFor = cwd;
        render(body);
      })
      .catch(() => {
        /* Studio is off, or the daemon is busy. The block stays away. */
      });
  }

  /** @param {any} body the `GET /api/studio` response */
  function render(body) {
    studioList.textContent = '';
    const snapshot = body.studio || {};
    for (const artefact of ARTEFACTS) {
      const status = artefactState(snapshot[artefact.key]);
      const row = document.createElement('div');
      row.className = `studio-row studio-row--${status.state}`;

      const name = document.createElement('span');
      name.className = 'studio-file mono';
      name.textContent = artefact.name;

      const state = document.createElement('span');
      state.className = 'studio-state';
      state.textContent = artefactLine(status);

      row.append(name, state);

      // Open in the editor. The client sends a path relative to the project
      // and never a command: which program that means is the daemon's
      // decision, from `src/core/editor.mjs`'s allowlist.
      const open = document.createElement('button');
      open.type = 'button';
      open.className = 'studio-open';
      open.textContent = '[ open ]';
      open.disabled = status.state === 'absent';
      open.setAttribute('aria-label', `Open ${artefact.name} in your editor`);
      open.addEventListener('click', () => openArtefact(artefact.name, status.line));
      row.appendChild(open);

      // WP-69, §5.4. `board.json` is the one artefact this product can DRAW,
      // so its row carries the way to it. Beside `[ open ]` rather than
      // instead of it: the file is still the user's to edit, and the board is
      // a second reading of it rather than a replacement for the text.
      if (artefact.key === 'board') {
        const board = document.createElement('button');
        board.type = 'button';
        board.className = 'studio-open';
        board.textContent = '[ board ]';
        board.disabled = status.state !== 'valid';
        board.setAttribute('aria-label', 'Open the Studio board for this project');
        board.addEventListener('click', () => void openStudioBoard());
        row.appendChild(board);
      }

      studioList.appendChild(row);
    }

    // WP-68. The roster, under the three files, one line per role. Only when
    // there is one: an empty roster is a project the planner has not finished
    // with, and a heading over nothing would be a promise of a list.
    const roles = Array.isArray(body.roles) ? body.roles : [];
    for (const [index, role] of roles.entries()) {
      const status = roleLine(role);
      const row = document.createElement('div');
      row.className =
        `studio-row studio-row--role studio-role--${status.state}` +
        (index === 0 ? ' studio-row--role-first' : '');

      const name = document.createElement('span');
      name.className = 'studio-file';
      name.textContent = String(role?.name || '');

      const state = document.createElement('span');
      state.className = 'studio-state';
      // A validator message and an agent id, both out of files the user or a
      // planner wrote. `textContent`, never markup (`02-ARCHITECTURE.md` §9).
      state.textContent = status.line;

      row.append(name, state);
      studioList.appendChild(row);
    }

    const problems = Array.isArray(snapshot.problems) ? snapshot.problems.length : 0;
    studioNote.textContent = problems
      ? `${problems} of the three files does not validate. Nothing was rewritten; the file is as it was written.`
      : 'Written by the planner. Yours to edit — DeckHQ reads these files and never rewrites them.';
    studioNote.classList.toggle('is-warn', problems > 0);
    studioSection.hidden = false;
  }

  /**
   * @param {string} name one of the three filenames
   * @param {number|null} line
   */
  async function openArtefact(name, line) {
    const id = currentId;
    if (!id || !shownFor) return;
    try {
      const res = await fetch('/api/open-in-editor', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        // Relative to the project, so the daemon's own containment check is
        // what decides the path — the same one the changed-files list uses.
        body: JSON.stringify({ id, file: `.deckhq/studio/${name}`, line: line || 1 }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
      toast(`Opened ${name} in ${body.label || 'your editor'}`);
    } catch (err) {
      toast(`Could not open in editor: ${err.message}`, { isError: true });
    }
  }

  /** Re-read the three files for the session on screen, if there is one. */
  function refreshStudio() {
    if (!currentId || !displayedAgent) return;
    loadStudio(displayedAgent);
  }

  return { loadStudio, refreshStudio, openArtefact };
}

/**
 * The Studio board, as the page's one of it — WP-69, `docs/07-STUDIO-DESIGN.md` §5.
 *
 * `./board-view.js` is the picture and is pure. `./board-ui.js` is the
 * controller and takes everything it touches as an argument, so it can be
 * driven under `node --test`. THIS file is the half that can only exist in a
 * browser: the elements `index.html` ships, the shell's live region, the
 * renderer that draws a card's face, and the single instance the two doors in
 * (⌘K's `Studio: board`, the panel's `[ board ]`) both reach.
 *
 * ============================================================================
 * WHY IT IS A SEPARATE FILE, AND NOT A SECTION OF `board-ui.js`
 *
 * `app-state.js` builds its `el` table from `document.getElementById` at module
 * scope, which is right for a shell that only ever runs in a page and fatal for
 * anything a test wants to import. While the singleton lived beside the
 * controller, `import './board-ui.js'` reached `app-state.js`, and four test
 * files that have nothing to do with Studio — `permission-keys`, `rates`,
 * `studio-roster-ui`, `subagents` — died at import with `document is not
 * defined` before a single assertion ran.
 *
 * So the line is drawn where `look-ui.js` draws it: the DOM-free half is
 * importable and tested (`test/unit/board-ui.test.mjs` drives a keyboard move,
 * a refusal and its revert, and the hand-off in all three of its shapes), and
 * the half that reads a global lives here, where nothing but the page imports
 * it.
 *
 * It builds itself on first use rather than being wired from `app.js`, which
 * stands at WP-22's 900-line ceiling and has nothing to add to a surface that
 * is hidden on every floor in the product as it ships (§1).
 * ============================================================================
 */

import {
  announce,
  currentProject,
  latestSnapshot,
  palette,
  selectAgent,
  toast,
} from './app-state.js';
import { createBoardUI } from './board-ui.js';

/** @type {ReturnType<typeof createBoardUI>|null} */
let theBoard = null;

/** Build it once, over the elements `index.html` ships. */
function board() {
  if (theBoard) return theBoard;
  const host = document.getElementById('studio-board');
  const body = document.getElementById('studio-board-body');
  if (!host || !body) return null;
  theBoard = createBoardUI({
    host,
    body,
    projectEl: document.getElementById('board-project'),
    newCardEl: document.getElementById('board-new-card'),
    helpEl: document.getElementById('board-help'),
    hintEl: document.getElementById('board-hint'),
    stageEl: document.querySelector('.stage'),
    // The shell's own live region, deduped, so the board speaks where every
    // other surface speaks rather than into a second one of its own.
    announce,
    // The room the floor is filtered to, else the project of the session in
    // the panel — `app-state.js`'s one answer, so the palette and the board
    // act on the same repo (WP-67, WP-69).
    getProject: currentProject,
    onSelect: selectAgent,
    notify: toast,
    drawFaces,
  });
  return theBoard;
}

/** Open the Studio board on the project in view. */
export function openStudioBoard() {
  board()?.open();
}

/** Close it. Escape's route in, from `app-keys.js`. */
export function closeStudioBoard() {
  board()?.close();
}

/** Is it up? `app-keys.js` asks before spending an Escape on it. */
export function studioBoardOpen() {
  return Boolean(theBoard?.isOpen());
}

// ----------------------------------------------------------------- the face
//
// §4: a hired agent is the same character on the board, the floor and the deck,
// and a face is a pure function of the session id (§105). So a card's face is
// drawn by the SAME `rig.drawCharacter()` the floor and the panel's close-up
// use, from the same identity and appearance — never a second drawing of a
// robot. A role with no live session has no canvas at all (`board-view.js`),
// because it has no session id and therefore has no face.
//
// One static pose, drawn once per paint. Nothing animates: §9 of the GUI spec
// gives the floor the right to move and gives chrome beside it none.

/** @type {any} */
let rig = null;
/** @type {any} */
let clips = null;
let facesLoaded = false;

async function loadFaceModules() {
  if (facesLoaded) return;
  facesLoaded = true;
  try {
    rig = await import('./render/rig.js');
  } catch (err) {
    console.debug('[deckhq] render/rig.js not available for the board', err);
  }
  try {
    clips = await import('./render/clips.js');
  } catch (err) {
    console.debug('[deckhq] render/clips.js not available for the board', err);
  }
}

/** @param {any} root the painted board */
function drawFaces(root) {
  const canvases = [...root.querySelectorAll('canvas.board-face')];
  if (canvases.length === 0) return;
  if (!rig?.drawCharacter || !clips?.sampleClip) {
    void loadFaceModules().then(() => {
      if (rig?.drawCharacter && clips?.sampleClip) drawFaces(root);
    });
    return;
  }
  for (const canvas of canvases) {
    const id = canvas.getAttribute('data-agent');
    const agent = (latestSnapshot?.agents || []).find((a) => a.id === id);
    if (!agent) continue;
    const ctx = canvas.getContext?.('2d');
    if (!ctx) continue;
    try {
      const pose = clips.sampleClip('type', 0, true);
      rig.drawCharacter(ctx, pose, {
        x: canvas.width / 2,
        y: canvas.height * 0.96,
        u: canvas.height / 2.9,
        lod: 2,
        color: palette?.STATE_COLORS?.[agent.activityState] || '#888888',
        state: agent.activityState,
        walking: false,
        seconds: 0,
        label: null,
        icon: null,
        badge: null,
        selected: false,
        identity: palette?.identityFor?.(agent.projectMk, agent.avatar),
        appearance: palette?.appearanceOf?.(agent),
      });
    } catch (err) {
      console.debug('[deckhq] drawCharacter failed on a board card', err);
    }
  }
}

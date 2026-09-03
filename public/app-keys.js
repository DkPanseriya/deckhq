/**
 * The floor keyboard map: which key does what.
 *
 * Split out of `app.js` by WP-22. Every key here resolves to something the
 * composition root owns, and the root hands those in through `wireKeyboard()`
 * at boot. That is why they are module-level `let`s with the names the map
 * already used: the alternative — importing them back from `app.js` — would
 * make this module and its own entry point mutually dependent, for no gain.
 * Nothing here runs before `wireKeyboard`, because nothing here runs until a
 * key is pressed.
 *
 * The two listeners stay in `app.js`, at the line they were on. The panel's
 * own keydown listener must still run BEFORE this one — that is what lets a
 * permission card take `A`, `D` and `S` while it is up and let them fall
 * through when it is not — and listener order is registration order.
 * `test/unit/permission-keys.test.mjs` asserts the rule; moving the
 * registration would have silently inverted it.
 */

import {
  ZOOM_KEY_STEP,
  deckUI,
  el,
  openCard,
  panel,
  scene,
  selectAgent,
  selectNextGoneHome,
} from './app-state.js';

/** @type {() => boolean} */
let dismissCard = () => false;
/** @type {() => void} */
let hideWhiteboard = () => {};
/** @type {() => void} */
let toggleRedaction = () => {};
/** @type {() => void} */
let saveCard = () => {};
/** @type {() => void} */
let takeSnapshot = () => {};
/** @type {() => void} */
let floatOffice = () => {};
/** @type {any} */
let paletteUI = null;

/**
 * Hand the map the actions it fires. Called once, from `app.js`, before the
 * listeners are registered.
 * @param {{dismissCard:() => boolean, hideWhiteboard:() => void,
 *   toggleRedaction:() => void, saveCard:() => void, takeSnapshot:() => void,
 *   floatOffice:() => void, paletteUI:any}} actions
 */
export function wireKeyboard(actions) {
  ({
    dismissCard,
    hideWhiteboard,
    toggleRedaction,
    saveCard,
    takeSnapshot,
    floatOffice,
    paletteUI,
  } = actions);
}

/**
 * Which agent the action keys act on.
 *
 * On the floor that is the panel's own selection and the panel decides for
 * itself, so this passes nothing. In the deck it is the row under the cursor,
 * which is very often not the row the panel is showing: WP-10's whole point is
 * that `1`, `2` and `3` clear an item without opening it first
 * (docs/plan/05-GUI-UX-SPEC.md §3.2).
 * @returns {string|null}
 */
export function keyTarget() {
  return deckUI?.isOpen() ? deckUI.cursor() : null;
}

/**
 * The whole floor keyboard map, docs/03-VISUAL-SPEC.md §8. Deliberately
 * inert whenever focus is inside a text control (the composer or any
 * `<input>`/`<textarea>`/contenteditable), or while a modal `<dialog>` is
 * open, so typing "j" into a message never benches an agent.
 * @param {KeyboardEvent} e
 */
export function handleKeydown(e) {
  const target = /** @type {HTMLElement|null} */ (e.target);
  const tag = target?.tagName;
  const isTyping = tag === 'INPUT' || tag === 'TEXTAREA' || Boolean(target?.isContentEditable);
  if (isTyping) return;
  if (document.querySelector('dialog[open]')) return;
  if (e.ctrlKey || e.metaKey || e.altKey) return;

  // `Tab` toggles the floor and the deck (§3.2) — but Tab is also how a
  // keyboard user moves between controls, and taking it globally would strand
  // them. It is claimed only while focus is on the floor itself (the canvas,
  // the stage, the deck) or on nothing in particular, and never with Shift
  // held, so tabbing out of the deck, the strip, the header or the panel keeps
  // working exactly as it did. Shift+Tab is always the browser's.
  if (e.key === 'Tab' && !e.shiftKey) {
    const active = /** @type {HTMLElement|null} */ (document.activeElement);
    const onFloor = !active || active === document.body || Boolean(active.closest?.('.stage'));
    if (!onFloor) return;
    deckUI?.toggle();
    e.preventDefault();
    return;
  }

  // In the deck, `Enter` is what opens a row; `J`/`K` only move the cursor.
  if (e.key === 'Enter' && deckUI?.isOpen()) {
    deckUI.openCursor();
    e.preventDefault();
    return;
  }

  switch (e.key) {
    case 'Escape':
      // The day's card is the topmost thing there is (WP-18): §3.3 promises
      // that dismissing it costs one keystroke, so it takes Escape ahead of
      // everything, and a second Escape does whatever it would have done.
      if (dismissCard()) break;
      // The whiteboard overlay is the most transient thing on screen — a
      // second Esc still deselects, but the first one only ever closes
      // whatever is topmost. docs' whiteboard note: "closes ... on Esc".
      if (!el.whiteboardOverlay.hidden) {
        hideWhiteboard();
        break;
      }
      selectAgent(null);
      break;
    // One queue, walked the same way on all three levels (§3): the floor's
    // ring, the strip's chip and the deck's row are the same selection, in
    // the same oldest-first order, moved by the same code.
    case 'j':
    case 'J':
      deckUI?.move(1);
      break;
    case 'k':
    case 'K':
      deckUI?.move(-1);
      break;
    case 'a':
    case 'A':
      // Explicit keyboard action, equivalent in kind to a button press —
      // routed through panel.performAction(), the single funnel for
      // /api/ack calls. Never wired from render or selection code. In the
      // deck it names the cursor row, which is where the user is looking.
      panel.performAction('acknowledge', keyTarget());
      break;
    case 'b':
    case 'B':
      panel.performAction('bench', keyTarget());
      break;
    // The floor stops drawing a benched agent that has been quiet for longer
    // than `settings.goneHomeDays` (WP-50 / `08` B6, "N went home" on the
    // lounge plate). Nothing about their state changed — only whether they are
    // drawn — so they stay reachable: `g` selects them one at a time, newest
    // activity first, and opens the panel on each exactly as a click would.
    case 'g':
    case 'G':
      selectNextGoneHome();
      break;
    // The office snapshot (WP-14). `Shift+S` decides what the next `S`
    // contains; the shift key is read explicitly rather than inferred from
    // the case of `e.key`, so caps lock does not silently swap them.
    case 's':
    case 'S':
      if (e.shiftKey) toggleRedaction();
      // With the day's card up, `S` saves the card — the card plus a small
      // photograph of the floor it is about — rather than the floor alone.
      // It is the thing on the screen, so it is the thing the key is about.
      else if (openCard) saveCard();
      else takeSnapshot();
      break;
    // The review card's weighted actions (docs/plan/05-GUI-UX-SPEC.md §4.2):
    // 1 focuses the composer, 2 approves (a send), 3 benches. On the floor
    // the panel ignores them while it is closed; in the deck they act on the
    // cursor row without opening it (§3.2). The `isTyping` guard above keeps
    // them inert while the composer has focus.
    case '1':
    case '2':
    case '3':
      panel.pressNumberKey(e.key, keyTarget());
      break;
    // Magnification (VISUAL-SPEC §1, 05-LAYOUT-REWORK.md §2.4). `0` returns
    // to fit, which is also the minimum — there is no zooming out past the
    // whole floor.
    case '+':
    case '=':
      if (scene) scene.zoomBy(ZOOM_KEY_STEP);
      break;
    case '-':
    case '_':
      if (scene) scene.zoomBy(1 / ZOOM_KEY_STEP);
      break;
    case '0':
      if (scene) scene.resetZoom();
      break;
    // WP-39's floating mini-floor: the office, the corridor beside it and the
    // count, over the terminal (`08` B3). The palette's "Float the office" is
    // the other way in. Not awaited — the module is loaded on demand and a
    // slow import must not hold the key map.
    case 'p':
    case 'P':
      floatOffice();
      break;
    default:
      return;
  }
  e.preventDefault();
}

/**
 * The palette's own accelerator, handled before the floor map because that
 * map deliberately ignores anything with a modifier held. `⌘K` on a Mac,
 * `Ctrl+K` everywhere else — and both are accepted on both, because a person
 * on a Mac with an external PC keyboard should not have to care.
 * @param {KeyboardEvent} e
 */
export function handlePaletteKey(e) {
  if (e.key !== 'k' && e.key !== 'K') return;
  if (!e.ctrlKey && !e.metaKey) return;
  if (e.altKey) return;
  e.preventDefault();
  if (paletteUI.isOpen()) paletteUI.close();
  else paletteUI.open();
}

/**
 * Onboarding: three coach marks on real elements, and nothing else.
 *
 * `docs/plan/05-GUI-UX-SPEC.md` §7, WP-13. What this replaces was a modal
 * `<dialog>` listing all six states with a paragraph each — about 190 words
 * of reading, in front of the floor, before the person had seen the floor do
 * anything. `docs/plan/04-ENGAGEMENT-AND-GAMIFICATION.md` §5 puts a hard limit
 * on modals ("any modal that appears more than once" is on the refuse list),
 * and §7 puts the budget at fifteen seconds against an activation target of
 * sixty.
 *
 * So: three marks, in sequence, each anchored to the thing it is talking
 * about. The needs-you numeral, then your office, then one waiting agent.
 * `Escape` skips all three and records `onboarded`, forever. Finishing them
 * records the same thing — there is exactly one "you have seen this" bit and
 * both routes set it.
 *
 * This module is split the way `palette.js` and `markdown.js` are: the parts
 * worth testing need no DOM. `COACH_MARKS`, `markText`, `visibleMarks`,
 * `advance` and `readingSeconds` are pure; `createCoachMarks` is the only
 * function that touches an element.
 *
 * Every string that reaches the page goes through `textContent`. There is no
 * `innerHTML` here.
 */

/**
 * Average adult silent reading speed for prose on a screen, in words per
 * minute. Deliberately at the slow end of the measured range (roughly
 * 175–300 wpm depending on the study and the material) because the budget
 * this feeds is a promise, and a promise costed at the optimistic end is not
 * one. `test/unit/coach-marks.test.mjs` asserts the whole sequence clears
 * §7's fifteen seconds at this speed.
 */
export const READING_WPM = 200;

/** §7's budget: total reading time for all three marks. */
export const READING_BUDGET_S = 15;

/**
 * The three marks, in order.
 *
 * `anchor` names what the mark points at, not how to find it — `element`
 * anchors resolve to a CSS selector in this document, `floor` anchors are a
 * region of the canvas and are resolved by the caller (see `createCoachMarks`'s
 * `anchorFor`), because only `app.js` knows whether the renderer has loaded.
 *
 * `needs` is the condition under which the mark has anything to point at. A
 * mark whose anchor is not on screen is dropped rather than shown pointing at
 * nothing — a coach mark that lies about where something is, is worse than no
 * coach mark.
 *
 * @type {ReadonlyArray<{id:string, anchor:{kind:'element',selector:string}|{kind:'floor',target:'office'|'agent'}, needs:'always'|'waiting', place:'below'|'above'|'auto'}>}
 */
export const COACH_MARKS = Object.freeze([
  {
    id: 'needs-you',
    anchor: { kind: 'element', selector: '#needs-you-total' },
    needs: 'always',
    place: 'below',
  },
  {
    id: 'office',
    anchor: { kind: 'floor', target: 'office' },
    needs: 'always',
    place: 'auto',
  },
  {
    id: 'waiting-agent',
    anchor: { kind: 'floor', target: 'agent' },
    needs: 'waiting',
    place: 'auto',
  },
]);

/**
 * What each mark says.
 *
 * §7's copy, verbatim, with one concession the spec's example already implies:
 * the first line carries the live count, so it has to read correctly at 0, 1
 * and many. None of the three variants places fault on the reader
 * (`04` §5) — "7 waiting", never "you have left 7 waiting" — and the second
 * half of the sentence, which is the actual lesson, is identical in all three.
 *
 * @param {string} id
 * @param {{needsYou?: number}} [ctx]
 * @returns {string}
 */
export function markText(id, ctx = {}) {
  const n = Math.max(0, Number(ctx.needsYou) || 0);
  switch (id) {
    case 'needs-you':
      if (n === 0) {
        return "Nothing is waiting on you right now. This number is yours. The runtime can't clear it.";
      }
      return (
        `${n} session${n === 1 ? ' is' : 's are'} waiting on you. ` +
        "This number is yours. The runtime can't clear it."
      );
    case 'office':
      return (
        'They finished and walked in here. ' +
        "Reading a message doesn't send them away — only you do."
      );
    case 'waiting-agent':
      return 'Click anyone.';
    default:
      return '';
  }
}

/**
 * Which marks can actually be shown against this floor.
 *
 * @param {{needsYou?: number, hasFloor?: boolean}} ctx
 * @param {ReadonlyArray<any>} [marks]
 * @returns {any[]}
 */
export function visibleMarks(ctx, marks = COACH_MARKS) {
  const hasFloor = ctx.hasFloor !== false;
  return marks.filter((m) => {
    // Both floor marks need a floor to point at. On a machine whose renderer
    // failed to load there is no office and no agent on screen, and the first
    // mark — which is chrome, and always there — carries the tour alone.
    if (m.anchor.kind === 'floor' && !hasFloor) return false;
    if (m.needs === 'waiting') return (Number(ctx.needsYou) || 0) > 0;
    return true;
  });
}

/**
 * How long the sequence takes to read, in seconds, at `READING_WPM`.
 * @param {ReadonlyArray<{id:string}>} marks
 * @param {{needsYou?: number}} [ctx]
 * @returns {number}
 */
export function readingSeconds(marks, ctx = {}) {
  const words = marks.reduce(
    (sum, m) => sum + markText(m.id, ctx).trim().split(/\s+/).filter(Boolean).length,
    0,
  );
  return (words / READING_WPM) * 60;
}

/**
 * @typedef {object} CoachState
 * @property {number} index  which mark is showing; equals `total` when finished
 * @property {boolean} done
 * @property {boolean} skipped  finished by `Escape` rather than by reading it
 */

/** @returns {CoachState} */
export function initialState() {
  return { index: 0, done: false, skipped: false };
}

/**
 * The whole sequence, as a reducer.
 *
 * `skip` ends it wherever it is; `next` walks forward and ends it after the
 * last mark. Both end states set `done`, and `done` is what makes the caller
 * record `onboarded` — there is one bit, and it does not matter which route
 * set it. An event arriving after `done` changes nothing, so a stray Escape
 * cannot re-open a finished tour or double-post the setting.
 *
 * @param {CoachState} state
 * @param {'next'|'skip'} event
 * @param {number} total
 * @returns {CoachState}
 */
export function advance(state, event, total) {
  if (state.done) return state;
  if (event === 'skip') return { index: total, done: true, skipped: true };
  if (event === 'next') {
    const index = state.index + 1;
    return index >= total
      ? { index: total, done: true, skipped: false }
      : { index, done: false, skipped: false };
  }
  return state;
}

/** Where a card of `size` can sit against `anchor` without leaving `view`. */
const CARD_GAP = 14;

/** How far the highlight ring stands off the thing it is around, in px. */
const RING_PAD = 5;

/**
 * Place a card next to its anchor, clamped to the viewport.
 *
 * Pure, and exported because "the card ran off the bottom of a short window"
 * is a defect that is invisible in every unit test that does not do this
 * arithmetic somewhere it can be asserted.
 *
 * @param {{x:number,y:number,w:number,h:number}} anchor  viewport coordinates
 * @param {{w:number,h:number}} card
 * @param {{w:number,h:number}} view
 * @param {'below'|'above'|'auto'|'inside'} prefer  `inside` centres the card
 *   within the anchor instead of beside it — for an anchor so large that
 *   "beside" is meaningless, which is what the whole-canvas fallback is
 * @returns {{x:number, y:number, side:'below'|'above'|'none'}}
 */
export function placeCard(anchor, card, view, prefer = 'auto') {
  if (prefer === 'inside') {
    // Slightly above the middle: the floor's own quiet line sits at the
    // bottom of the stage (`.demo-note`), and two overlapping cards is worse
    // than one that is not perfectly centred.
    const x = Math.max(8, Math.min(anchor.x + (anchor.w - card.w) / 2, view.w - card.w - 8));
    const y = Math.max(8, Math.min(anchor.y + anchor.h * 0.36, view.h - card.h - 8));
    return { x, y, side: 'none' };
  }
  const below = anchor.y + anchor.h + CARD_GAP;
  const above = anchor.y - card.h - CARD_GAP;
  const fitsBelow = below + card.h <= view.h;
  const fitsAbove = above >= 0;
  let side = /** @type {'below'|'above'} */ ('below');
  if (prefer === 'above') side = fitsAbove ? 'above' : 'below';
  else if (prefer === 'below') side = fitsBelow || !fitsAbove ? 'below' : 'above';
  else side = fitsBelow ? 'below' : fitsAbove ? 'above' : 'below';

  const y = side === 'below' ? below : above;
  // Centred on the anchor, then pulled back inside the window. A card that is
  // wider than the window pins to the left edge rather than going negative.
  const wanted = anchor.x + anchor.w / 2 - card.w / 2;
  const x = Math.max(8, Math.min(wanted, Math.max(8, view.w - card.w - 8)));
  return { x, y: Math.max(8, Math.min(y, Math.max(8, view.h - card.h - 8))), side };
}

/**
 * The DOM half.
 *
 * @param {object} opts
 * @param {HTMLElement} opts.layer            the (empty) host element, hidden by default
 * @param {Document} [opts.doc]
 * @param {() => any} opts.getSnapshot
 * @param {(anchor:{kind:string,target?:string,selector?:string}) => ({x:number,y:number,w:number,h:number, arrow?:boolean}|null)} opts.anchorFor
 * @param {(result:{skipped:boolean}) => void} opts.onDone   record `onboarded`
 * @param {(text:string) => void} [opts.announce]
 */
export function createCoachMarks(opts) {
  const doc = opts.doc || document;
  const { layer, getSnapshot, anchorFor, onDone } = opts;
  const announce = opts.announce || (() => {});

  /** @type {any[]} */
  let marks = [];
  /** @type {CoachState} */
  let state = initialState();
  let running = false;
  /** @type {HTMLElement|null} */
  let card = null;

  function ctx() {
    const snapshot = getSnapshot();
    return {
      needsYou: snapshot?.counts?.needsYou ?? 0,
      hasFloor: Boolean(snapshot?.agents?.length),
    };
  }

  function clear() {
    while (layer.firstChild) layer.removeChild(layer.firstChild);
    card = null;
  }

  function finish(skipped) {
    if (!running) return;
    running = false;
    clear();
    layer.hidden = true;
    doc.removeEventListener('keydown', onKeydown, true);
    if (typeof window !== 'undefined') window.removeEventListener('resize', reposition);
    onDone({ skipped });
  }

  /** @param {'next'|'skip'} event */
  function step(event) {
    state = advance(state, event, marks.length);
    if (state.done) return finish(state.skipped);
    paint();
  }

  /** @param {KeyboardEvent} e */
  function onKeydown(e) {
    if (!running) return;
    if (e.key === 'Escape') {
      // Captured before app.js's floor map, which would otherwise deselect
      // the panel on the same press. Escape during the tour means one thing.
      e.preventDefault();
      e.stopPropagation();
      step('skip');
    }
  }

  function reposition() {
    if (!running || !card) return;
    const mark = marks[state.index];
    if (!mark) return;
    const anchor = anchorFor(mark.anchor);
    const view = {
      w: typeof window !== 'undefined' ? window.innerWidth : 1280,
      h: typeof window !== 'undefined' ? window.innerHeight : 800,
    };
    const box = card.getBoundingClientRect
      ? card.getBoundingClientRect()
      : { width: 300, height: 120 };
    const size = { w: box.width || 300, h: box.height || 120 };
    if (!anchor) {
      card.style.left = `${Math.round((view.w - size.w) / 2)}px`;
      card.style.top = `${Math.round((view.h - size.h) / 2)}px`;
      card.dataset.side = 'none';
      return;
    }
    // An anchor with no honest pointer is one the renderer could not resolve
    // to a region — the whole-canvas fallback. Sit inside it rather than
    // beside it, and draw no arrow.
    const at = placeCard(anchor, size, view, anchor.arrow === false ? 'inside' : mark.place);
    card.style.left = `${Math.round(at.x)}px`;
    card.style.top = `${Math.round(at.y)}px`;
    card.dataset.side = at.side;
    // The spotlight is a ring around the anchor rather than a scrim over
    // everything else: the floor is the thing being explained, so covering it
    // to point at part of it would be self-defeating.
    const ring = /** @type {HTMLElement|null} */ (layer.querySelector('.coach-ring'));
    if (ring && ring.style) {
      ring.hidden = anchor.arrow === false;
      // Grown outwards, in script rather than by CSS margin: the global
      // `box-sizing: border-box` makes a negative margin shift a sized box
      // instead of expanding it, which put the ring's own border through the
      // "NEEDS YOU" label it was supposed to be surrounding.
      ring.style.left = `${Math.round(anchor.x - RING_PAD)}px`;
      ring.style.top = `${Math.round(anchor.y - RING_PAD)}px`;
      ring.style.width = `${Math.round(anchor.w + RING_PAD * 2)}px`;
      ring.style.height = `${Math.round(anchor.h + RING_PAD * 2)}px`;
    }
  }

  function paint() {
    clear();
    const mark = marks[state.index];
    if (!mark) return finish(false);

    const ring = doc.createElement('div');
    ring.className = 'coach-ring';
    ring.setAttribute('aria-hidden', 'true');
    layer.appendChild(ring);

    card = doc.createElement('div');
    card.className = 'coach-card';
    card.setAttribute('role', 'dialog');
    card.setAttribute('aria-label', `Getting started, ${state.index + 1} of ${marks.length}`);

    const body = doc.createElement('p');
    body.className = 'coach-text';
    body.textContent = markText(mark.id, ctx());
    card.appendChild(body);

    const foot = doc.createElement('div');
    foot.className = 'coach-foot';

    const count = doc.createElement('span');
    count.className = 'coach-count';
    count.textContent = `${state.index + 1} / ${marks.length}`;
    foot.appendChild(count);

    const skip = doc.createElement('button');
    skip.type = 'button';
    skip.className = 'link-btn coach-skip';
    skip.textContent = 'Skip';
    skip.addEventListener('click', () => step('skip'));
    foot.appendChild(skip);

    const next = doc.createElement('button');
    next.type = 'button';
    next.className = 'btn btn--primary coach-next';
    next.textContent = state.index === marks.length - 1 ? 'Got it' : 'Next';
    next.addEventListener('click', () => step('next'));
    foot.appendChild(next);

    card.appendChild(foot);
    layer.appendChild(card);
    layer.hidden = false;

    // Focus so Enter advances and the reader is told where they are. Guarded:
    // a stub DOM in a test has no focus().
    if (typeof next.focus === 'function') next.focus();
    announce(body.textContent);
    reposition();
  }

  return {
    /** Begin, or begin again from the palette's "Onboarding again". */
    start() {
      marks = visibleMarks(ctx());
      if (marks.length === 0) return onDone({ skipped: false });
      state = initialState();
      running = true;
      doc.addEventListener('keydown', onKeydown, true);
      if (typeof window !== 'undefined') window.addEventListener('resize', reposition);
      paint();
    },
    /** True while a mark is on screen. */
    isRunning() {
      return running;
    },
    /** Re-place the current card — the floor moved under it. */
    reposition,
    /** For tests and for teardown. */
    stop() {
      finish(true);
    },
  };
}

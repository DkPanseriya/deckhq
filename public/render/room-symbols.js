/**
 * THE ROOM SYMBOLS — one small drawn set, for a room's status strip.
 *
 * A room's header says what is going on in it with an icon and a number in a
 * fixed slot, and no words (the owner, 11 October: "We define symbols for
 * everything, so user gets used to it and it becomes intuitive"). So the set
 * is small, every symbol is a different SHAPE — a state is never told by its
 * colour alone — and each means one thing wherever it appears. The words for
 * each live in `SYMBOLS[name].means`, which is what a header's tooltip says.
 *
 * DRAWN, not set: paths in the canvas's own units, no font and no emoji, so a
 * symbol is the same symbol on every machine and at every scale. Each is drawn
 * inside a square of half-side `r` about `(cx, cy)`, in one colour, at one
 * stroke weight (`symbolStroke`).
 *
 * Three of them are the marks the floor already taught: the hand a figure
 * raises (`hand`), the tick over a figure waiting for review (`check`) and the
 * hourglass over a stalled one (`hourglass`).
 *
 * Imports nothing: a test, the symbol sheet and the header all read one table.
 */

const TAU = Math.PI * 2;

/** The stroke a symbol of half-side `r` is drawn in, in the context's pixels. */
export const symbolStroke = (/** @type {number} */ r) => Math.max(1, r * 0.3);

/**
 * Every symbol: what it means, in the words a tooltip uses, and whether it is
 * a state's own mark (so it may take that state's colour).
 * @type {Readonly<Record<string, Readonly<{means:string, state?:string}>>>}
 */
export const SYMBOLS = Object.freeze({
  bell: Object.freeze({ means: 'need you: waiting on an answer or a review' }),
  bars: Object.freeze({ means: 'working', state: 'working' }),
  hourglass: Object.freeze({ means: 'stalled', state: 'stalled' }),
  hand: Object.freeze({ means: 'hands up, asking you something', state: 'needs_input' }),
  check: Object.freeze({ means: 'finished, waiting for your review', state: 'for_review' }),
  coin: Object.freeze({ means: 'tokens spent today' }),
  moon: Object.freeze({ means: 'resting' }),
  home: Object.freeze({ means: 'went home' }),
  pin: Object.freeze({ means: 'pinned: this room stays when it is empty' }),
});

/** Every symbol's name, in the order the sheet shows them. */
export const SYMBOL_NAMES = Object.freeze(Object.keys(SYMBOLS));

/**
 * Draw one symbol. Leaves the context's line settings changed, as every
 * painter on this floor does; touches no transform.
 * @param {CanvasRenderingContext2D} ctx
 * @param {string} name one of `SYMBOL_NAMES`
 * @param {number} cx @param {number} cy its centre
 * @param {number} r half the side of the square it is drawn in
 * @param {string} colour
 */
export function drawSymbol(ctx, name, cx, cy, r, colour) {
  const w = symbolStroke(r);
  ctx.strokeStyle = colour;
  ctx.fillStyle = colour;
  ctx.lineWidth = w;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const X = (/** @type {number} */ x) => cx + x * r;
  const Y = (/** @type {number} */ y) => cy + y * r;
  ctx.beginPath();
  switch (name) {
    case 'bell':
      // A dome on a flared rim, and the clapper under it.
      ctx.moveTo(X(-0.85), Y(0.45));
      ctx.lineTo(X(-0.6), Y(0.1));
      ctx.quadraticCurveTo(X(-0.62), Y(-0.9), X(0), Y(-0.9));
      ctx.quadraticCurveTo(X(0.62), Y(-0.9), X(0.6), Y(0.1));
      ctx.lineTo(X(0.85), Y(0.45));
      ctx.closePath();
      ctx.fill();
      ctx.beginPath();
      ctx.arc(X(0), Y(0.78), r * 0.2, 0, TAU);
      ctx.fill();
      return;
    case 'bars':
      // Three lines of output, as on a working robot's visor.
      ctx.moveTo(X(-0.8), Y(-0.6));
      ctx.lineTo(X(0.35), Y(-0.6));
      ctx.moveTo(X(-0.8), Y(0));
      ctx.lineTo(X(0.8), Y(0));
      ctx.moveTo(X(-0.8), Y(0.6));
      ctx.lineTo(X(0.05), Y(0.6));
      ctx.stroke();
      return;
    case 'hourglass':
      ctx.moveTo(X(-0.62), Y(-0.85));
      ctx.lineTo(X(0.62), Y(-0.85));
      ctx.lineTo(X(-0.62), Y(0.85));
      ctx.lineTo(X(0.62), Y(0.85));
      ctx.closePath();
      ctx.stroke();
      return;
    case 'check':
      ctx.moveTo(X(-0.8), Y(0.05));
      ctx.lineTo(X(-0.25), Y(0.62));
      ctx.lineTo(X(0.85), Y(-0.62));
      ctx.stroke();
      return;
    default:
      drawMore(ctx, name, X, Y, r, cx, cy);
  }
}

/**
 * The symbols that are not a state's own mark: the people, the money, the
 * places and the pin.
 * @param {CanvasRenderingContext2D} ctx @param {string} name
 * @param {(x:number) => number} X @param {(y:number) => number} Y
 * @param {number} r @param {number} cx @param {number} cy
 */
function drawMore(ctx, name, X, Y, r, cx, cy) {
  switch (name) {
    case 'hand':
      // A raised palm: four fingers over a rounded heel, the thumb to one side.
      for (const x of [-0.45, -0.15, 0.15, 0.45]) {
        ctx.moveTo(X(x), Y(-0.1));
        ctx.lineTo(X(x), Y(x === -0.45 || x === 0.45 ? -0.62 : -0.85));
      }
      ctx.moveTo(X(-0.45), Y(-0.1));
      ctx.quadraticCurveTo(X(-0.5), Y(0.85), X(0.05), Y(0.85));
      ctx.quadraticCurveTo(X(0.5), Y(0.85), X(0.45), Y(-0.1));
      ctx.moveTo(X(0.45), Y(0.25));
      ctx.lineTo(X(0.85), Y(-0.15));
      ctx.stroke();
      return;
    case 'coin':
      // A stack of two: the top one's face, and the edge of the one under it.
      ctx.ellipse(cx, Y(-0.25), r * 0.8, r * 0.42, 0, 0, TAU);
      ctx.moveTo(X(-0.8), Y(-0.25));
      ctx.lineTo(X(-0.8), Y(0.35));
      ctx.ellipse(cx, Y(0.35), r * 0.8, r * 0.42, 0, Math.PI, 0, true);
      ctx.lineTo(X(0.8), Y(-0.25));
      ctx.stroke();
      return;
    case 'moon':
      ctx.arc(cx, cy, r * 0.85, 0.35 * Math.PI, 1.65 * Math.PI);
      ctx.quadraticCurveTo(X(0.25), Y(0), X(0.39), Y(0.76));
      ctx.closePath();
      ctx.fill();
      return;
    case 'home':
      ctx.moveTo(X(-0.9), Y(-0.05));
      ctx.lineTo(X(0), Y(-0.85));
      ctx.lineTo(X(0.9), Y(-0.05));
      ctx.moveTo(X(-0.6), Y(-0.2));
      ctx.lineTo(X(-0.6), Y(0.8));
      ctx.lineTo(X(0.6), Y(0.8));
      ctx.lineTo(X(0.6), Y(-0.2));
      ctx.stroke();
      return;
    case 'pin':
      // A round head and the needle under it, leaning as a pushed pin does.
      ctx.arc(X(0.25), Y(-0.35), r * 0.42, 0, TAU);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(X(-0.05), Y(-0.05));
      ctx.lineTo(X(-0.75), Y(0.8));
      ctx.stroke();
      return;
    default:
      // Not a symbol this build has: a dot, so a slot is never an empty hole.
      ctx.arc(cx, cy, r * 0.3, 0, TAU);
      ctx.fill();
  }
}

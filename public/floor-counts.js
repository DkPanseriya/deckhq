/**
 * The header's floor counts, as numbers and words.
 *
 * The header counts what the floor DRAWS, and each number has a place on the
 * floor where the same number is written: "at desk" is the bodies at desks,
 * "resting" is the plate on the Lounge, "went home" is the second half of
 * that plate. It used to say "benched" for the third and count only the
 * sessions you benched, while the Lounge's own plate counted everybody resting
 * in it — the benched and the ended. So a floor read
 * "9 benched" in the header over a Lounge that said "15 resting", and nothing
 * on the screen said where the other six came from.
 *
 * Pure: a snapshot's `counts` in, plain values out, so a test can hold the
 * header to the plate without a document.
 */

/**
 * @param {any} counts a snapshot's `counts`
 * @returns {{atDesk:number, finished:number, resting:number, benched:number,
 *   ended:number, wentHome:number, restingTitle:string}}
 */
export function floorCounts(counts) {
  const c = counts || {};
  const drawn = c.drawn || {};
  const num = (/** @type {any} */ v) => (Number.isFinite(Number(v)) ? Math.max(0, Number(v)) : 0);
  // `drawn` is absent from a snapshot pushed by an older daemon; the numbers it
  // did send stand in, and the two halves of "resting" are then both "benched".
  const benched = num(drawn.benched ?? c.benched);
  const resting = num(drawn.lounge ?? benched);
  const ended = Math.max(0, resting - benched);
  return {
    atDesk: num(drawn.atDesk ?? c.atDesk),
    finished: num(drawn.finished),
    resting,
    benched,
    ended,
    wentHome: num(drawn.wentHome),
    restingTitle: restingTitle(benched, ended),
  };
}

/**
 * What "resting" is made of, for the tooltip and for a screen reader.
 * @param {number} benched sessions you sent to the bench
 * @param {number} ended sessions that have ended and owe you nothing
 */
export function restingTitle(benched, ended) {
  const parts = [];
  if (benched > 0) parts.push(`${benched} you benched`);
  if (ended > 0) parts.push(`${ended} ended`);
  return parts.length ? `In the Lounge: ${parts.join(', ')}.` : 'Nobody is in the Lounge.';
}

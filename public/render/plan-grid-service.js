/**
 * WHAT THE SERVICE ROOMS NEED, measured off their own builders.
 *
 * `plan-grid.js` lays the building. Before it can, it has to know what the
 * reception and the lounge ask of it: how wide the reception's queue runs at a
 * depth, how deep it comes out at a width, the narrowest lounge that seats its
 * people inside a band — and, where a floor is held to its caps
 * (`plan-proportions.js` (f) and (g)), what each of them is when it has given
 * something up. Those are questions for `plan-office.js` and
 * `plan-service.js`, asked many times over one search, so the answers are
 * kept.
 *
 * Moved here whole from `plan-grid.js`, which was at the line ceiling.
 *
 * Pure geometry. No DOM, no clock, no randomness.
 */

import { buildOffice, buildOfficeRow } from './plan-office.js';
import { buildLounge, loungeOneRowBelow } from './plan-service.js';
import { LOUNGE_MIN_H } from './plan-units.js';
import { LOUNGE_AREA_MAX, OFFICE_AREA_MAX } from './plan-proportions.js';

const EPS = 1e-6;

/**
 * A reception laid at its contents, against one held at its cap (0). There is
 * no third: the reception gives way to its CAP and to nothing else. Laid
 * narrower so that the rooms beside it could have the width, nineteen people
 * waiting stood shoulder to shoulder in a room a twentieth of the building and
 * eight of their names had nowhere to be drawn — and who is waiting on you is
 * the one thing this floor is for.
 */
export const OFFICE_FULL = 1;

/** The lounge is measured on whole units of width, between these. */
const LOUNGE_W_MIN = 20;
const LOUNGE_W_MAX = 240;

/**
 * Everything one floor asks of its two service rooms.
 * @param {number} waitingCount agents in the reception's queue
 * @param {number} benchedCount people the lounge is asked to hold
 * @param {number} goneHomeCount benched and not drawn; the lounge plate's
 * @param {boolean} [quiet] size the two by who is in them: one sofa run, one bay
 * @param {boolean} [graded] and, past that, a run and a bay at a time
 */
export function measureService(
  waitingCount,
  benchedCount,
  goneHomeCount,
  quiet = false,
  graded = false,
) {
  /** A quiet floor's service rooms are sized by who is in them (`plan-office.js`). */
  const compact = quiet === true;
  // The reception on its side, at a depth: as wide as its queue's sofa runs.
  /** @type {Map<number, {w:number,h:number}>} */
  const officeRows = new Map();
  const officeRowAt = (/** @type {number} */ d) => {
    let got = officeRows.get(d);
    if (!got) {
      const r = buildOfficeRow(waitingCount, { w: 0, h: d }, { compact, graded }).room;
      got = { w: r.w, h: r.h };
      officeRows.set(d, got);
    }
    return got;
  };
  // The reception upright. The width its queue asks for — a sofa place a head
  // round three walls — and, at a width, how deep it comes out: at its
  // contents, or HELD to that width with whoever its sofas cannot seat standing.
  const officeWide = Math.ceil(
    buildOffice(waitingCount, undefined, { compact, graded }).room.w - EPS,
  );
  /** @type {Map<string, {w:number,h:number}>} */
  const officeCols = new Map();
  const officeColAt = (/** @type {number} */ w, hold = false) => {
    const key = `${w}|${hold ? 1 : 0}`;
    let got = officeCols.get(key);
    if (!got) {
      const r = buildOffice(waitingCount, { w, h: 0 }, { maxW: w, hold, compact, graded }).room;
      got = { w: r.w, h: r.h };
      officeCols.set(key, got);
    }
    return got;
  };
  /**
   * THE RECEPTIONS A BAND MAY GIVE, at a depth, fullest first
   * (`plan-proportions.js` (f)). Its contents — a sofa place for everybody
   * waiting — where that is inside its share of the building. And where it is
   * not, and the floor is being held to its caps, the one AT the cap: its sofa
   * runs as long as that room's walls, the rest of the queue standing.
   * @param {number} d @param {number} area @param {boolean} capped
   * @returns {{w:number, hold:boolean, tier:number}[]}
   */
  const officesInBand = (d, area, capped) => {
    const cap = (OFFICE_AREA_MAX * area) / d;
    const want = officeRowAt(d);
    const out = [];
    if (want.h <= d + EPS && want.w <= cap + EPS) {
      out.push({ w: want.w, hold: false, tier: OFFICE_FULL });
    }
    if (!capped || out.length) return out;
    const r = buildOfficeRow(waitingCount, { w: cap, h: d }, { hold: true }).room;
    if (r.w <= cap + EPS && r.h <= d + EPS) out.push({ w: cap, hold: true, tier: 0 });
    return out;
  };
  // The lounge at a width, with at most so many games tables: how deep its
  // bays and its one standing row come out, and how many it SEATS. Two answers
  // per width, because a lounge too shallow for a second shelf gives a bay up
  // rather than wrapping it (§3.7), and a bay given up is seats given up.
  /** @type {Map<number, {w:number,h:number,seats:number,games:number}>} */
  const lounges = new Map();
  const loungeAt = (
    /** @type {number} */ w,
    /** @type {boolean} */ oneRow,
    /** @type {number} */ games,
  ) => {
    const key = (w * 2 + (oneRow ? 1 : 0)) * 16 + (Number.isFinite(games) ? games : 15);
    let got = lounges.get(key);
    if (!got) {
      const fit = { w, h: oneRow ? LOUNGE_MIN_H : 0 };
      const built = buildLounge(benchedCount, fit, goneHomeCount, 1, {
        maxGames: games,
        quiet: compact,
        graded,
      });
      const n = built.room.natural || { w: built.room.w, h: built.room.h };
      const seats = built.loungeSpots.reduce(
        (a, sp) => a + (sp.kind === 'chat' ? 0 : Math.max(1, sp.capacity ?? 1)),
        0,
      );
      got = { w: n.w, h: n.h, seats, games: built.games };
      lounges.set(key, got);
    }
    return got;
  };
  // A LOUNGE IS ITS CONTENTS WHEN IT SEATS ITS PEOPLE: enough bays for everyone
  // resting, or every bay it has where they are more than it can seat. Five
  // people do not need a games room laid for them to be a lounge.
  const whole = loungeAt(LOUNGE_W_MAX, false, Infinity);
  const seatsWanted = Math.min(benchedCount, whole.seats);
  // WHAT A FLOOR KEPT OF ITS SERVICE ROOMS, as one number to compare two ways
  // of laying it by: the reception's tier first — a seat for somebody waiting
  // on you is what the product is for — and the lounge's games tables after.
  const keptOf = (/** @type {number} */ tier, /** @type {number} */ games) => tier * 10 + games;
  const wholeKept = keptOf(OFFICE_FULL, whole.games);
  // The narrowest whole-unit lounge that holds its bays inside a depth, with
  // at most `games` tables, seating everybody it should where `seated` is set.
  const loungeWidthFor = (
    /** @type {number} */ d,
    /** @type {number} */ games,
    /** @type {boolean} */ seated,
  ) => {
    const oneRow = d < loungeOneRowBelow();
    const holds = (/** @type {number} */ w) => {
      const got = loungeAt(w, oneRow, games);
      return got.h <= d + EPS && got.w <= w + EPS && (!seated || got.seats >= seatsWanted);
    };
    if (!holds(LOUNGE_W_MAX)) return Infinity;
    let lo = LOUNGE_W_MIN;
    let hi = LOUNGE_W_MAX;
    while (lo < hi) {
      const mid = Math.floor((lo + hi) / 2);
      if (holds(mid)) hi = mid;
      else lo = mid + 1;
    }
    return lo;
  };
  /**
   * THE LOUNGES A BAND MAY GIVE, at a depth, inside its share of the building,
   * fullest first. Its contents where they fit under the cap. And, where the
   * floor is being held to its caps, the ones that are less than that: one
   * games table fewer at a time, the people it would have seated behind a
   * chip. The rooms beside it decide which of them the row has width for.
   * @param {number} d @param {number} area @param {boolean} capped
   * @param {number} least the fewest games tables worth returning
   * @returns {{w:number, games:number, kept:number}[]}
   */
  const loungesInBand = (d, area, capped, least) => {
    const cap = (LOUNGE_AREA_MAX * area) / d;
    const out = [];
    const want = loungeWidthFor(d, Infinity, true);
    if (want <= cap + EPS) out.push({ w: want, games: Infinity, kept: whole.games });
    if (!capped) return out;
    for (let games = whole.games - 1; games >= least; games--) {
      const w = loungeWidthFor(d, games, false);
      // Fewer tables is not a narrower lounge once its bays are a second shelf.
      if (w <= cap + EPS && !out.some((o) => o.w <= w + EPS)) out.push({ w, games, kept: games });
    }
    return out;
  };
  return {
    officeWide,
    officeColAt,
    officesInBand,
    loungeAt,
    loungesInBand,
    whole,
    seatsWanted,
    keptOf,
    wholeKept,
  };
}

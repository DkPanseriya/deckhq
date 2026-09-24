/**
 * The budget stop — the ONE system write to a card's column, and the whole of
 * what it may do.
 *
 * `docs/07-STUDIO-DESIGN.md` §5.2 and §8. The column is user-owned state, on
 * the discipline `ackState` obeys (`docs/01-PRODUCT.md` §2): an observed event
 * may flag a card and may never move it. A column changes on exactly two
 * things — the user dragging or pressing, which arrives at
 * `POST /api/studio/card`, and the function below.
 *
 * This one is allowed because it is a **stop and not progress**. A card whose
 * ledger cost has crossed its cap goes to `blocked`, which is the one place
 * this function can send anything: it cannot advance a card, cannot complete
 * one, and cannot put one back. `test/unit/studio-invariant.test.mjs` asserts
 * that by reading this file, so the constant below is the only column value
 * that may appear in it.
 *
 * WHAT IT DOES NOT DO, said here rather than discovered later. It does not
 * kill the process. A session opened in a terminal is not the daemon's child,
 * there is no supervisor, and `SendHub.shutdown()` already records at
 * `docs/DEVIATIONS.md` §115 what a parent can and cannot promise about a
 * child. §8 is explicit: DeckHQ refuses to send that session further work and
 * posts one message asking it to stop and write a handover — and that is all
 * it can honestly claim.
 *
 * WP-66 shipped the funnel and WP-71 is what calls it: `src/studio/tracking.mjs`
 * folds the ledger per card, `crossedBudget()` there says which cap a card has
 * crossed, and `src/http/routes/studio-drift.mjs` calls this, writes the
 * board, refuses sends and posts the one message. It is the THIRD column
 * writer in the tree and the only one no person presses; the static gate in
 * `test/unit/studio-invariant.test.mjs` names all three with a reason on each.
 *
 * It records the move as well (`appendMove`), in the same statement, so §7's
 * "time on the card" ends where the stop began rather than running on.
 */
import { BLOCKED_COLUMN, MAX_FLAGS, appendMove } from './schema.mjs';

/**
 * Move one card to `blocked` because its cap was crossed, and flag it with
 * the reason.
 *
 * Pure apart from the mutation of the card it is handed: no I/O, no clock of
 * its own, no message. The caller (WP-71) reads the ledger, decides, persists
 * the board through `StudioStore.writeBoard()`, and posts the one message.
 *
 * @param {{cards:Array<any>}} board the board to change, in place
 * @param {string} cardId which card crossed its cap
 * @param {{text:string, at:number}} reason what was spent, and when it was noticed
 * @returns {{moved:boolean, card:any|null}} `moved:false` when the card is
 *   already blocked, so a repeated pass cannot post a second message
 */
export function blockForBudget(board, cardId, reason) {
  const card = (board?.cards || []).find((c) => c && c.id === cardId) || null;
  if (!card) return { moved: false, card: null };
  if (card.column === BLOCKED_COLUMN) return { moved: false, card };

  const at = Number(reason?.at) || 0;
  card.moves = appendMove(card.moves, card.column, BLOCKED_COLUMN, at);
  card.column = BLOCKED_COLUMN;
  const flags = [
    ...(Array.isArray(card.flags) ? card.flags : []),
    { kind: 'budget', text: String(reason?.text || ''), at },
  ];
  card.flags = flags.slice(-MAX_FLAGS);
  card.updatedAt = at || card.updatedAt || 0;
  return { moved: true, card };
}

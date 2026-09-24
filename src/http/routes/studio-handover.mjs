/**
 * The handover watch and the review gate — WP-70,
 * `docs/07-STUDIO-DESIGN.md` §6.
 *
 * Two things live here, and the line between them is the whole package.
 *
 * ## 1. The watch, which flags and never moves
 *
 * `<project>/.deckhq/studio/handovers/` is watched for every project that has
 * granted Studio consent. On a new or changed file the card named by the
 * filename is **flagged** — `{kind:'handover', at, path}` — and its
 * `handover` field is pointed at the file. That is all an observed event may
 * ever do to a board (§5.2): *"A session ending, a test passing, a file
 * appearing, a budget being spent: each writes `flags` and nothing else."*
 * There is no column write on this path, at all, and
 * `test/unit/studio-invariant.test.mjs` reads this file and fails if one
 * appears.
 *
 * A handover whose filename matches no card is kept and reported
 * `unattached` in `GET /api/studio` rather than dropped (§6, acceptance (3)).
 * It has nowhere to be a flag; it still has somewhere to be read.
 *
 * ## 2. `POST /api/studio/handover`, the SECOND column writer
 *
 * §5.2: *"A column changes on exactly two things — the user dragging or
 * pressing, or a handover the user has **accepted** in the review card."* The
 * first is `POST /api/studio/card`. This is the second, and there is no
 * third: both are named in the static gate, with a reason on each.
 *
 *   `{cardId, decision:'accept', column}`  the card moves to the column the
 *                                          USER named. Not a column the
 *                                          handover asked for — a handover
 *                                          does not get to ask.
 *   `{cardId, decision:'bounce', note}`    the card does NOT move. The note
 *                                          is written to
 *                                          `handovers/<cardId>.bounce.md`,
 *                                          which the next brief reads (§6.1),
 *                                          and is kept on the card as a flag
 *                                          so the board shows that it bounced.
 *
 * Neither decision runs anything, sends anything or reads a transcript. A
 * bounce does not message the agent: the note joins the brief, and whether
 * that role is working again is a Hire, which is a press of its own.
 */

import fsp from 'node:fs/promises';
import path from 'node:path';

import { sendError, sendJson } from '../server.mjs';
import { now as clockNow } from '../../core/clock.mjs';
import { StudioStore } from '../../studio/store.mjs';
import { COLUMNS, MAX_FLAGS, validateBoard } from '../../studio/schema.mjs';
import { DIRS } from '../../studio/paths.mjs';
import { bounceRel } from '../../studio/brief-role.mjs';
import { cardIdForName, handoverFlag, watchHandovers } from '../../studio/handover.mjs';

/**
 * The columns **Accept** may name.
 *
 * §6: *"presses Accept handover (the card moves where the user names)"*, and
 * §10's acceptance (2): *"Accept is the only path from a handover to a column
 * change"*. Two of the six, because the other four are not where an accepted
 * piece of work goes — `backlog`, `ready` and `in_progress` are places work
 * has not finished, and `blocked` is §8's stop, which is the budget's to
 * write and nobody else's. A request naming one of those is refused WITH the
 * two that are allowed, rather than clamped to the nearest.
 */
export const ACCEPT_COLUMNS = /** @type {const} */ (['review', 'done']);

/** How long a bounce note may be. A note, not a document. */
export const MAX_NOTE_CHARS = 2000;

/**
 * Put the handover flag on its card, without ever moving it.
 *
 * Idempotent by (path, at): the watch reports every file on its first tick,
 * so a daemon restarted twice must not leave three identical flags behind.
 * A handover REWRITTEN by the agent is a different `at` and is a new flag,
 * which is right — it is a second handover on the same card.
 *
 * Pure over the board it is given; the caller writes it.
 *
 * @param {{cards:Array<any>}} board
 * @param {string} cardId
 * @param {{path:string, at:number, name:string}} file
 * @returns {{flagged:boolean, card:any}}
 */
export function flagHandover(board, cardId, file) {
  const card = (board?.cards || []).find((c) => String(c?.id) === String(cardId)) || null;
  if (!card) return { flagged: false, card: null };
  const flags = Array.isArray(card.flags) ? card.flags : [];
  const already = flags.some(
    (f) => f?.kind === 'handover' && f?.path === file.path && Number(f?.at) === Number(file.at),
  );
  // The card's `handover` field is the filename the brief reads back (§6.1),
  // so it is pointed at this file whether or not the flag is new.
  card.handover = file.name;
  if (already) return { flagged: false, card };
  // Oldest first out, at the ceiling: a card with 32 handovers is a card
  // somebody needs to look at, and losing the newest would be the wrong one
  // to lose.
  const next = [...flags, handoverFlag(file.path, file.at)];
  card.flags = next.length > MAX_FLAGS ? next.slice(next.length - MAX_FLAGS) : next;
  return { flagged: true, card };
}

/**
 * Wire the watch and the route.
 *
 * @param {import('../server.mjs').Router} router
 * @param {{store:any, log:any}} ctx
 * @param {{projectFromBody:(req:any,res:any)=>Promise<any>,
 *          consentFor:(key:string)=>any,
 *          watchOptions?:{pollMs?:number, debounceMs?:number}}} helpers
 * @returns {{watchProject:(root:string)=>void, stop:() => void,
 *            settled:() => Promise<any>}}
 */
export function registerHandover(router, ctx, helpers) {
  const { store } = ctx;
  /** projectKey → stop function. One watch per consented project. */
  const watches = new Map();
  /**
   * Board writes, one after another.
   *
   * Two handovers landing in one tick is two read-modify-writes of the same
   * `board.json`, and two of those in flight is one lost flag. `studio-hire`
   * chains its roster writes for the same reason and in the same shape.
   * @type {Promise<any>}
   */
  let chain = Promise.resolve();
  const enqueue = (fn) => {
    chain = chain.then(fn).catch((err) => {
      ctx.log.warn('studio handover', err?.message || err);
    });
    return chain;
  };

  /**
   * One tick's worth of changed files, folded onto the board.
   * @param {string} root
   * @param {Array<{name:string, path:string, mtime:number}>} files
   */
  function onHandovers(root, files) {
    enqueue(async () => {
      const studio = new StudioStore(root, { log: ctx.log });
      const current = studio.readBoard();
      if (current.error) {
        // A board that does not parse is REPORTED, never replaced (§150.2
        // item 5). The handover is still on disk and still in the snapshot.
        ctx.log.warn(`studio board for ${root} does not parse; handover flags wait`);
        return;
      }
      const board = { ...current.board, cards: current.board.cards.map((c) => ({ ...c })) };
      let touched = false;
      for (const file of files) {
        const id = cardIdForName(file.name);
        if (!id) continue;
        const done = flagHandover(board, id, { ...file, at: file.mtime });
        // An unknown card id is not an error and is not invented: the file is
        // in the snapshot as `unattached`, which is where the user sees it.
        if (!done.card) {
          ctx.log.info(`studio handover ${file.name} names no card on ${root}; unattached`);
          continue;
        }
        touched = true;
      }
      if (!touched) return;
      const check = validateBoard(board, { raw: null });
      if ('error' in check) {
        ctx.log.warn(`studio handover flag refused by the board's own validator: ${check.error}`);
        return;
      }
      await studio.writeBoard(check.board);
    });
  }

  /**
   * Start watching one project's handovers, if it is not watched already.
   * @param {string} root
   */
  function watchProject(root) {
    const studio = new StudioStore(root, { log: ctx.log });
    const key = studio.projectKey;
    if (watches.has(key)) return;
    // Claimed before the await, so two calls in one tick start one watch.
    watches.set(key, () => {});
    const dir = studio.pathOf(DIRS.handovers);
    watchHandovers(dir, {
      onChange: (files) => onHandovers(root, files),
      pollMs: helpers.watchOptions?.pollMs,
      debounceMs: helpers.watchOptions?.debounceMs,
    }).then(
      (stop) => {
        if (!watches.has(key)) return stop();
        watches.set(key, stop);
      },
      (err) => {
        watches.delete(key);
        ctx.log.warn(`studio could not watch ${dir}`, err?.message || err);
      },
    );
  }

  // Every project that has already granted consent, at startup. A handover
  // written while the daemon was not running is still a handover nobody has
  // reviewed.
  for (const grant of Object.values(store.studioConsent?.() || {})) {
    if (grant?.root) watchProject(String(grant.root));
  }

  // -------------------------------------------------------------------------
  // POST /api/studio/handover — Accept, and Bounce
  // -------------------------------------------------------------------------

  router.post('/api/studio/handover', async (req, res) => {
    const found = await helpers.projectFromBody(req, res);
    if (!found) return;
    const { root, projectKey, body } = found;
    if (!helpers.consentFor(projectKey)) {
      return sendError(
        res,
        403,
        `Studio is not enabled for ${root}. POST /api/studio/enable with { confirm: true } first; ` +
          'consent is per project and is never inferred from another.',
      );
    }

    const decision = typeof body.decision === 'string' ? body.decision.trim() : '';
    if (!['accept', 'bounce'].includes(decision)) {
      return sendError(res, 400, 'decision is one of accept or bounce');
    }
    const cardId = typeof body.cardId === 'string' ? body.cardId.trim() : '';

    const studio = new StudioStore(root, { log: ctx.log });
    const current = studio.readBoard();
    if (current.error) {
      return sendJson(res, 409, {
        error: current.error,
        path: current.errorPath,
        line: current.line,
      });
    }
    const board = {
      ...current.board,
      projectKey,
      cards: current.board.cards.map((c) => ({ ...c })),
    };
    const index = board.cards.findIndex((c) => String(c.id) === cardId);
    if (index === -1) {
      return sendError(
        res,
        404,
        `there is no card called "${cardId}". A handover naming a card this board does not have ` +
          'is shown unattached; it is not accepted onto one.',
      );
    }
    const at = clockNow();
    const before = board.cards[index];

    /** @type {string|null} */
    let noteFile = null;
    if (decision === 'accept') {
      const target = typeof body.column === 'string' ? body.column.trim() : '';
      if (!(/** @type {readonly string[]} */ (ACCEPT_COLUMNS).includes(target))) {
        return sendError(
          res,
          400,
          `Accept moves a card to ${ACCEPT_COLUMNS.join(' or ')}, and this named "${target}". ` +
            `The six columns are ${COLUMNS.join(', ')}; the other four are not where accepted ` +
            'work goes, and a drag is how a card reaches them.',
        );
      }
      // THE SECOND COLUMN WRITE IN THE TREE, and the user's own press. The
      // handover asked for nothing: this column is the one they named.
      board.cards[index] = { ...before, column: target, updatedAt: at };
    } else {
      const note = String(body.note ?? '').trim();
      if (!note) {
        return sendError(
          res,
          400,
          'a bounce carries a note. Sending the card back with no reason is the thing this ' +
            'review exists to stop.',
        );
      }
      if (note.length > MAX_NOTE_CHARS) {
        return sendError(res, 400, `a bounce note is at most ${MAX_NOTE_CHARS} characters`);
      }
      // The note is a FILE, because §6.1's brief reads one: the third part of
      // every role brief is "the previous handover and any bounce note".
      try {
        noteFile = await studio.writeText(bounceRel(cardId), `# Bounced\n\n${note}\n`);
      } catch (err) {
        ctx.log.warn('studio bounce note', err?.message || err);
        return sendError(res, 400, err?.message || String(err));
      }
      // And a flag, so the BOARD says it bounced. The card does not move.
      const flags = Array.isArray(before.flags) ? [...before.flags] : [];
      flags.push({ kind: 'bounce', text: note.slice(0, 500), at });
      board.cards[index] = {
        ...before,
        flags: flags.length > MAX_FLAGS ? flags.slice(flags.length - MAX_FLAGS) : flags,
        updatedAt: at,
      };
    }

    const check = validateBoard(board, { raw: null });
    if ('error' in check) {
      return sendJson(res, 400, { error: check.error, path: check.path, line: check.line });
    }
    const written = await studio.writeBoard(check.board);
    if ('error' in written) {
      return sendJson(res, 400, { error: written.error, path: written.path, line: written.line });
    }
    return sendJson(res, 200, {
      ok: true,
      decision,
      cardId,
      moved: decision === 'accept',
      note: noteFile,
      board: written.board,
      file: written.file,
    });
  });

  return {
    watchProject,
    settled: () => chain,
    stop: () => {
      for (const stop of watches.values()) {
        try {
          stop();
        } catch {
          // already stopped
        }
      }
      watches.clear();
    },
  };
}

/**
 * The bounce note on disk for one card, or null — read by nothing here, and
 * exported because `test/integration/studio-handover.test.mjs` asserts the
 * file the next brief will read rather than the response that wrote it.
 * @param {string} root
 * @param {string} cardId
 */
export async function readBounce(root, cardId) {
  const studio = new StudioStore(root);
  try {
    return await fsp.readFile(studio.pathOf(bounceRel(cardId)), 'utf8');
  } catch {
    return null;
  }
}

/** `handovers/<cardId>.md`, relative to the studio directory. */
export function handoverRel(cardId) {
  return path.join(DIRS.handovers, `${cardId}.md`);
}

/**
 * Tracking, the PM pass and the budget stop — WP-71,
 * `docs/07-STUDIO-DESIGN.md` §7 and §8.
 *
 *   GET  /api/studio/tracking?project=   §7's numbers, per card and per milestone
 *   POST /api/studio/pm-pass             `{cwd}` — a PM pass now, rather than on the half hour
 *
 * Three things live here, and they are the half of Studio that ACTS, so each
 * is written down with what it may not do.
 *
 * ## 1. Tracking reads, and writes nothing
 *
 * `src/studio/tracking.mjs` is the fold; this route hands it the ledger, the
 * board, the roster and the handovers and returns what it says. A GET never
 * writes a board — `test/integration/studio-board.test.mjs` hashes one
 * across a read.
 *
 * ## 2. The PM pass flags, and never acts
 *
 * On the injected clock, every 30 minutes and on demand, the planner — WP-67's
 * session, continued through `startTurn()`, the same send path the composer
 * uses — is handed the blueprint, the board and the handovers since the last
 * pass, and answers with flags. They are written to the cards' `flags` and to
 * nothing else. The answer ending the planner's turn is what puts the planner
 * in the needs-you queue: the existing review card, raised by the existing
 * scan, with nothing added to it here.
 *
 * ## 3. The budget stop: Blocked, refuse, one message, kill nothing
 *
 * §8's hard stop, and all it can honestly be. When a card in `in_progress`
 * crosses its cap — tokens or minutes, whichever first (§11.5) —
 * `blockForBudget()` moves it to `blocked`, the ONE system write to a column
 * in the tree; `POST /api/send` refuses that session further work, with the
 * card and the cap named, for as long as the card sits in Blocked because of
 * it; and exactly one message is posted to the session asking it to stop and
 * write a handover. DeckHQ never kills the process: a session opened in a
 * terminal is not the daemon's child, and there is no line on this path that
 * sends a signal to anything — `test/unit/studio-drift.test.mjs` reads this
 * file for one, and runs a stop against a real child that outlives it.
 */
import { readAll } from '../../core/ledger.mjs';
import { now as clockNow } from '../../core/clock.mjs';
import { loadRateCard } from '../../core/rates.mjs';
import { sendError, sendJson } from '../server.mjs';
import { startTurn } from '../send-turn.mjs';
import { StudioStore } from '../../studio/store.mjs';
import { BLOCKED_COLUMN, validateBoard } from '../../studio/schema.mjs';
import { DIRS } from '../../studio/paths.mjs';
import { readHandovers } from '../../studio/handover.mjs';
import { WORK_COLUMN, agentOfCard, trackBoard } from '../../studio/tracking.mjs';
import { blockForBudget } from '../../studio/budget.mjs';
import {
  applyFlags,
  createPmSchedule,
  parseFlags,
  pmMessage,
  PM_INTERVAL_MS,
} from '../../studio/pm-pass.mjs';

/**
 * How often the daemon looks at the clock. Elapsed-time machinery, so it is
 * `setInterval` on the real clock; every DECISION it drives — is a pass due,
 * has a card been on its column too long — is made on `clockNow()`, which a
 * test or a capture can pin.
 */
export const DRIFT_TICK_MS = 60 * 1000;

/**
 * The one message the budget stop posts. Fixed words; the card id, the cap
 * and the handover path are the only things put into it.
 *
 * @param {string} cardId
 * @param {string} spent the crossing, as `crossedBudget()` wrote it
 * @param {string} handoverPath where the handover goes
 */
export function stopMessage(cardId, spent, handoverPath) {
  return [
    `DeckHQ budget stop: card ${cardId} has crossed its budget (${spent}).`,
    'Please stop work on it now, and write your handover to',
    `${handoverPath}`,
    'with what changed, the tests you ran and their real counts, open questions, and the next step.',
    'DeckHQ will send this session no further work until the card is moved out of Blocked or its',
    'budget is raised. This is the only message DeckHQ will send about it.',
  ].join('\n');
}

/**
 * Whether this card is in Blocked BECAUSE of the budget stop, and still.
 *
 * The newest move is into `blocked` and the stop's flag carries the same
 * instant. A card the user dragged to Blocked themselves is not a budget
 * stop, and a card the stop blocked that the user has since moved on is not
 * one any more — both of those are the user's column, and the file says so.
 *
 * @param {any} card
 */
export function budgetStopped(card) {
  if (card?.column !== BLOCKED_COLUMN) return null;
  const moves = Array.isArray(card.moves) ? card.moves : [];
  const last = moves[moves.length - 1];
  if (!last || last.to !== BLOCKED_COLUMN) return null;
  const flag = (card.flags || []).find(
    (f) => f?.kind === 'budget' && Number(f.at) === Number(last.at),
  );
  return flag || null;
}

/**
 * @param {import('../server.mjs').Router} router
 * @param {{store:any, log:any, registry?:any, adapters?:any, sends?:any, ledger?:any,
 *          ratesFile?:string, studioTickMs?:number, studioSendRefusal?:any}} ctx
 * @param {{projectFromBody:(req:any,res:any)=>Promise<any>,
 *          consentFor:(key:string)=>any,
 *          resolveProject:(raw:unknown)=>any}} helpers
 * @returns {{tick:() => Promise<any>,
 *            checkBudgets:(root:string, records?:() => Promise<any[]>) => Promise<any[]>,
 *            runPass:(root:string) => Promise<any>, stop:() => void}}
 */
export function registerDrift(router, ctx, helpers) {
  const { store, log } = ctx;

  /** Every consented project, `projectKey → root`. Read, never cached. */
  const consented = () => {
    /** @type {Map<string, string>} */
    const out = new Map();
    for (const [key, grant] of Object.entries(store.studioConsent?.() || {})) {
      if (grant?.root) out.set(key, String(grant.root));
    }
    return out;
  };

  /** The registry's own agent for an id, when it is on the floor. */
  const liveAgent = (id) => (ctx.registry?.agents || []).find((a) => a.id === id) || null;

  /** The ledger, whole — bounded by retention, as `/api/stats` reads it. */
  const ledgerRecords = async () => (ctx.ledger?.dir ? readAll(ctx.ledger.dir) : []);

  /**
   * Board writes from this module, one after another, for the reason
   * `studio-handover.mjs` chains its own.
   * @type {Promise<any>}
   */
  let chain = Promise.resolve();
  const serial = (fn) => {
    const next = chain.then(fn);
    chain = next.catch((err) => log.warn('studio drift', err?.message || err));
    return next;
  };

  /**
   * Everything tracking needs for one project, read off disk now.
   * @param {string} root
   * @param {any[]} records
   */
  function inputsFor(root, records) {
    const studio = new StudioStore(root, { log });
    const current = studio.readBoard();
    const roster = studio.readRoster();
    const cards = current.error ? [] : current.board.cards;
    return {
      studio,
      current,
      roster: roster.error ? null : roster.roster,
      handovers: current.error ? [] : readHandovers(studio, cards),
      records,
    };
  }

  // -------------------------------------------------------------------------
  // The budget stop
  // -------------------------------------------------------------------------

  /**
   * Block every card in `in_progress` that has crossed its cap, then post
   * each one's session its one message.
   * @param {string} root
   * @param {() => Promise<any[]>} [records] the ledger, read on demand
   * @returns {Promise<Array<{cardId:string, which:string, agentId:string|null, posted:boolean}>>}
   */
  function checkBudgets(root, records = ledgerRecords) {
    return serial(async () => {
      const at = clockNow();
      // The ledger is read only for a board that has something it could stop:
      // a card in progress with a cap. Most boards, most minutes, have none,
      // and ninety days of ledger is not a thing to read once a minute for
      // nothing.
      const peek = new StudioStore(root, { log }).readBoard();
      const capped = (peek.board?.cards || []).some(
        (c) => c.column === WORK_COLUMN && (c.budget?.tokens || c.budget?.minutes),
      );
      if (peek.error || !capped) return [];
      const input = inputsFor(root, await records());
      if (input.current.error) return [];
      const board = {
        ...input.current.board,
        cards: input.current.board.cards.map((c) => ({ ...c })),
      };
      const tracked = trackBoard(board, { ...input, now: at });
      /** @type {Array<{cardId:string, which:string, agentId:string|null, text:string}>} */
      const stopped = [];
      for (const t of tracked.cards) {
        // Only work in flight is stopped. A card in Review or Done that ran
        // over has finished spending; blocking it would be moving finished
        // work backwards, which the stop may never do.
        const where = board.cards.find((c) => c.id === t.cardId)?.column;
        if (!t.crossed || where !== WORK_COLUMN) continue;
        // THE THIRD COLUMN WRITER, and the only one no person presses. It
        // reaches `blocked` and nothing else; see `src/studio/budget.mjs`.
        const done = blockForBudget(board, t.cardId, { text: t.crossed.text, at });
        if (done.moved) {
          stopped.push({
            cardId: t.cardId,
            which: t.crossed.which,
            agentId: t.agentId,
            text: t.crossed.text,
          });
        }
      }
      if (!stopped.length) return [];
      const check = validateBoard(board, { raw: null });
      if ('error' in check) {
        log.warn(`studio budget stop refused by the board's own validator: ${check.error}`);
        return [];
      }
      await input.studio.writeBoard(check.board);

      // One message per stop, and a stop happens once: `blockForBudget()`
      // answers `moved:false` for a card already blocked, so a second check
      // cannot reach this line for the same crossing.
      const out = [];
      for (const s of stopped) {
        const agent = s.agentId ? liveAgent(s.agentId) : null;
        let posted = false;
        if (agent) {
          const handover = input.studio.pathOf(`${DIRS.handovers}/${s.cardId}.md`);
          try {
            startTurn(ctx, agent, stopMessage(s.cardId, s.text, handover));
            posted = true;
          } catch (err) {
            log.warn(`studio budget stop could not post to ${agent.id}`, err?.message || err);
          }
        }
        log.info(`studio budget stop: ${s.cardId} on ${root} (${s.text})`);
        out.push({ cardId: s.cardId, which: s.which, agentId: s.agentId, posted });
      }
      return out;
    });
  }

  /**
   * The refusal `POST /api/send` asks for. Read from every consented board on
   * every send, so the stop is exactly as long-lived as the file says.
   * @param {string} agentId
   * @returns {{error:string, cardId:string}|null}
   */
  ctx.studioSendRefusal = (agentId) => {
    for (const root of consented().values()) {
      const studio = new StudioStore(root, { log });
      const current = studio.readBoard();
      if (current.error || !current.present) continue;
      const roster = studio.readRoster();
      for (const card of current.board.cards) {
        const flag = budgetStopped(card);
        if (!flag) continue;
        if (agentOfCard(card, roster.error ? null : roster.roster) !== agentId) continue;
        return {
          cardId: card.id,
          error:
            `Studio stopped sending to this session: card ${card.id} crossed its budget ` +
            `(${flag.text}). Move the card out of Blocked, or raise its budget, to send again.`,
        };
      }
    }
    return null;
  };

  // -------------------------------------------------------------------------
  // The PM pass
  // -------------------------------------------------------------------------

  /** `projectKey → the last pass's outcome`, for the tracking response. */
  const outcomes = new Map();

  /**
   * One pass over one project. Never throws; every way it can not happen is
   * a named reason in the outcome.
   * @param {string} root
   * @param {number|null} since when the last pass ran, or null
   */
  async function pass(root, since) {
    const studio = new StudioStore(root, { log });
    const key = studio.projectKey;
    const at = clockNow();
    const done = (outcome) => {
      const full = { at, ...outcome };
      outcomes.set(key, full);
      return full;
    };
    const planner = store.studioPlannerFor?.(key) || null;
    const agent = planner ? liveAgent(planner.agentId) : null;
    if (!agent) return done({ ok: false, reason: 'no planner on the floor', flags: 0 });
    const current = studio.readBoard();
    if (current.error) return done({ ok: false, reason: current.error, flags: 0 });
    const cards = current.board.cards;
    const handovers = readHandovers(studio, cards).filter((h) => since == null || h.mtime > since);
    const blueprint = studio.readBlueprint().blueprint;

    let started;
    try {
      started = startTurn(
        ctx,
        agent,
        pmMessage({ blueprint, board: current.board, handovers, since }),
      );
    } catch (err) {
      return done({ ok: false, reason: err?.message || String(err), flags: 0 });
    }
    const answer = await started.turn;
    if (!answer.ok)
      return done({ ok: false, reason: answer.error || 'the planner did not answer', flags: 0 });

    // The board is read AGAIN, after the turn: the user may have moved a card
    // while the planner was thinking, and a flag written onto the board as it
    // stood half an hour ago would put that card back.
    return serial(async () => {
      const fresh = studio.readBoard();
      if (fresh.error) return done({ ok: false, reason: fresh.error, flags: 0 });
      const board = { ...fresh.board, cards: fresh.board.cards.map((c) => ({ ...c })) };
      const parsed = parseFlags(
        answer.text,
        board.cards.map((c) => c.id),
      );
      const written = applyFlags(board, parsed.flags, clockNow());
      if (written) {
        const check = validateBoard(board, { raw: null });
        if ('error' in check) return done({ ok: false, reason: check.error, flags: 0 });
        await studio.writeBoard(check.board);
      }
      return done({
        ok: true,
        sendId: started.sendId,
        flags: written,
        dropped: parsed.dropped,
        reason: parsed.reason,
      });
    });
  }

  /** projectKey → root, for the schedule, which is keyed by project. */
  const schedule = createPmSchedule({
    now: clockNow,
    intervalMs: PM_INTERVAL_MS,
    run: (key, since) => {
      const root = consented().get(key);
      return root ? pass(root, since) : Promise.resolve(null);
    },
  });

  /** A pass now, for one project. */
  const runPass = (root) => schedule.runNow(new StudioStore(root, { log }).projectKey);

  /**
   * One tick: every consented project's budgets, then its schedule. Awaited
   * in full by a test; fire-and-forget from the timer.
   */
  async function tick() {
    const out = [];
    /** One read of the ledger per tick, shared by every project that needs it. */
    let once = /** @type {Promise<any[]>|null} */ (null);
    const records = () => (once ??= ledgerRecords());
    for (const [key, root] of consented()) {
      try {
        const stops = await checkBudgets(root, records);
        const passed = await schedule.tick(key);
        out.push({ projectKey: key, stops, pass: passed });
      } catch (err) {
        log.warn('studio drift tick', err?.message || err);
      }
    }
    return out;
  }

  const timer = setInterval(() => {
    tick().catch(() => {});
  }, ctx.studioTickMs ?? DRIFT_TICK_MS);
  timer.unref?.();

  // -------------------------------------------------------------------------
  // GET /api/studio/tracking
  // -------------------------------------------------------------------------

  router.get('/api/studio/tracking', async (_req, res, url) => {
    const project = helpers.resolveProject(url.searchParams.get('project'));
    if ('error' in project) return sendError(res, 400, project.error);
    let records = [];
    try {
      records = await ledgerRecords();
    } catch (err) {
      log.warn('studio tracking could not read the ledger', err?.message || err);
    }
    const input = inputsFor(project.root, records);
    if (input.current.error) {
      return sendJson(res, 409, {
        error: input.current.error,
        path: input.current.errorPath,
        line: input.current.line,
      });
    }
    const showCost = Boolean(store.settings?.showCost);
    const tracked = trackBoard(input.current.board, {
      ...input,
      now: clockNow(),
      showCost,
      rateCard: showCost ? loadRateCard({ overrideFile: ctx.ratesFile }) : null,
    });
    const last = outcomes.get(project.projectKey) || null;
    return sendJson(res, 200, {
      project: project.root,
      projectKey: project.projectKey,
      ...tracked,
      pmPass: last,
    });
  });

  // -------------------------------------------------------------------------
  // POST /api/studio/pm-pass
  // -------------------------------------------------------------------------

  router.post('/api/studio/pm-pass', async (req, res) => {
    const found = await helpers.projectFromBody(req, res);
    if (!found) return;
    const { root, projectKey } = found;
    if (!helpers.consentFor(projectKey)) {
      return sendError(
        res,
        403,
        `Studio is not enabled for ${root}. POST /api/studio/enable with { confirm: true } first; ` +
          'consent is per project and is never inferred from another.',
      );
    }
    const outcome = await runPass(root);
    if (outcome?.busy) return sendError(res, 409, 'a PM pass is already running for this project');
    if (!outcome?.ok) return sendJson(res, 409, { ok: false, ...outcome, error: outcome?.reason });
    return sendJson(res, 200, outcome);
  });

  return {
    tick,
    checkBudgets,
    runPass,
    stop: () => clearInterval(timer),
  };
}

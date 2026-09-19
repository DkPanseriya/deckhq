/**
 * `POST /api/studio/hire` — WP-68, `docs/07-STUDIO-DESIGN.md` §4.
 *
 * One press, and per role: a git worktree, a brief file, a session started in
 * that worktree, and a name waiting for it. `{ role }` hires one; `{ roles }`
 * hires up to `MAX_HIRE_AT_ONCE` (§11.7, the owner's default of six) and is
 * refused above it **with the count**, because "too many" is not a number
 * anybody can act on.
 *
 * ## Everything is checked before anything is made
 *
 * The whole request is validated first — consent, the runtime, the count,
 * every role name, every role's presence in `roster.json` — and only then does
 * the first worktree get created. A Hire of six roles whose fourth name
 * carries a `;` must leave no worktree behind, and the only way to promise
 * that is to refuse before the first `git worktree add` rather than half way
 * through it. A failure AFTER that point is per role: the ones that worked are
 * reported as made and the one that failed is reported with its reason, since
 * a worktree that exists is a fact and rolling it back would delete a
 * directory DeckHQ had just told git about.
 *
 * ## The spawn, and the two argv elements that name the brief
 *
 *   `openNewSession(worktreePath, { systemPromptFile, instructions })`
 *
 * `systemPromptFile` is the brief's PATH — Claude Code turns it into
 * `--append-system-prompt-file <path>` — and `instructions` is one sentence
 * that also names the path, for the runtimes whose `openNewSession` takes
 * nothing else (Codex's takes `instructions` alone). The brief's BODY is never
 * on a command line, no value is ever interpolated into a shell string, and
 * `test/integration/studio-hire.test.mjs` asserts the array element by element.
 *
 * ## What this route does NOT do
 *
 * It writes no card and no column — `POST /api/studio/card` is the only writer
 * of a column and `test/unit/studio-invariant.test.mjs` fails on a second one.
 * WP-69's `{ cardId }` does not change that: it says which card the BRIEF is
 * about, the board having already been written by the move that led here.
 * It keeps no session list: the role→`agentId` record comes from the ORDINARY
 * scan, through the registry's own event, matched by the worktree directory
 * the session is running in (§9 invariant 4).
 */

import { sendError, sendJson } from '../server.mjs';
import { now as clockNow } from '../../core/clock.mjs';
import { DATA_DIR } from '../../core/paths.mjs';
import { samePath } from '../../core/same-path.mjs';
import { StudioStore } from '../../studio/store.mjs';
import { MAX_HIRE_AT_ONCE } from '../../studio/schema.mjs';
import { ensureRoleBrief, hireKickoff } from '../../studio/brief-role.mjs';
import {
  WorktreeError,
  checkRoleName,
  ensureWorktree,
  worktreePathFor,
} from '../../studio/worktree.mjs';

/** The runtime a Hire uses when the request does not name one. */
export const DEFAULT_HIRE_RUNTIME = 'claude-code';

/**
 * Runtimes that can be hired but have never had a terminal opened by this
 * project, or have never been measured against real data (§4, §8, §137,
 * §123). They are hired anyway — the floor already degrades correctly for
 * them — and the card SAYS SO rather than pretending the launch is known to
 * work.
 */
export const UNVERIFIED_LAUNCH = /** @type {Record<string,string>} */ ({
  codex:
    'unverified launch: no Codex terminal has ever been opened by this project, and Codex has no ' +
    '`http` hook, so it cannot raise a permission card and reports liveness from file mtime',
  'gemini-cli':
    'unverified launch: Gemini CLI has never been measured against real data by this project, and ' +
    'has no hook, so a blocked session cannot be told apart from a stalled one',
  opencode:
    'unverified launch: OpenCode has never been measured against real data by this project, and ' +
    'has no hook, so a blocked session cannot be told apart from a stalled one',
});

/**
 * How long a started role is waited for before the wait is given up. The same
 * ten minutes `PLANNER_WAIT_MS` waits, for the same reason and restated for
 * the same reason: what is being waited for is a terminal window opening.
 */
export const HIRE_WAIT_MS = 10 * 60 * 1000;

/**
 * The roles one request asks for, or why it cannot be read.
 *
 * `{ role }` and `{ roles }` are the same thing with different arity, and a
 * request carrying both is not refused — one list is built and de-duplicated,
 * because a page that sends `role` alongside a one-element `roles` is asking
 * for one hire either way.
 *
 * @param {any} body
 * @returns {{roles:string[]}|{error:string, count?:number}}
 */
export function rolesAsked(body) {
  /** @type {string[]} */
  const raw = [];
  if (typeof body?.role === 'string') raw.push(body.role);
  if (body?.roles != null) {
    if (!Array.isArray(body.roles)) return { error: 'roles is an array of role names' };
    for (const r of body.roles) raw.push(typeof r === 'string' ? r : String(r ?? ''));
  }
  /** @type {string[]} */
  const roles = [];
  const seen = new Set();
  for (const r of raw) {
    const name = r.trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    roles.push(name);
  }
  if (roles.length === 0) return { error: 'name a role to hire: { role } or { roles: […] }' };
  if (roles.length > MAX_HIRE_AT_ONCE) {
    return {
      error:
        `one Hire starts at most ${MAX_HIRE_AT_ONCE} roles and this one names ${roles.length}. ` +
        'Six terminal windows is already a lot of windows, and the seventh is where a mistake ' +
        'stops being one you can close. Hire in two presses.',
      count: roles.length,
    };
  }
  return { roles };
}

/**
 * The card this role should be given, or null.
 *
 * The board's own order, filtered to cards assigned to this role and not
 * finished. Nothing is chosen cleverly: the FIRST such card wins, because the
 * board is the user's and its order is a decision they made.
 *
 * @param {{cards?:Array<any>}} board
 * @param {string} roleName
 * @param {string[]} done columns that mean the card is no longer to be built
 */
export function cardForRole(board, roleName, done = ['done']) {
  const want = String(roleName || '').toLowerCase();
  return (
    (board?.cards || []).find(
      (c) => String(c.role || '').toLowerCase() === want && !done.includes(String(c.column || '')),
    ) || null
  );
}

/**
 * THE CARD A HIRE WAS ASKED FOR — WP-69, `docs/07-STUDIO-DESIGN.md` §5.4.
 *
 * §5.4: *dragging a card into Ready with an assignee spawns or continues that
 * role's session with the card as its brief.* That is a different question
 * from `cardForRole()` above, which answers "what is this role's next card"
 * for a Hire pressed from the palette. Here the user has named a card, and the
 * brief must carry THAT one — otherwise a board with two cards on a role would
 * quietly start the wrong one, and the drag the user just made would have had
 * no effect on what the session was told to do.
 *
 * Refused rather than fallen back on, in both failure shapes, because a fall
 * back to `cardForRole()` is exactly the silent wrong-card this exists to stop:
 *
 *   `card-unknown`     no card with that id on this board
 *   `card-not-theirs`  the card is assigned to a different role. §5.4 says the
 *                      board asks and never guesses, and reassigning a card as
 *                      a side effect of a Hire would be a column writer in all
 *                      but name — the assignee is a card EDIT, through
 *                      `POST /api/studio/card`.
 *
 * @param {{cards?:Array<any>}} board
 * @param {string} roleName the role being hired
 * @param {string} cardId
 * @returns {{card:any}|{error:string, reason:string}}
 */
export function cardAsked(board, roleName, cardId) {
  const card = (board?.cards || []).find((c) => String(c.id || '') === cardId);
  if (!card) {
    return {
      error:
        `there is no card called "${cardId}" on this board. A Hire that named a card and then ` +
        'started a different one would be a board you could not trust.',
      reason: 'card-unknown',
    };
  }
  const on = String(card.role || '');
  if (on.toLowerCase() !== String(roleName || '').toLowerCase()) {
    return {
      error:
        `card "${cardId}" is assigned to ${on ? `"${on}"` : 'nobody'}, not to "${roleName}". ` +
        'Change the assignee on the card first — that is an edit, and an edit is the only ' +
        'thing that changes one.',
      reason: 'card-not-theirs',
    };
  }
  return { card };
}

/**
 * The session a hire turned into, or null.
 *
 * Matched by the WORKTREE DIRECTORY, which is what makes this simpler than the
 * planner's match: a worktree belongs to exactly one role, so the newest
 * session running in it is that role's and cannot be anybody else's.
 *
 * Compared with `samePath()`, not `===`: a session reports the directory it is
 * running in the way the OS spells it, and the worktree is spelt the way the
 * data directory was. Where those differ the role was hired and never
 * recognised — `src/core/same-path.mjs` says where they differ.
 *
 * @param {Array<{id?:string, cwd?:string, lastActivityAt?:number}>} agents
 * @param {string} worktree resolved worktree path
 * @param {Set<string>} taken agent ids already spoken for
 */
export function roleAmong(agents, worktree, taken) {
  return (
    (Array.isArray(agents) ? agents : [])
      .filter((a) => a && typeof a.id === 'string' && !taken.has(a.id) && samePath(a.cwd, worktree))
      .sort((a, b) => (b.lastActivityAt || 0) - (a.lastActivityAt || 0))[0] || null
  );
}

/**
 * Register `POST /api/studio/hire`.
 *
 * @param {import('../server.mjs').Router} router
 * @param {any} ctx the same context `register()` in `studio.mjs` is given
 * @param {{projectFromBody:(req:any,res:any)=>Promise<any>,
 *          consentFor:(key:string)=>any}} helpers shared with that file so the
 *   body reading and the consent answer are the same two in both
 */
export function registerHire(router, ctx, helpers) {
  const dataDir = ctx.dataDir || DATA_DIR;

  /**
   * Roles started and not yet seen by the scan.
   * `"<projectKey>\u0000<role>" → {projectKey, root, role, worktree, startedAt}`.
   * Not a session list: there is no session in it, by construction.
   * @type {Map<string, {projectKey:string, root:string, role:string,
   *                     worktree:string, startedAt:number}>}
   */
  const awaiting = new Map();

  /**
   * The roster writes, one after another.
   *
   * Three roles matched in ONE scan pass means three read-modify-writes of the
   * same `roster.json`, and three of them in flight at once is two lost
   * `agentId`s. This chain is the whole fix: each record waits for the last,
   * so every one reads the file the one before it wrote.
   * @type {Promise<any>}
   */
  let writes = Promise.resolve();

  ctx.registry?.on?.(() => {
    if (awaiting.size === 0) return;
    const agents = ctx.registry.agents || [];
    /** Every id this pass has handed out, so two roles cannot claim one. */
    const taken = new Set();
    for (const [key, want] of [...awaiting]) {
      if (clockNow() - want.startedAt > HIRE_WAIT_MS) {
        awaiting.delete(key);
        continue;
      }
      const found = roleAmong(agents, want.worktree, taken);
      if (!found) continue;
      awaiting.delete(key);
      taken.add(found.id);
      const studio = new StudioStore(want.root, { log: ctx.log });
      writes = writes
        .then(() => studio.recordRoleAgent(want.role, found.id))
        .then((out) => {
          if (out.recorded) ctx.log.info(`studio role "${want.role}" is ${found.id}`);
          else ctx.log.warn(`studio could not record "${want.role}": ${out.why}`);
        })
        .catch((err) => ctx.log.warn('studio role record failed', err?.message || err));
    }
  });

  router.post('/api/studio/hire', async (req, res) => {
    const found = await helpers.projectFromBody(req, res);
    if (!found) return;
    const { root, projectKey, body } = found;

    // ---- Everything that can be refused, refused before anything is made ---

    if (!helpers.consentFor(projectKey)) {
      return sendError(
        res,
        409,
        `Studio is not enabled for ${root}. POST /api/studio/enable with { confirm: true }, or ` +
          `run \`deckhq studio enable "${root}" --yes\`, and you will be shown every path it ` +
          'would write first. Consent is per project and is never inferred from another.',
      );
    }

    const asked = rolesAsked(body);
    if ('error' in asked) {
      return sendJson(res, 400, {
        error: asked.error,
        max: MAX_HIRE_AT_ONCE,
        ...(asked.count == null ? {} : { count: asked.count }),
      });
    }

    // WP-69. A card id, when the board sent one. One role only: `{ roles: […] }`
    // is six people and one card cannot be six people's work, so naming both is
    // refused rather than applied to whichever role came first.
    const cardId = typeof body.cardId === 'string' ? body.cardId.trim() : '';
    if (cardId && asked.roles.length !== 1) {
      return sendJson(res, 400, {
        error:
          'a cardId names the work for one role, and this Hire names ' +
          `${asked.roles.length}. Hire them one at a time, or leave the card out and each ` +
          'role picks up the first card already assigned to it.',
        reason: 'card-many-roles',
      });
    }

    const runtime = String(body.runtime || DEFAULT_HIRE_RUNTIME);
    const adapter = ctx.adapters?.getAdapter?.(runtime);
    if (!adapter) return sendError(res, 404, `Unknown runtime "${runtime}"`);
    if (typeof adapter.openNewSession !== 'function') {
      return sendError(
        res,
        400,
        `${adapter.label} cannot start a new session, so a role cannot be hired on it. Hiring is ` +
          'a spawn; a runtime with no way to spawn is refused by name rather than silently ' +
          'skipped, because a Hire that reported nothing would look like a Hire that worked.',
      );
    }

    const studio = new StudioStore(root, { log: ctx.log });
    const rosterRead = studio.readRoster();
    if (rosterRead.error) {
      return sendJson(res, 400, {
        error: rosterRead.error,
        path: rosterRead.errorPath,
        line: rosterRead.line ?? null,
      });
    }
    const roster = rosterRead.roster || { roles: [] };

    /** @type {Array<{name:string, role:any}>} */
    const plan = [];
    for (const asking of asked.roles) {
      const checked = checkRoleName(asking);
      if ('error' in checked) {
        return sendJson(res, 400, { error: checked.error, reason: checked.reason, role: asking });
      }
      const role = (roster.roles || []).find(
        (r) => String(r.name || '').toLowerCase() === checked.name.toLowerCase(),
      );
      if (!role) {
        return sendJson(res, 400, {
          error:
            `"${asking}" is not a role in this project's roster.json. Roles are the planner's ` +
            'suggestions and the user’s property (§4); Hire starts one that is already ' +
            'there rather than inventing it.',
          reason: 'role-unknown',
          role: asking,
        });
      }
      plan.push({ name: checked.name, role });
    }

    const board = studio.readBoard().board || { cards: [] };
    // WP-69. Resolved HERE, with everything else that can be refused, and
    // before the first `git worktree add` — §188.2's rule, and a named card
    // that does not exist is exactly the kind of request that must leave no
    // worktree behind.
    /** @type {any} */
    let named = null;
    if (cardId) {
      const found = cardAsked(board, plan[0].name, cardId);
      if ('error' in found) {
        return sendJson(res, 400, {
          error: found.error,
          reason: found.reason,
          role: plan[0].name,
          cardId,
        });
      }
      named = found.card;
    }

    // ---- From here on, per role, and a failure is reported rather than -----
    // ---- rolled back: a worktree that exists is a fact.                 ----

    const live = new Set((ctx.registry?.agents || []).map((a) => a.id));
    const startedAt = clockNow();
    /** @type {any[]} */
    const hired = [];
    /** @type {any[]} */
    const refused = [];

    for (const { name, role } of plan) {
      /** @type {any} */
      let made;
      try {
        made = await ensureWorktree(root, name, { dataDir });
      } catch (err) {
        refused.push({
          role: name,
          reason: err instanceof WorktreeError ? err.reason : 'worktree-failed',
          error: err?.message || String(err),
          worktree: worktreePathFor(dataDir, root, name),
        });
        continue;
      }

      // The card the board named, when it named one; otherwise the role's own
      // next card. Never both and never a fallback between them — see
      // `cardAsked()`.
      const card = named || cardForRole(board, name);
      // §6.1: a brief is never regenerated under a running session. "Running"
      // is the ordinary registry answer about the id the roster already holds.
      const running = !!(role.agentId && live.has(role.agentId));
      /** @type {any} */
      let brief;
      try {
        brief = await ensureRoleBrief(studio, role, { card, worktree: made.path, running });
      } catch (err) {
        refused.push({
          role: name,
          reason: 'brief-failed',
          error: err?.message || String(err),
          worktree: made.path,
        });
        continue;
      }

      // The brief the session is started under is the one ON DISK, which is
      // the user's when they have edited it. `brief.beside` is the one we
      // would have written, and it is reported rather than used.
      try {
        await adapter.openNewSession(made.path, {
          systemPromptFile: brief.file,
          instructions: hireKickoff(brief.file),
          terminal: ctx.store?.settings?.terminal,
          launch: ctx.launchTerminal,
        });
      } catch (err) {
        ctx.log.warn(`studio hire "${name}" failed`, err?.message || err);
        refused.push({
          role: name,
          reason: 'spawn-failed',
          error: err?.message || String(err),
          worktree: made.path,
          brief: brief.file,
        });
        continue;
      }

      // The identity mechanism §4 names: the role name attaches to the newest
      // session in that directory, and MK numbers are never reassigned.
      ctx.pendingIdentities?.queue(made.path, name, null);
      awaiting.set(`${projectKey}\u0000${name}`, {
        projectKey,
        root,
        role: name,
        worktree: made.path,
        startedAt,
      });

      hired.push({
        role: name,
        runtime,
        worktree: made.path,
        branch: made.branch,
        worktreeCreated: made.created,
        worktreeReused: made.reused,
        worktreeArgv: made.argv,
        brief: brief.file,
        briefWritten: brief.written,
        briefBeside: brief.beside,
        briefReason: brief.reason,
        rulesWritten: brief.rulesWritten,
        card: card ? card.id : null,
        // The id is honestly absent: it is the runtime's to mint and the
        // scan's to find. The page watches `GET /api/studio` for it.
        agentId: null,
        unverified: UNVERIFIED_LAUNCH[runtime] || null,
      });
    }

    if (hired.length) setTimeout(() => ctx.registry?.refresh?.().catch(() => {}), 2500);

    return sendJson(res, 202, {
      ok: refused.length === 0,
      project: root,
      projectKey,
      runtime,
      startedAt,
      hired,
      refused,
      note: hired.length
        ? `${hired.length} role${hired.length === 1 ? '' : 's'} appear on the floor within one ` +
          'scan, each wearing its role name'
        : 'nothing was started',
    });
  });
}

/**
 * DeckHQ core model.
 *
 * This file is the contract between every other module. It contains no I/O and
 * no runtime-specific knowledge. See docs/02-ARCHITECTURE.md §3.
 */

/** @typedef {'working'|'needs_input'|'stalled'|'for_review'|'ended'} ActivityState */
/** @typedef {'active'|'benched'|'let_go'} AckState */
/** @typedef {'desk'|'office'|'lounge'|'let_go'} Placement */
/** @typedef {'claude-code'|'codex'} RuntimeId */

/**
 * What a session is doing right now, from `PreToolUse` (WP-52).
 *
 * Observed, transient and never user-owned: it is set by a tool starting,
 * cleared by the same tool finishing (or by the session stopping, or by the
 * stall window passing), and no part of it may reach `ackState`,
 * `reviewSince` or `needsInputSince`.
 *
 * @typedef {object} CurrentTool
 * @property {string} name       the runtime's own tool name, e.g. `Bash`
 * @property {string} summary    <= MAX_TOOL_SUMMARY chars, one line, no paths
 *                               from outside the session's cwd
 * @property {number} since      ms epoch the tool started
 */

/**
 * @typedef {object} Agent
 * @property {string} id                 runtime session id, prefixed with the runtime
 * @property {RuntimeId} runtime
 * @property {string} title              user's chat title; falls back to runtime name, then id[0..8]
 * @property {boolean} hasCustomTitle
 * @property {string} projectId          slug of cwd
 * @property {string} projectName
 * @property {string} cwd
 * @property {string|null} gitBranch
 * @property {string|null} model
 * @property {boolean} live
 * @property {ActivityState} activityState   observed
 * @property {AckState} ackState             user-owned
 * @property {number|null} reviewSince
 * @property {number|null} needsInputSince
 * @property {number|null} lastOutputAt
 * @property {number} lastActivityAt
 * @property {number} tokens             input + output only
 * @property {number} cacheTokens        cache read + write
 * @property {number|null} costEstimate  list-price equivalent, or null when the
 *                                      rate card has no row for this model. NEVER a bill.
 * @property {'user'|'assistant'|null} lastRole
 * @property {string} lastText           <= 400 chars
 * @property {CurrentTool|null} [currentTool]  observed; null when no tool is
 *                                      running, or when the runtime does not
 *                                      report tool events at all
 * @property {PendingPermission|null} [pendingPermission] WP-19; null unless a
 *                                      `PermissionRequest` from this session is
 *                                      being held open by the daemon right now
 * @property {boolean} [turnEnded]       the last record is an assistant message
 *                                      with no tool call: idle, up for review
 * @property {boolean} [archived]        the user archived this session in the
 *                                      runtime's own UI. Undefined when the
 *                                      runtime cannot report it — never read
 *                                      an absent flag as "not archived".
 */

/**
 * @typedef {object} SessionSummary
 * Everything an adapter can learn about a session from disk.
 * @property {string} id
 * @property {RuntimeId} runtime
 * @property {string} title
 * @property {boolean} hasCustomTitle
 * @property {string} cwd
 * @property {string|null} gitBranch
 * @property {string|null} model
 * @property {number} lastActivityAt
 * @property {number} tokens
 * @property {number} cacheTokens
 * @property {number|null} costEstimate  null when the model has no rate
 * @property {'user'|'assistant'|null} lastRole
 * @property {string} lastText
 * @property {boolean} [turnEnded]
 */

/**
 * @typedef {object} LiveSession
 * @property {string} id
 * @property {RuntimeId} runtime
 * @property {string} cwd
 * @property {string|null} name
 * @property {number|null} startedAt
 * @property {number|null} pid
 */

/**
 * @typedef {object} Message
 * @property {'user'|'assistant'} role
 * @property {string} text
 * @property {number} at            ms epoch
 */

/**
 * @typedef {object} SendResult
 * @property {boolean} ok
 * @property {string} [text]
 * @property {string} [error]
 */

/**
 * @typedef {object} HookPlan
 * @property {string} file          absolute path that would be written
 * @property {string} json          the literal JSON block, pretty-printed
 * @property {string[]} events      human-readable list of events captured
 * @property {string} note          plain-language explanation for the consent screen
 */

export const ACTIVITY_STATES = /** @type {const} */ ([
  'working',
  'needs_input',
  'stalled',
  'for_review',
  'ended',
]);

export const ACK_STATES = /** @type {const} */ (['active', 'benched', 'let_go']);

export const ACK_ACTIONS = /** @type {const} */ ([
  'review',
  'acknowledge',
  'bench',
  'recall',
  'let_go',
  'rehire',
]);

/** States that count toward "needs you". */
export const NEEDS_YOU_STATES = /** @type {const} */ (['needs_input', 'stalled', 'for_review']);

export const MAX_LAST_TEXT = 400;

/**
 * The longest tool summary the floor and the panel will carry (WP-52,
 * `docs/plan/08-PLAN-V2-100X.md` §9: "a <= 120-character action summary").
 * The adapter that parses a hook payload is what enforces it.
 */
export const MAX_TOOL_SUMMARY = 120;

/**
 * The longest tool-input summary a permission card will carry (WP-19). It is
 * longer than a thought bubble's because this one is the thing being judged:
 * the reader is deciding whether to allow the literal command in front of
 * them, so it gets the same budget as a conversation excerpt. The adapter that
 * parses the `PermissionRequest` payload is what enforces it.
 */
export const MAX_PERMISSION_SUMMARY = 400;

/**
 * What the panel is told about a permission prompt this daemon is holding
 * open (WP-19, `docs/DEVIATIONS.md` §86). Observed, transient, and entirely
 * separate from `ackState`: a permission decision is a statement about one
 * tool call, never about whether the user is done with the session.
 *
 * @typedef {object} PendingPermission
 * @property {string} id            correlation key, the runtime's `tool_use_id`
 * @property {string} tool          the runtime's own tool name, e.g. `Bash`
 * @property {string} summary       <= MAX_PERMISSION_SUMMARY chars, one line
 * @property {{type:string, rules?:any[], behavior?:string, label:string}[]} suggestions
 *   the `addRules` updates the terminal prompt itself would have offered, each
 *   with a display label. Empty means "Allow for this session" is not offered.
 * @property {boolean} requiresUserInteraction  true when a hook allow would be
 *   discarded by the runtime and the user has to answer in the session
 * @property {number} since         ms epoch the request arrived
 */

/**
 * Placement is derived, never stored. docs/02-ARCHITECTURE.md §3.1.
 *
 * A session that is not running still sits at its project desk. Only an
 * explicit bench moves it to the lounge.
 *
 * @param {Pick<Agent,'ackState'|'activityState'>} agent
 * @returns {Placement}
 */
export function placement(agent) {
  if (agent.ackState === 'let_go') return 'let_go';
  if (agent.ackState === 'benched') return 'lounge';
  if (agent.activityState === 'for_review') return 'office';
  return 'desk';
}

/**
 * @param {Pick<Agent,'ackState'|'activityState'>} agent
 * @returns {boolean}
 */
export function needsYou(agent) {
  return (
    agent.ackState === 'active' &&
    /** @type {readonly string[]} */ (NEEDS_YOU_STATES).includes(agent.activityState)
  );
}

/**
 * Days of no activity after which a benched session is not drawn on the floor.
 * `settings.goneHomeDays`; the same default `store.mjs` and `plan.js` carry.
 */
export const GONE_HOME_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The activity states that put a session on the floor at all — at a desk, hand
 * up, gone quiet, or standing in the office waiting to be seen.
 *
 * `08` B6's rule, and the same set `public/render/plan.js` calls `ON_THE_FLOOR`.
 * It is stated twice on purpose: `src/core/` and `public/render/` are either
 * side of the static-file boundary and neither may import the other
 * (docs/CONTRACTS.md). `test/unit/model.test.mjs` asserts the two agree on the
 * reference fixture, so the copy cannot drift in silence.
 */
const ON_THE_FLOOR = ['working', 'needs_input', 'stalled', 'for_review'];

/**
 * Has this benched session gone home? A DISPLAY FILTER AND NOTHING ELSE — it
 * reads `lastActivityAt` and writes nothing, which is why it can never touch
 * the invariant. Mirrors `plan.js`'s `isGoneHome`, including both refusals: a
 * window of zero draws everybody, and a session nobody can date is drawn.
 * @param {Pick<Agent,'ackState'|'lastActivityAt'>} agent
 * @param {number} now
 * @param {number} goneHomeDays
 */
function isGoneHome(agent, now, goneHomeDays) {
  if (agent.ackState !== 'benched') return false;
  const days = Number(goneHomeDays);
  if (!Number.isFinite(days) || days <= 0) return false;
  const last = Number(agent.lastActivityAt);
  if (!Number.isFinite(last) || last <= 0) return false;
  return now - last > days * DAY_MS;
}

/**
 * The header breakdown. docs/02-ARCHITECTURE.md §3.2.
 *
 * `drawn` is what the FLOOR shows, and it is the half of this the header's
 * floor counts read (WP-55). The two used to be the same number and stopped
 * being one at WP-50: "at desk" was `placement() === 'desk'`, which counts a
 * finished session sitting in a repo nobody is working in, and on the reference
 * machine that read "21 at desk" over a floor drawing two. Everything under
 * `drawn` is a display filter over observed fields — nothing here writes, and
 * the needs-you numeral and its breakdown are untouched.
 *
 * @param {Agent[]} agents
 * @param {{now?:number, goneHomeDays?:number}} [opts]
 */
export function counts(agents, opts = {}) {
  const now = Number.isFinite(Number(opts.now)) ? Number(opts.now) : Date.now();
  const goneHomeDays = opts.goneHomeDays ?? GONE_HOME_DAYS;

  let handsUp = 0;
  let stalled = 0;
  let forReview = 0;
  let atDesk = 0;
  let benched = 0;
  let letGo = 0;
  let working = 0;

  // Which projects have a room: one with at least one active agent on the
  // floor. A session at a desk in a project with no room is not drawn — there
  // is nowhere to draw it — which is what "N finished" counts.
  const activeProjects = new Set();
  for (const a of agents) {
    if (a.ackState !== 'active') continue;
    if (!ON_THE_FLOOR.includes(a.activityState)) continue;
    activeProjects.add(String(a.projectId ?? ''));
  }

  let drawnAtDesk = 0;
  let finished = 0;
  let drawnBenched = 0;
  let wentHome = 0;

  for (const a of agents) {
    if (a.ackState === 'let_go') {
      letGo++;
      continue;
    }
    if (a.ackState === 'benched') {
      benched++;
      if (isGoneHome(a, now, goneHomeDays)) wentHome++;
      else drawnBenched++;
      continue;
    }
    if (a.activityState === 'needs_input') handsUp++;
    else if (a.activityState === 'stalled') stalled++;
    else if (a.activityState === 'for_review') forReview++;
    if (a.activityState === 'working') working++;
    if (placement(a) !== 'desk') continue;
    atDesk++;
    if (activeProjects.has(String(a.projectId ?? ''))) drawnAtDesk++;
    else finished++;
  }

  return {
    needsYou: handsUp + stalled + forReview,
    handsUp,
    stalled,
    forReview,
    atDesk,
    benched,
    letGo,
    working,
    total: agents.length,
    /** What the floor actually draws. See the note above. */
    drawn: {
      atDesk: drawnAtDesk,
      finished,
      waiting: forReview,
      benched: drawnBenched,
      wentHome,
    },
  };
}

/**
 * Deterministic project slug from a working directory. Case-insensitive and
 * separator-insensitive so Windows and POSIX agree.
 * @param {string} cwd
 * @returns {string}
 */
export function projectIdFromCwd(cwd) {
  const normalised = String(cwd || '')
    .replace(/[\\/]+/g, '/')
    .replace(/\/+$/, '')
    .toLowerCase();
  return normalised.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'unknown';
}

/**
 * Human-facing project name: the last meaningful path segment.
 * @param {string} cwd
 * @returns {string}
 */
export function projectNameFromCwd(cwd) {
  const parts = String(cwd || '')
    .replace(/[\\/]+/g, '/')
    .replace(/\/+$/, '')
    .split('/')
    .filter(Boolean);
  if (parts.length === 0) return 'unknown';
  const last = parts[parts.length - 1];
  // A bare drive root ("C:") is not a useful name.
  if (/^[a-z]:$/i.test(last)) return last.toUpperCase() + '\\';
  return last;
}

/**
 * Group agents into projects for the floor plan and the room plates.
 * `let_go` agents are excluded from project sizing but still counted.
 * @param {Agent[]} agents
 */
export function projects(agents) {
  /** @type {Map<string, {id:string,name:string,cwd:string,agentIds:string[],sessionCount:number,tokens:number,cacheTokens:number,costEstimate:number,costRated:boolean,needsYou:number,working:number,activeCount:number}>} */
  const byId = new Map();
  for (const a of agents) {
    let p = byId.get(a.projectId);
    if (!p) {
      p = {
        id: a.projectId,
        name: a.projectName,
        cwd: a.cwd,
        agentIds: [],
        sessionCount: 0,
        tokens: 0,
        cacheTokens: 0,
        costEstimate: 0,
        // Whether ANY agent in this room could be priced at all. A project
        // whose every model is missing from the rate card sums to zero, and
        // zero is a claim about the money we do not have — this is what lets
        // a caller show "no rate" instead of "$0.00" (WP-26).
        costRated: false,
        needsYou: 0,
        working: 0,
        // How many of this project's agents are still on the payroll —
        // neither benched nor let go. A project with none of these has an
        // empty room: nobody is at a desk in it, and it collapses.
        activeCount: 0,
      };
      byId.set(a.projectId, p);
    }
    p.agentIds.push(a.id);
    p.tokens += a.tokens;
    p.cacheTokens += a.cacheTokens;
    p.costEstimate += a.costEstimate ?? 0;
    if (a.costEstimate != null) p.costRated = true;
    if (a.ackState !== 'let_go') p.sessionCount++;
    if (needsYou(a)) p.needsYou++;
    if (a.ackState === 'active') p.activeCount++;
    if (a.ackState === 'active' && a.activityState === 'working') p.working++;
  }
  return [...byId.values()].sort(
    (a, b) => b.sessionCount - a.sessionCount || a.name.localeCompare(b.name),
  );
}

/** @param {string} s */
export function clampText(s) {
  const t = String(s ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  return t.length > MAX_LAST_TEXT ? t.slice(0, MAX_LAST_TEXT - 1) + '…' : t;
}

/**
 * THE RATE CARD LIVES IN `src/core/rates.mjs`, NOT HERE.
 *
 * It used to be four hand-typed tiers and a `RATE_CARD_VERSION` constant in
 * this file (WP-07). WP-26 moved both: the numbers are `src/data/rates.json`,
 * the user can merge their own over them at `~/.deckhq/rates.json`, and the
 * table is re-read when that file changes. Reading a file is I/O, and this
 * module's header promises there is none in it — so `estimateCost` and the
 * version string moved out rather than dragging a `readFileSync` into the
 * contract every other module imports.
 *
 * `import { estimateCost, rateCardVersion } from './rates.mjs'`.
 *
 * Note the return type changed with the move: `estimateCost` now returns
 * `null` for a model the table has no row for, where it used to price the
 * unknown as Opus. `Agent.costEstimate` is `number|null` for the same reason —
 * "no rate" is the honest answer and `$0.00` is not.
 */

/**
 * Prefix a runtime session id so ids are globally unique on the floor.
 * @param {RuntimeId} runtime
 * @param {string} sessionId
 */
export function agentId(runtime, sessionId) {
  return `${runtime}:${sessionId}`;
}

/** @param {string} id */
export function splitAgentId(id) {
  const i = String(id).indexOf(':');
  if (i < 0) return { runtime: /** @type {RuntimeId} */ ('claude-code'), sessionId: String(id) };
  return {
    runtime: /** @type {RuntimeId} */ (id.slice(0, i)),
    sessionId: id.slice(i + 1),
  };
}

/**
 * DeckHQ core model.
 *
 * This file is the contract between every other module. It contains no I/O and
 * no runtime-specific knowledge. See docs/02-ARCHITECTURE.md §3.
 *
 * WHO IS ON THE FLOOR is not here. It is in `public/floor-rule.js`, imported
 * below and re-exported so every existing `import { placement } from
 * './model.mjs'` still works. That module used to be two modules — this file
 * and `public/render/` each carried a copy, each with a comment asking the
 * next person not to let them drift, and both had drifted (WP-22,
 * `docs/DEVIATIONS.md` §122). Node can resolve a path under `public/`; a
 * browser cannot resolve one under `src/`. So the rule lives on the side both
 * can see, which is the same reason `identity.mjs` reads `public/names.js`.
 */

import {
  GONE_HOME_DAYS,
  ON_THE_FLOOR,
  isActiveAgent,
  isDeskAgent,
  isGoneHome,
  isSubagent,
  placement,
} from '../../public/floor-rule.js';

export { GONE_HOME_DAYS, isActiveAgent, isDeskAgent, isGoneHome, isSubagent, placement };

/** @typedef {'working'|'needs_input'|'stalled'|'for_review'|'ended'} ActivityState */
/** @typedef {'active'|'benched'|'let_go'} AckState */
/** @typedef {'desk'|'office'|'lounge'|'let_go'} Placement */
/**
 * Every runtime DeckHQ has an adapter for. Widened by WP-24/25; the registry in
 * `src/adapters/index.mjs` is the list of record and this union has to keep up
 * with it, because an id that is not in here is a type error at every site that
 * builds a summary. Nothing outside `src/adapters/` may act on which one it is.
 * @typedef {'claude-code'|'codex'|'gemini-cli'|'opencode'} RuntimeId
 */

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
 * @property {boolean} [subagent]        WP-41. This session is a junior: the
 *                                      runtime spawned it from another session
 *                                      and it lives and dies inside that
 *                                      session's turn. Observed, never
 *                                      user-owned, and it is what
 *                                      `needsYou()` and the renderer key off.
 * @property {string|null} [parentId]    the junior's parent agent id (prefixed),
 *                                      or null. Only ever set on a subagent.
 * @property {string|null} [subagentType] the runtime's own name for what kind
 *                                      of junior this is, e.g.
 *                                      `general-purpose`, `Explore`.
 * @property {string|null} [subagentDescription] the Task call's own short
 *                                      description of the work.
 * @property {number|null} [spawnedAt]   ms epoch the junior's transcript opens.
 * @property {number} [juniorCount]      how many juniors this session has on
 *                                      the floor right now. Zero on a junior
 *                                      and on every session that has none.
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
 * @property {Record<'files'|'shell'|'web'|'search', number>} [toolMix] WP-28.
 *   How this session's tool calls split across the four classes, counted off
 *   the transcript by the adapter. Absent for a runtime that cannot report it;
 *   an absent mix is "not observed", never "no tool calls".
 * @property {number} [textMedian]             WP-28. Median length, in
 *   characters, of an assistant turn that said something. 0 when none did.
 * @property {number} [textTurns]              WP-28. How many turns that
 *   median was taken over, so a reader can tell a median from a single sample.
 * @property {boolean} [archived]              the desktop app's archive flag,
 *   stamped on by the adapter AFTER the summary cache has handed the summary
 *   out and never stored in it (docs/DEVIATIONS.md §46). It was being written
 *   without ever being declared here (WP-22).
 * @property {boolean} [subagent]              WP-41; see `Agent`
 * @property {string} [parentSessionId]        the parent's RAW session id, as
 *   the adapter found it. The registry prefixes it into `Agent.parentId`.
 * @property {string|null} [subagentType]
 * @property {string|null} [subagentDescription]
 * @property {number|null} [spawnedAt]
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
 * Does this session need the user?
 *
 * **A junior is never in this count unless it raises its own hand** (`08` §9,
 * WP-41). The other two needs-you states are debts the user owes the SESSION,
 * and a junior's session is its parent:
 *
 *   - `for_review` means "this turn ended and you have not seen it". A junior's
 *     turn ends dozens of times inside one turn of its parent's, and its result
 *     goes to the parent, not to you. Counting it would put a number on the
 *     header that no keystroke of the user's could ever discharge.
 *   - `stalled` means "no turn boundary in ten minutes". A junior grinding
 *     through a long tool call is its parent's problem and the parent is
 *     already on the floor saying so.
 *
 * `needs_input` is different in kind: it is the runtime raising a prompt that
 * only a person can answer, and a junior blocked on one blocks its parent
 * with it. That one counts, which is what "unless they raise a hand
 * themselves" means.
 *
 * @param {Pick<Agent,'ackState'|'activityState'|'subagent'>} agent
 * @returns {boolean}
 */
export function needsYou(agent) {
  if (agent.ackState !== 'active') return false;
  if (isSubagent(agent)) return agent.activityState === 'needs_input';
  return /** @type {readonly string[]} */ (NEEDS_YOU_STATES).includes(agent.activityState);
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
    // WP-41: the same rule `needsYou()` states, applied to its breakdown. A
    // junior contributes only when it has raised its own hand.
    const junior = isSubagent(a);
    if (a.activityState === 'needs_input') handsUp++;
    else if (!junior && a.activityState === 'stalled') stalled++;
    else if (!junior && a.activityState === 'for_review') forReview++;
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
  /** @type {Map<string, {id:string,name:string,cwd:string,agentIds:string[],sessionCount:number,tokens:number,cacheTokens:number,costEstimate:number,costRated:boolean,needsYou:number,working:number,activeCount:number,juniors:number}>} */
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
        // WP-41. Juniors in this room right now. They are occupants — they
        // take a seat and they grow the table (`08` B7, §96/§106) — but they
        // are not sessions the user started, so they are counted apart from
        // `sessionCount` and the room plate says "+2 juniors" rather than
        // quietly inflating the session number.
        juniors: 0,
      };
      byId.set(a.projectId, p);
    }
    p.agentIds.push(a.id);
    p.tokens += a.tokens;
    p.cacheTokens += a.cacheTokens;
    p.costEstimate += a.costEstimate ?? 0;
    if (a.costEstimate != null) p.costRated = true;
    // A junior's spend is real spend and it is NOT double counted: verified on
    // this machine that a subagent's turns are written only to its own file
    // and never appear in the parent's transcript (§120).
    if (isSubagent(a)) p.juniors++;
    else if (a.ackState !== 'let_go') p.sessionCount++;
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

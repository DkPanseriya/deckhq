/**
 * The terminal deck — WP-42. `docs/plan/08-PLAN-V2-100X.md` B8.
 *
 *     deckhq ls          the deck, as a table
 *     deckhq waiting     only what needs you
 *     deckhq ack <id>    acknowledge, through the daemon's own act()
 *     deckhq bench <id>  bench, likewise
 *     deckhq open <id>   open the floor at that agent
 *
 * The floor earns the screenshot; the deck does the job
 * (`docs/plan/05-GUI-UX-SPEC.md` §3). This is the deck for the person who is
 * never going to open a browser tab — same order, same ids, same actions, in
 * raw ANSI with no dependency. It is also what makes DeckHQ scriptable, which
 * is how it ends up in somebody else's dotfiles.
 *
 * ## The two halves, and why they are not symmetrical
 *
 * **Reads** work with or without a daemon: with one they are exact, without
 * one they are `state.json` plus the scan cache (see `source.mjs`).
 *
 * **Writes do not.** `ack` and `bench` are `POST /api/ack` on a running daemon
 * and nothing else. There is no offline write path and there must never be
 * one: `act()` in `src/core/state-machine.mjs` is the only function in this
 * product allowed to clear `reviewSince` or `needsInputSince`, a second writer
 * against the same file would be two representations of the same state allowed
 * to disagree, and a CLI that edited `state.json` while a daemon held it in
 * memory would have its edit overwritten by the next debounced save. With no
 * daemon these commands print one line and exit 2.
 *
 * Nothing here clears a user-owned state except `ack` and `bench`, which are
 * the user typing an explicit command. Listing, resolving an id and opening a
 * browser all leave the model exactly as they found it.
 *
 * No egress. The only sockets opened are to 127.0.0.1.
 */
import process from 'node:process';

import { openUrl } from '../core/actions.mjs';
import { needsYou, splitAgentId } from '../core/model.mjs';
import { candidatePorts, findDaemon, readDeck, waitStart } from './source.mjs';

/** Longer than the status line's 150 ms: these commands are typed, not polled. */
const READ_TIMEOUT_MS = 1500;

/** What the user sees when a daemon is required and there is not one. */
export const NO_DAEMON = 'start deckhq to act';

/**
 * The state glyphs, from the deck spec's own table
 * (`docs/plan/05-GUI-UX-SPEC.md` §3.2), each padded to two terminal columns.
 *
 * `✋` and `⏳` are emoji and occupy two columns; `✓` and `·` occupy one. A
 * table whose columns move depending on which state a row is in is a table
 * nobody can `awk`, so the padding is part of the glyph rather than something
 * the layout has to know about.
 */
const ICONS = {
  for_review: '✓ ',
  needs_input: '✋',
  stalled: '⏳',
  working: '· ',
  ended: '  ',
};

// ---------------------------------------------------------------------------
// Colour
// ---------------------------------------------------------------------------

/**
 * Should this output carry ANSI?
 *
 * `NO_COLOR` is honoured as the convention defines it — set at all, to any
 * value including the empty string, means no colour — and a non-TTY stdout
 * means the output is being piped into something that wants text. `TERM=dumb`
 * is the third case, and `--no-color` is the explicit one.
 *
 * @param {{env?:any, isTTY?:boolean, argv?:string[]}} [opts]
 * @returns {boolean}
 */
export function useColor(opts = {}) {
  const env = opts.env || process.env;
  const argv = opts.argv || [];
  if (argv.includes('--no-color')) return false;
  if (Object.prototype.hasOwnProperty.call(env, 'NO_COLOR')) return false;
  if (env.TERM === 'dumb') return false;
  const isTTY = opts.isTTY ?? Boolean(process.stdout.isTTY);
  return isTTY;
}

/**
 * The four colours this surface uses, or four identity functions.
 * @param {boolean} on
 */
export function palette(on) {
  const ESC = String.fromCharCode(27);
  const wrap = (code) => (on ? (s) => `${ESC}[${code}m${s}${ESC}[0m` : (s) => String(s));
  return {
    dim: wrap('2'),
    bold: wrap('1'),
    /** for_review — a finished turn, the thing to look at */
    review: wrap('32'),
    /** needs_input — a raised hand, blocked until answered */
    hand: wrap('33'),
    /** stalled — quiet for longer than the window */
    stalled: wrap('35'),
    /** past a day of waiting; the floor uses --accent for the same fact */
    old: wrap('31'),
    plain: (s) => String(s),
  };
}

// ---------------------------------------------------------------------------
// Ordering
// ---------------------------------------------------------------------------

/**
 * The deck's groups, in the deck's order.
 *
 * `docs/plan/05-GUI-UX-SPEC.md` §3.2: oldest first, `for_review` and
 * `needs_input` above `stalled`, separated by a rule, "because a raised hand
 * and a finished turn need different responses and a stall is not a debt in
 * the same way". `ls` adds a third group — everybody else on the payroll, most
 * recent first, since for a row that is not waiting the useful fact is what
 * happened last and not how long ago it started.
 *
 * @param {any[]} agents
 * @param {{all?:boolean, waitingOnly?:boolean}} [opts]
 * @returns {Array<{key:string, rows:any[]}>}
 */
export function groupRows(agents, opts = {}) {
  const list = Array.isArray(agents) ? agents : [];

  const queue = list
    .filter((a) => needsYou(a) && a.activityState !== 'stalled')
    .sort((a, b) => waitStart(a) - waitStart(b) || String(a.id).localeCompare(String(b.id)));

  const stalled = list
    .filter((a) => needsYou(a) && a.activityState === 'stalled')
    .sort((a, b) => waitStart(a) - waitStart(b) || String(a.id).localeCompare(String(b.id)));

  /** @type {Array<{key:string, rows:any[]}>} */
  const groups = [
    { key: 'waiting', rows: queue },
    { key: 'stalled', rows: stalled },
  ];

  if (!opts.waitingOnly) {
    const rest = list
      .filter((a) => a.ackState === 'active' && !needsYou(a))
      .sort(
        (a, b) =>
          (b.lastActivityAt || 0) - (a.lastActivityAt || 0) ||
          String(a.id).localeCompare(String(b.id)),
      );
    groups.push({ key: 'rest', rows: rest });

    if (opts.all) {
      const off = list
        .filter((a) => a.ackState !== 'active')
        .sort(
          (a, b) =>
            (b.lastActivityAt || 0) - (a.lastActivityAt || 0) ||
            String(a.id).localeCompare(String(b.id)),
        );
      groups.push({ key: 'off', rows: off });
    }
  }

  return groups.filter((g) => g.rows.length > 0);
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

/**
 * "1d 2h", "4h 12m", "40m", "7m" — the spec's own waiting column, which shows
 * two units while the wait is long enough for the second one to matter.
 * @param {number} ms
 */
export function waited(ms) {
  if (!Number.isFinite(ms) || ms < 0) return '';
  const m = Math.floor(ms / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return h < 10 ? `${h}h ${String(m % 60).padStart(2, '0')}m` : `${h}h`;
  const d = Math.floor(h / 24);
  return `${d}d ${h % 24}h`;
}

/** Thousands separators without depending on the machine's ICU build. */
export function group(n) {
  const s = String(Math.trunc(Math.abs(Number(n) || 0)));
  const parts = [];
  for (let i = s.length; i > 0; i -= 3) parts.unshift(s.slice(Math.max(0, i - 3), i));
  return (Number(n) < 0 ? '-' : '') + parts.join(',');
}

/**
 * Cut to width on character count, with an ellipsis, the way the deck spec's
 * LAST WORD column does. Newlines and runs of whitespace collapse first: a
 * table row is one line by definition.
 * @param {string} s @param {number} width
 */
export function cut(s, width) {
  const t = String(s ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  if (t.length <= width) return t;
  return t.slice(0, Math.max(0, width - 1)) + '…';
}

/** The id a person can type back at us: the MK tag, or the session id's head. */
export function shortId(agent) {
  return agent?.mk || splitAgentId(String(agent?.id || '')).sessionId.slice(0, 8);
}

/**
 * One agent as a row of cells, in the deck spec's column order:
 * WAITING · state · WHO · MK · PROJECT · LAST WORD · TOKENS.
 * @param {any} agent
 * @param {number} now
 */
export function rowCells(agent, now) {
  const start = waitStart(agent);
  const waiting = needsYou(agent) && start ? waited(now - start) : '';
  return {
    waiting,
    icon: ICONS[agent.activityState] ?? '  ',
    // The name the user gave, and failing that the session's own title. The
    // spec's WHO column holds "Ada"; almost nobody has named an agent yet, and
    // repeating the MK tag from the column beside it says nothing at all. See
    // docs/DEVIATIONS.md §93.
    who: agent.displayName || agent.title || '',
    mk: shortId(agent),
    project: agent.projectName || agent.projectId || '',
    last: agent.lastText || '',
    tokens: agent.tokens ? group(agent.tokens) : '',
    state: agent.activityState,
    old: Boolean(start) && now - start > 24 * 3600 * 1000,
    agent,
  };
}

const WIDTHS = { waiting: 9, who: 12, mk: 10, project: 18, last: 40, tokens: 9 };

/**
 * The table. Widths are fixed rather than terminal-derived: the deck is meant
 * to be diffable, greppable and stable between runs, and a column that moves
 * when the window resizes is a column you cannot `awk`.
 *
 * @param {any[]} agents
 * @param {{now?:number, color?:boolean, all?:boolean, waitingOnly?:boolean,
 *          source?:string, port?:number|null}} [opts]
 * @returns {string}
 */
export function renderDeck(agents, opts = {}) {
  const now = opts.now ?? Date.now();
  const c = palette(Boolean(opts.color));
  const groups = groupRows(agents, opts);

  const pad = (s, w) => {
    const t = String(s);
    return t.length >= w ? t : t + ' '.repeat(w - t.length);
  };
  const padStart = (s, w) => {
    const t = String(s);
    return t.length >= w ? t : ' '.repeat(w - t.length) + t;
  };

  const header = c.dim(
    '  ' +
      padStart('WAITING', WIDTHS.waiting) +
      '    ' +
      pad('WHO', WIDTHS.who) +
      // The spec leaves this column unlabelled — in the GUI you never type an
      // id, you press J/K. Here you do. docs/DEVIATIONS.md §93.
      pad('ID', WIDTHS.mk) +
      pad('PROJECT', WIDTHS.project) +
      pad('LAST WORD', WIDTHS.last) +
      padStart('TOKENS', WIDTHS.tokens),
  );

  const width =
    2 + WIDTHS.waiting + 3 + WIDTHS.who + WIDTHS.mk + WIDTHS.project + WIDTHS.last + WIDTHS.tokens;
  const rule = c.dim('  ' + '─'.repeat(Math.max(10, width - 4)));

  /** @param {ReturnType<typeof rowCells>} cell */
  const line = (cell) => {
    const tint =
      cell.state === 'for_review'
        ? c.review
        : cell.state === 'needs_input'
          ? c.hand
          : cell.state === 'stalled'
            ? c.stalled
            : c.dim;
    const when = cell.old
      ? c.old(padStart(cell.waiting, WIDTHS.waiting))
      : padStart(cell.waiting, WIDTHS.waiting);
    return (
      '  ' +
      when +
      ' ' +
      tint(cell.icon) +
      ' ' +
      pad(cut(cell.who, WIDTHS.who - 1), WIDTHS.who) +
      c.dim(pad(cut(cell.mk, WIDTHS.mk - 1), WIDTHS.mk)) +
      pad(cut(cell.project, WIDTHS.project - 1), WIDTHS.project) +
      pad(cut(cell.last, WIDTHS.last - 1), WIDTHS.last) +
      c.dim(padStart(cell.tokens, WIDTHS.tokens))
    );
  };

  const lines = [''];
  if (groups.length === 0) {
    lines.push('  nothing is waiting on you', '');
    if (opts.source === 'state')
      lines.push(c.dim('  read from ~/.deckhq — DeckHQ is not running'), '');
    return lines.join('\n');
  }

  lines.push(header);
  groups.forEach((g, i) => {
    if (i > 0) lines.push(rule);
    for (const agent of g.rows) lines.push(line(rowCells(agent, now)));
  });
  lines.push('');
  if (opts.source === 'state') {
    lines.push(
      c.dim(
        '  read from ~/.deckhq — DeckHQ is not running, so nothing here knows what is live, ' +
          'and `ack` and `bench` need it',
      ),
      '',
    );
  }
  return lines.join('\n');
}

/** The JSON shape for `--json`. Flat, and every field a script would need. */
export function jsonRows(agents, opts = {}) {
  const now = opts.now ?? Date.now();
  const groups = groupRows(agents, opts);
  /** @type {any[]} */
  const rows = [];
  for (const g of groups) {
    for (const agent of g.rows) {
      const start = waitStart(agent);
      rows.push({
        id: agent.id,
        mk: agent.mk ?? null,
        name: agent.displayName ?? null,
        title: agent.title ?? '',
        project: agent.projectName || agent.projectId || '',
        cwd: agent.cwd || '',
        group: g.key,
        activityState: agent.activityState,
        ackState: agent.ackState,
        live: agent.live === true,
        waitingSince: needsYou(agent) && start ? start : null,
        waitingMs: needsYou(agent) && start ? Math.max(0, now - start) : null,
        tokens: agent.tokens || 0,
        lastText: agent.lastText || '',
      });
    }
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Id resolution
// ---------------------------------------------------------------------------

/**
 * Turn what somebody typed into exactly one agent id.
 *
 * Accepts the MK tag (`MK1.1`, case-insensitively, with or without the `MK`),
 * a display name, the full prefixed agent id, or any prefix of the runtime
 * session id — because the id a person has in front of them is whatever the
 * deck printed, and the deck prints the tag.
 *
 * An ambiguous token is an error rather than a guess. These ids address
 * `ack` and `bench`, and acting on the wrong agent silently is precisely the
 * failure the invariant exists to prevent.
 *
 * @param {any[]} agents
 * @param {string} token
 * @returns {{id:string}|{error:string, matches?:any[]}}
 */
export function resolveId(agents, token) {
  const raw = String(token ?? '').trim();
  if (!raw) return { error: 'an id is required' };
  const needle = raw.toLowerCase();
  const list = Array.isArray(agents) ? agents : [];

  const exact = list.filter(
    (a) =>
      String(a.id).toLowerCase() === needle ||
      String(a.mk || '').toLowerCase() === needle ||
      `mk${needle}` === String(a.mk || '').toLowerCase() ||
      String(a.displayName || '').toLowerCase() === needle,
  );
  if (exact.length === 1) return { id: exact[0].id };
  if (exact.length > 1) return { error: `"${raw}" matches ${exact.length} agents`, matches: exact };

  const prefixed = list.filter((a) => {
    const { sessionId } = splitAgentId(String(a.id));
    return (
      sessionId.toLowerCase().startsWith(needle) || String(a.id).toLowerCase().startsWith(needle)
    );
  });
  if (prefixed.length === 1) return { id: prefixed[0].id };
  if (prefixed.length > 1) {
    return { error: `"${raw}" matches ${prefixed.length} agents`, matches: prefixed };
  }
  return { error: `no agent matches "${raw}"` };
}

// ---------------------------------------------------------------------------
// Entry points
// ---------------------------------------------------------------------------

const LS_HELP = [
  'deckhq ls — every agent on the payroll, as a table.',
  'deckhq waiting — only the ones waiting on you.',
  '',
  'Usage: deckhq ls [--json] [--all] [--no-color] [--port <n>]',
  '       deckhq waiting [--json] [--no-color] [--port <n>]',
  '',
  '  --json       the same rows as JSON',
  '  --all        include benched and let-go agents',
  '  --no-color   no ANSI, whatever the terminal is (NO_COLOR is honoured too)',
  '  --port <n>   also look for a running DeckHQ on this port',
  '  --help       this message',
  '',
  'Reads a running DeckHQ if there is one, ~/.deckhq/state.json and the scan',
  'cache if there is not. Makes no outbound network calls.',
  '',
].join('\n');

const ACT_HELP = [
  'deckhq ack <id>    — this one is dealt with; it goes back to its desk.',
  'deckhq bench <id>  — park it in the lounge until you recall it.',
  'deckhq open <id>   — open the floor at that agent.',
  '',
  '<id> is the MK tag the deck prints (MK1.1), a name you gave, or any prefix',
  'of the session id. `deckhq ls` prints them.',
  '',
  'ack and bench need a running DeckHQ: every user-owned state change in this',
  'product goes through one code path, and that path lives in the daemon.',
  '',
].join('\n');

/** @param {string[]} argv @param {string} name */
function option(argv, name) {
  const i = argv.indexOf(name);
  if (i === -1 || i === argv.length - 1) return null;
  return argv[i + 1];
}

/** @param {string[]} argv */
function portOf(argv) {
  const v = option(argv, '--port');
  return v != null ? Number(v) || null : null;
}

/** The first bare word in argv — the id, for the acting commands. */
function firstArg(argv) {
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('-')) {
      if (argv[i] === '--port') i++; // its value is not the id
      continue;
    }
    return argv[i];
  }
  return null;
}

/**
 * `deckhq ls` and `deckhq waiting`.
 *
 * @param {string[]} [argv]
 * @param {{write?:(s:string)=>void, error?:(s:string)=>void, read?:typeof readDeck,
 *          now?:number, color?:boolean, waitingOnly?:boolean}} [deps]
 * @returns {Promise<number>}
 */
export async function runLs(argv = [], deps = {}) {
  const write = deps.write || ((s) => process.stdout.write(s));
  if (argv.includes('--help') || argv.includes('-h')) {
    write(LS_HELP);
    return 0;
  }

  const read = deps.read || readDeck;
  const json = argv.includes('--json');
  const opts = {
    all: argv.includes('--all'),
    waitingOnly: Boolean(deps.waitingOnly),
    now: deps.now ?? Date.now(),
  };

  const deck = await read({ port: portOf(argv), timeoutMs: READ_TIMEOUT_MS });

  if (json) {
    write(
      JSON.stringify(
        {
          source: deck.source,
          port: deck.port,
          counts: deck.counts,
          rows: jsonRows(deck.agents, opts),
        },
        null,
        2,
      ) + '\n',
    );
    return 0;
  }

  write(
    renderDeck(deck.agents, {
      ...opts,
      color: deps.color ?? useColor({ argv }),
      source: deck.source,
      port: deck.port,
    }),
  );
  return 0;
}

/** `deckhq waiting` — the deck, needs-you only. */
export function runWaiting(argv = [], deps = {}) {
  return runLs(argv, { ...deps, waitingOnly: true });
}

/**
 * `deckhq ack <id>` and `deckhq bench <id>`.
 *
 * The write goes to the running daemon's `/api/ack`, which calls `act()`. With
 * no daemon there is nothing to do but say so: see this module's header.
 *
 * @param {'acknowledge'|'bench'} action
 * @param {string[]} argv
 * @param {{write?:(s:string)=>void, error?:(s:string)=>void, find?:typeof findDaemon,
 *          post?:(port:number, body:any) => Promise<{ok:boolean, status:number, body:any}>}} [deps]
 * @returns {Promise<number>}
 */
export async function runAct(action, argv = [], deps = {}) {
  const write = deps.write || ((s) => process.stdout.write(s));
  const error = deps.error || ((s) => process.stderr.write(s));
  if (argv.includes('--help') || argv.includes('-h') || argv.length === 0) {
    write(ACT_HELP);
    return argv.length === 0 ? 2 : 0;
  }

  const token = firstArg(argv);
  if (!token) {
    error('  an id is required. `deckhq ls` prints them.\n');
    return 2;
  }

  const find = deps.find || findDaemon;
  const found = await find({ port: portOf(argv), timeoutMs: READ_TIMEOUT_MS });
  if (!found) {
    error(`  ${NO_DAEMON}\n`);
    return 2;
  }

  const resolved = resolveId(found.snapshot.agents, token);
  if ('error' in resolved) {
    error(`  ${resolved.error}\n`);
    for (const a of resolved.matches || []) {
      error(`    ${shortId(a)}  ${a.projectName || ''}  ${a.id}\n`);
    }
    return 2;
  }

  // The row from the snapshot, not the one `/api/ack` echoes back: `act()`
  // returns the bare agent and the MK tag is stamped on in `snapshot()`, so
  // the reply would have us confirm the action against an id the user has
  // never seen.
  const row = found.snapshot.agents.find((a) => a.id === resolved.id);

  const post = deps.post || postAck;
  const res = await post(found.port, { id: resolved.id, action });
  if (!res.ok) {
    error(`  ${(res.body && res.body.error) || `the daemon refused this (${res.status})`}\n`);
    return 1;
  }

  const label = row ? shortId(row) : token;
  const who = row && row.displayName ? ` (${row.displayName})` : '';
  write(`  ${action === 'bench' ? 'benched' : 'acknowledged'} ${label}${who}\n`);
  return 0;
}

/**
 * POST `/api/ack`. Separate so a test drives the command without a socket.
 * @param {number} port
 * @param {any} body
 */
export async function postAck(port, body) {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/ack`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', connection: 'close' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(READ_TIMEOUT_MS),
    });
    let parsed = null;
    try {
      parsed = await res.json();
    } catch {
      parsed = null;
    }
    return { ok: res.ok, status: res.status, body: parsed };
  } catch (err) {
    return { ok: false, status: 0, body: { error: err?.message || String(err) } };
  }
}

/**
 * `deckhq open <id>` — the floor, at that agent.
 *
 * The agent is named in the URL fragment, which never reaches the server and
 * is therefore free to be there before the client reads it. See
 * `docs/DEVIATIONS.md` §93: today this opens the floor and prints the tag; the
 * client-side selection is WP-10's, in files this package does not own.
 *
 * @param {string[]} argv
 * @param {{write?:(s:string)=>void, error?:(s:string)=>void, find?:typeof findDaemon,
 *          open?:typeof openUrl}} [deps]
 * @returns {Promise<number>}
 */
export async function runOpen(argv = [], deps = {}) {
  const write = deps.write || ((s) => process.stdout.write(s));
  const error = deps.error || ((s) => process.stderr.write(s));
  if (argv.includes('--help') || argv.includes('-h')) {
    write(ACT_HELP);
    return 0;
  }

  const find = deps.find || findDaemon;
  const found = await find({ port: portOf(argv), timeoutMs: READ_TIMEOUT_MS });
  if (!found) {
    error(`  DeckHQ is not running — there is no floor to open. ${NO_DAEMON}\n`);
    return 2;
  }

  const token = firstArg(argv);
  const base = `http://127.0.0.1:${found.port}/`;
  if (!token) {
    (deps.open || openUrl)(base);
    write(`  ${base}\n`);
    return 0;
  }

  const resolved = resolveId(found.snapshot.agents, token);
  if ('error' in resolved) {
    error(`  ${resolved.error}\n`);
    for (const a of resolved.matches || []) {
      error(`    ${shortId(a)}  ${a.projectName || ''}  ${a.id}\n`);
    }
    return 2;
  }

  const url = `${base}#agent=${encodeURIComponent(resolved.id)}`;
  (deps.open || openUrl)(url);
  write(`  ${url}\n`);
  return 0;
}

/** Exported for the tests that assert what the port scan covers. */
export { candidatePorts };

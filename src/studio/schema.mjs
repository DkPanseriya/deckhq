/**
 * The three Studio artefacts, as schemas — WP-66.
 *
 * `docs/07-STUDIO-DESIGN.md` §3 and §5.1. There are three files, and they are
 * the user's:
 *
 *   `blueprint.md`  goal, non-goals, milestones, acceptance criteria. Prose.
 *                   The only thing validated is that it exists, is a markdown
 *                   file, and carries NO front matter — a plan a person edits
 *                   must not have a machine-readable header that silently
 *                   disagrees with the prose under it.
 *   `roster.json`   the roles, per §3's table.
 *   `board.json`    the cards, per §5.1.
 *
 * ## Refused whole, with the path and the line
 *
 * Every validator answers `{ error, path, line }` and never a partial
 * document, on `validateLayout`'s discipline (`src/core/layout.mjs`): a
 * half-applied board would leave the user with something that matched neither
 * the file nor what they had, and no way to tell which half landed. `path` is
 * where in the document it failed — `cards[2].column` — and `line` is the line
 * of the raw text, when the raw text was handed in.
 *
 * The line is found by counting occurrences of the failing key in the raw
 * text, not by a second parse: `JSON.parse` throws away positions, and a
 * position-preserving parser is a parser, which is a dependency and a
 * different package. It is exact for a file written by this store, which
 * writes one key per line; a minified document reports the line the whole
 * object is on, which is honest and is line 1.
 *
 * ## The one field with a rule of its own
 *
 * `column` is user-owned state (§5.2), so an unknown value is refused rather
 * than coerced to `backlog`. Coercion is how a board silently loses a card the
 * user put somewhere: the value is theirs, and a value this build does not
 * understand is a reason to stop, not to guess.
 */

/**
 * The six columns, in board order. The order is the order the tab draws and
 * the order a screen reader reads (§5.4), so it lives here rather than in the
 * renderer.
 */
export const COLUMNS = /** @type {const} */ ([
  'backlog',
  'ready',
  'in_progress',
  'review',
  'done',
  'blocked',
]);

/**
 * The one column a system write may reach, and only from `blockForBudget()`
 * (§8, `src/studio/budget.mjs`). Named here so the static invariant test has
 * one constant to point at rather than a string literal in two files.
 */
export const BLOCKED_COLUMN = 'blocked';

/** The document versions. Bumped only by a change that cannot be read back. */
export const BOARD_VERSION = 1;
export const ROSTER_VERSION = 1;

/**
 * How a role describes its own tool use in its brief.
 *
 * **Descriptive, not enforced.** §9 is explicit: `allowedTools` is a line in
 * the brief rather than something DeckHQ imposes on the runtime, and the
 * permission card governs tool use for a hired agent exactly as it does for
 * any other session. These three words are what the brief says; nothing in
 * DeckHQ reads them as policy.
 */
export const PERMISSION_POLICIES = /** @type {const} */ (['ask', 'allowlist', 'plan']);

/** Ceilings. A board is a plan somebody reads, not a database. */
export const MAX_CARDS = 500;
export const MAX_ROLES = 32;
export const MAX_ACCEPTANCE = 32;
export const MAX_FLAGS = 32;
export const MAX_TOOLS = 64;
export const MAX_TITLE = 200;
export const MAX_TEXT = 500;
export const MAX_PROMPT = 8000;

/**
 * How many roles one **Hire** may spawn at once (§11.7, owner's default: 6,
 * with a warning above it). Exported here because the number is part of the
 * roster's meaning; WP-68 is what enforces it, since nothing spawns yet.
 */
export const MAX_HIRE_AT_ONCE = 6;

/**
 * `rules.md`'s two-line default (§6.1). Created once and never rewritten: the
 * coding rules are the user's, and a file DeckHQ regenerated would be a file
 * the user's edits kept disappearing from.
 */
export const DEFAULT_RULES = [
  '# Coding rules',
  '',
  '- Write a failing test first, and quote its real counts in the handover.',
  '- Change nothing outside the card; if the card is wrong, say so and stop.',
  '',
].join('\n');

/** A card id, a milestone id, a role name that can be a filename. */
const ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

/**
 * A role name. Wider than `ID_RE` on purpose: a role is a job title a person
 * typed, and "Backend engineer" is a job title. What is refused is what can
 * never be part of a path or a line of text — a separator, a `..`, a control
 * character. Whether a name is safe to put on a **command line** is WP-68's
 * question, and its acceptance criterion (3) answers it there: a name with a
 * space, a quote or a `;` is refused at Hire rather than escaped.
 */
const ROLE_NAME_RE = /^[^\u0000-\u001f\\/:*?"<>|]{1,64}$/;

/** @param {unknown} v */
function isPlainObject(v) {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

/**
 * The line of `raw` on which the `n`th `"key"` appears, or null.
 *
 * See the header for why this counts rather than parses.
 *
 * @param {string|null|undefined} raw
 * @param {string} key
 * @param {number} [occurrence] 1-based
 * @returns {number|null}
 */
export function lineOfKey(raw, key, occurrence = 1) {
  if (typeof raw !== 'string' || !raw) return null;
  const needle = `"${key}"`;
  let from = 0;
  let seen = 0;
  for (;;) {
    const at = raw.indexOf(needle, from);
    if (at === -1) return null;
    seen += 1;
    if (seen >= occurrence) return raw.slice(0, at).split('\n').length;
    from = at + needle.length;
  }
}

/**
 * @typedef {{error:string, path:string, line:number|null}} StudioSchemaError
 */

/**
 * @param {string} message
 * @param {string} where
 * @param {number|null} line
 * @returns {StudioSchemaError}
 */
function fail(message, where, line) {
  return {
    error:
      line == null
        ? `${where || 'the document'}: ${message}`
        : `${where} (line ${line}): ${message}`,
    path: where,
    line,
  };
}

/** @param {unknown} v @param {number} max */
function cleanText(v, max) {
  return typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, '').slice(0, max) : '';
}

/**
 * A budget, or null. `{ tokens, minutes }` per §5.1; the owner's default
 * (§11.5) is that a cap counts BOTH — tokens at the dated rate card and wall
 * time — and that either one trips the stop, so neither is optional when the
 * other is present and neither is invented when it is absent.
 *
 * @param {unknown} v
 * @param {string} where
 * @returns {{budget:{tokens:number|null, minutes:number|null}|null}|StudioSchemaError}
 */
function budgetOf(v, where) {
  if (v == null) return { budget: null };
  if (!isPlainObject(v))
    return fail('a budget is an object with "tokens" and "minutes"', where, null);
  /** @type {{tokens:number|null, minutes:number|null}} */
  const out = { tokens: null, minutes: null };
  for (const key of /** @type {const} */ (['tokens', 'minutes'])) {
    const raw = /** @type {any} */ (v)[key];
    if (raw == null) continue;
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 0) {
      return fail(`"${key}" is a count of 0 or more`, `${where}.${key}`, null);
    }
    out[key] = Math.round(n);
  }
  return { budget: out };
}

/**
 * An empty board for a project that has just been enabled.
 * @param {string} projectKey
 */
export function emptyBoard(projectKey) {
  return { version: BOARD_VERSION, projectKey: String(projectKey || ''), cards: [] };
}

/**
 * An empty roster, likewise. The planner fills it (WP-67); the user owns it.
 * @param {string} projectKey
 */
export function emptyRoster(projectKey) {
  return { version: ROSTER_VERSION, projectKey: String(projectKey || ''), roles: [] };
}

/**
 * `board.json`, validated and normalised, or refused with a path and a line.
 *
 * The normalised form has a FIXED key order, and that is load-bearing: the
 * store writes `JSON.stringify(board, null, 2)`, and WP-66's acceptance
 * includes a byte-identical round trip. A key order that depended on what the
 * input happened to carry would make that round trip a coin toss.
 *
 * @param {unknown} value
 * @param {{raw?:string|null}} [opts] the raw text, when there is one, for line numbers
 * @returns {{board:ReturnType<typeof emptyBoard>}|StudioSchemaError}
 */
export function validateBoard(value, opts = {}) {
  const raw = opts.raw ?? null;
  if (!isPlainObject(value)) return fail('a board is a JSON object', 'board.json', null);
  const doc = /** @type {any} */ (value);

  if (doc.version !== BOARD_VERSION) {
    return fail(
      `this build reads board version ${BOARD_VERSION}, and this file says ${JSON.stringify(doc.version ?? null)}`,
      'version',
      lineOfKey(raw, 'version'),
    );
  }
  const projectKey = typeof doc.projectKey === 'string' ? doc.projectKey.trim() : '';
  if (!/^[0-9a-f]{16}$/.test(projectKey)) {
    return fail(
      'projectKey is the 16 hex characters `projectKeyFor()` produces for the project directory',
      'projectKey',
      lineOfKey(raw, 'projectKey'),
    );
  }
  if (!Array.isArray(doc.cards)) return fail('cards is an array', 'cards', lineOfKey(raw, 'cards'));
  if (doc.cards.length > MAX_CARDS) {
    return fail(`a board holds at most ${MAX_CARDS} cards`, 'cards', lineOfKey(raw, 'cards'));
  }

  /** @type {any[]} */
  const cards = [];
  const seen = new Set();
  for (const [i, rawCard] of doc.cards.entries()) {
    const where = `cards[${i}]`;
    if (!isPlainObject(rawCard)) return fail('a card is an object', where, null);
    const card = /** @type {any} */ (rawCard);

    const id = typeof card.id === 'string' ? card.id.trim() : '';
    if (!ID_RE.test(id)) {
      return fail(
        'a card id is letters, digits, . _ or -, and at most 64 of them',
        `${where}.id`,
        lineOfKey(raw, 'id', i + 1),
      );
    }
    if (seen.has(id)) {
      return fail(`"${id}" appears twice`, `${where}.id`, lineOfKey(raw, 'id', i + 1));
    }
    seen.add(id);

    // THE ONE THAT MATTERS. §5.2: the column is user-owned, so an unknown
    // value stops the read rather than being coerced into `backlog`.
    const col = typeof card.column === 'string' ? card.column.trim() : '';
    if (!(/** @type {readonly string[]} */ (COLUMNS).includes(col))) {
      return fail(
        `"${col}" is not a column. The six are ${COLUMNS.join(', ')}.`,
        `${where}.column`,
        lineOfKey(raw, 'column', i + 1),
      );
    }

    const milestone = card.milestone == null ? null : cleanText(card.milestone, 64).trim() || null;
    const role = card.role == null ? null : cleanText(card.role, 64).trim() || null;
    if (role != null && !ROLE_NAME_RE.test(role)) {
      return fail(
        'a role name carries no path separator and no control character',
        `${where}.role`,
        lineOfKey(raw, 'role', i + 1),
      );
    }

    const acceptance = [];
    if (card.acceptance != null) {
      if (!Array.isArray(card.acceptance)) {
        return fail(
          'acceptance is an array of criteria, each a line of text',
          `${where}.acceptance`,
          lineOfKey(raw, 'acceptance', i + 1),
        );
      }
      if (card.acceptance.length > MAX_ACCEPTANCE) {
        return fail(
          `a card holds at most ${MAX_ACCEPTANCE} acceptance criteria`,
          `${where}.acceptance`,
          lineOfKey(raw, 'acceptance', i + 1),
        );
      }
      for (const line of card.acceptance) {
        const text = cleanText(line, MAX_TEXT).trim();
        if (text) acceptance.push(text);
      }
    }

    const budget = budgetOf(card.budget, `${where}.budget`);
    if ('error' in budget) return budget;

    const flags = [];
    if (card.flags != null) {
      if (!Array.isArray(card.flags)) {
        return fail('flags is an array', `${where}.flags`, lineOfKey(raw, 'flags', i + 1));
      }
      if (card.flags.length > MAX_FLAGS) {
        return fail(
          `a card holds at most ${MAX_FLAGS} flags`,
          `${where}.flags`,
          lineOfKey(raw, 'flags', i + 1),
        );
      }
      for (const [j, rawFlag] of card.flags.entries()) {
        if (!isPlainObject(rawFlag)) {
          return fail('a flag is an object', `${where}.flags[${j}]`, null);
        }
        const flag = /** @type {any} */ (rawFlag);
        const at = Number(flag.at);
        flags.push({
          kind: cleanText(flag.kind, 32).trim() || 'note',
          text: cleanText(flag.text, MAX_TEXT).trim(),
          at: Number.isFinite(at) ? at : 0,
        });
      }
    }

    const updatedAt = Number(card.updatedAt);
    cards.push({
      id,
      title: cleanText(card.title, MAX_TITLE).trim(),
      acceptance,
      milestone,
      role,
      column: col,
      budget: budget.budget,
      agentId: card.agentId == null ? null : cleanText(card.agentId, 128).trim() || null,
      worktree: card.worktree == null ? null : cleanText(card.worktree, 1024).trim() || null,
      handover: card.handover == null ? null : cleanText(card.handover, 1024).trim() || null,
      flags,
      updatedAt: Number.isFinite(updatedAt) ? updatedAt : 0,
    });
  }

  return { board: { version: BOARD_VERSION, projectKey, cards } };
}

/**
 * `roster.json`, on the same terms.
 *
 * @param {unknown} value
 * @param {{raw?:string|null}} [opts]
 * @returns {{roster:ReturnType<typeof emptyRoster>}|StudioSchemaError}
 */
export function validateRoster(value, opts = {}) {
  const raw = opts.raw ?? null;
  if (!isPlainObject(value)) return fail('a roster is a JSON object', 'roster.json', null);
  const doc = /** @type {any} */ (value);

  if (doc.version !== ROSTER_VERSION) {
    return fail(
      `this build reads roster version ${ROSTER_VERSION}, and this file says ${JSON.stringify(doc.version ?? null)}`,
      'version',
      lineOfKey(raw, 'version'),
    );
  }
  const projectKey = typeof doc.projectKey === 'string' ? doc.projectKey.trim() : '';
  if (!/^[0-9a-f]{16}$/.test(projectKey)) {
    return fail(
      'projectKey is the 16 hex characters `projectKeyFor()` produces for the project directory',
      'projectKey',
      lineOfKey(raw, 'projectKey'),
    );
  }
  if (!Array.isArray(doc.roles)) return fail('roles is an array', 'roles', lineOfKey(raw, 'roles'));
  if (doc.roles.length > MAX_ROLES) {
    return fail(`a roster holds at most ${MAX_ROLES} roles`, 'roles', lineOfKey(raw, 'roles'));
  }

  /** @type {any[]} */
  const roles = [];
  const seen = new Set();
  for (const [i, rawRole] of doc.roles.entries()) {
    const where = `roles[${i}]`;
    if (!isPlainObject(rawRole)) return fail('a role is an object', where, null);
    const role = /** @type {any} */ (rawRole);

    const name = cleanText(role.name, 64).trim();
    if (!ROLE_NAME_RE.test(name)) {
      return fail(
        'a role needs a name, of at most 64 characters, carrying no path separator',
        `${where}.name`,
        lineOfKey(raw, 'name', i + 1),
      );
    }
    const key = name.toLowerCase();
    if (seen.has(key)) {
      return fail(`"${name}" appears twice`, `${where}.name`, lineOfKey(raw, 'name', i + 1));
    }
    seen.add(key);

    const policy = typeof role.permissionPolicy === 'string' ? role.permissionPolicy.trim() : 'ask';
    if (!(/** @type {readonly string[]} */ (PERMISSION_POLICIES).includes(policy))) {
      return fail(
        `"${policy}" is not one of ${PERMISSION_POLICIES.join(', ')}`,
        `${where}.permissionPolicy`,
        lineOfKey(raw, 'permissionPolicy', i + 1),
      );
    }

    const allowedTools = [];
    if (role.allowedTools != null) {
      if (!Array.isArray(role.allowedTools)) {
        return fail(
          'allowedTools is an array of tool names',
          `${where}.allowedTools`,
          lineOfKey(raw, 'allowedTools', i + 1),
        );
      }
      if (role.allowedTools.length > MAX_TOOLS) {
        return fail(
          `a role names at most ${MAX_TOOLS} tools`,
          `${where}.allowedTools`,
          lineOfKey(raw, 'allowedTools', i + 1),
        );
      }
      for (const tool of role.allowedTools) {
        const t = cleanText(tool, 64).trim();
        if (t) allowedTools.push(t);
      }
    }

    const budget = budgetOf(role.budget, `${where}.budget`);
    if ('error' in budget) return budget;

    roles.push({
      name,
      purpose: cleanText(role.purpose, MAX_TEXT).trim(),
      systemPrompt: cleanText(role.systemPrompt, MAX_PROMPT),
      allowedTools,
      permissionPolicy: policy,
      budget: budget.budget,
      // Set at Hire, when the scan finds the session, and never guessed (§4).
      agentId: role.agentId == null ? null : cleanText(role.agentId, 128).trim() || null,
    });
  }

  return { roster: { version: ROSTER_VERSION, projectKey, roles } };
}

/**
 * `blueprint.md`. Existence, and one rule.
 *
 * The rule is that it carries no YAML front matter. A blueprint is prose a
 * person edits and a planner regenerates; a `---` header would be a second,
 * machine-readable copy of the same claims, free to disagree with the prose
 * under it, and the first thing to go stale.
 *
 * @param {unknown} text
 * @returns {{blueprint:string}|StudioSchemaError}
 */
export function validateBlueprint(text) {
  if (typeof text !== 'string' || !text.trim()) {
    return fail('a blueprint is a markdown file with something in it', 'blueprint.md', null);
  }
  // A BOM is not content, and an editor may have put one there.
  const body = text.replace(/^\ufeff/, '');
  if (/^---\s*(\r?\n|$)/.test(body)) {
    return fail(
      'a blueprint carries no front matter — it is prose, and a `---` header would be a second ' +
        'copy of the same claims, free to disagree with them',
      'blueprint.md',
      1,
    );
  }
  return { blueprint: body };
}

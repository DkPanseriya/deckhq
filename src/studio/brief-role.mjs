/**
 * The brief one hired role is started under — WP-68, `docs/07-STUDIO-DESIGN.md`
 * §6.1.
 *
 * `.deckhq/studio/briefs/<role>.md`, from four parts in that order:
 *
 *   1. **the blueprint excerpt** — goal, non-goals, and the milestone the
 *      card belongs to. Not the whole blueprint: a role that is building one
 *      card does not need six milestones, and a brief nobody reads to the end
 *      is a brief whose last part is the one that got ignored.
 *   2. **the card**, if one is assigned — id, title, acceptance, column.
 *   3. **the previous handover and any bounce note**, if there are any, so a
 *      bounced card arrives with the reason it bounced rather than without it.
 *   4. **the coding rules** — `rules.md`, created once with §6.1's two-line
 *      default and NEVER rewritten. `ensureRules()` is the store's, and it
 *      returns `{written:false}` on the second call rather than restoring the
 *      default over the user's edits.
 *
 * ## Written before the spawn, and never under a running session
 *
 * §6.1 in as many words: *it is written before the session is spawned and
 * never regenerated under a running one; a regeneration that would overwrite
 * an edited brief writes `<role>.next.md` and says so*.
 *
 * `ensureRoleBrief()` is the whole of that rule and has exactly three answers:
 *
 *   `{written:true,  beside:null}`  there was none; this call wrote it
 *   `{written:false, beside:null}`  the one on disk is byte-identical to ours
 *   `{written:false, beside:'…'}`   theirs differs. THEIRS is what runs; ours
 *                                   is beside it, and the caller reports it
 *
 * `opts.running` makes the third answer the only one a present brief can get,
 * which is the "never under a running session" half: a session already holds
 * that file open as its system prompt, and rewriting it underneath would
 * change what an agent was told after it was told it.
 *
 * Nothing here spawns anything, reads a transcript or knows what a session is.
 */
import path from 'node:path';

import { DIRS, FILES } from './paths.mjs';

/** How many lines of blueprint a brief carries before it is cut. */
export const MAX_BLUEPRINT_LINES = 120;

/**
 * The one sentence a hired role's session is started WITH, as its first
 * prompt — and it NAMES the brief rather than carrying it (§4).
 *
 * Why a path is in here at all, when `PLANNER_KICKOFF` has none: the planner
 * only ever runs under Claude Code, whose `openNewSession` takes a
 * `systemPromptFile`. A role may be hired on a runtime that has no such
 * option — Codex's `openNewSession` takes `instructions` and nothing else —
 * and a brief the runtime was never told about is a brief nobody reads.
 *
 * What §9 actually forbids is a brief's BODY on a command line and a shell
 * string with user data in it. Neither happens: this is ONE argv element in an
 * array `execFile`/`spawn` passes through untouched, and the only part of the
 * path a person typed is the role name, which `checkRoleName()` has already
 * cut down to letters, digits, `.`, `_` and `-` (`src/studio/worktree.mjs`).
 *
 * @param {string} briefFile absolute path to the role's brief
 * @returns {string}
 */
export function hireKickoff(briefFile) {
  return (
    `Your brief is ${briefFile}. Read it first, then begin the card it names. ` +
    'If the card is missing or wrong, say so in the panel and stop.'
  );
}

/** `briefs/<role>.md`, relative to the studio directory. */
export function roleBriefRel(role) {
  return path.join(DIRS.briefs, `${role}.md`);
}

/** `briefs/<role>.next.md`, likewise. */
export function roleBriefNextRel(role) {
  return path.join(DIRS.briefs, `${role}.next.md`);
}

/** `handovers/<cardId>.bounce.md` — WP-70 writes it; this only ever reads it. */
export function bounceRel(cardId) {
  return path.join(DIRS.handovers, `${cardId}.bounce.md`);
}

/**
 * Split markdown into `{heading, body}` sections at every ATX heading.
 * Everything before the first heading is one section with a null heading.
 * @param {string} text
 */
function sections(text) {
  /** @type {Array<{heading:string|null, lines:string[]}>} */
  const out = [{ heading: null, lines: [] }];
  for (const line of String(text || '').split('\n')) {
    if (/^#{1,6}\s+/.test(line)) out.push({ heading: line, lines: [line] });
    else out[out.length - 1].lines.push(line);
  }
  return out.filter((s) => s.heading !== null || s.lines.join('').trim());
}

/**
 * The parts of the blueprint this role needs: goal, non-goals, constraints,
 * and the section that names its milestone.
 *
 * A HEURISTIC, and it says so in the brief it produces. The blueprint has no
 * required headings — §6.1's planner is asked for prose, not for a schema —
 * so matching on words is the only thing available, and the fallback when
 * nothing matches is the first `MAX_BLUEPRINT_LINES` lines rather than
 * nothing. A role given too much blueprint reads too much; a role given none
 * does not know what it is building.
 *
 * @param {string|null} blueprint
 * @param {string|null} [milestone]
 * @returns {{text:string, whole:boolean}} `whole` when nothing matched and the
 *   head of the file was taken instead
 */
export function blueprintExcerpt(blueprint, milestone = null) {
  const text = String(blueprint || '').trim();
  if (!text) return { text: '', whole: false };

  const want = /goal|non-?goal|scope|constraint|principle/i;
  const mile = String(milestone || '').trim();
  const mileRe = mile
    ? new RegExp(mile.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/[-_\s]+/g, '[-_\\s]+'), 'i')
    : null;

  const picked = sections(text).filter(
    (s) => s.heading && (want.test(s.heading) || (mileRe && mileRe.test(s.heading))),
  );
  if (picked.length === 0) {
    const lines = text.split('\n');
    const head = lines.slice(0, MAX_BLUEPRINT_LINES);
    return { text: head.join('\n').trim(), whole: lines.length <= MAX_BLUEPRINT_LINES };
  }
  const joined = picked
    .map((s) => s.lines.join('\n').trimEnd())
    .join('\n\n')
    .split('\n')
    .slice(0, MAX_BLUEPRINT_LINES)
    .join('\n');
  return { text: joined.trim(), whole: false };
}

/**
 * The card, as the part of the brief that says what to build.
 * @param {any} card
 * @returns {string}
 */
export function cardSection(card) {
  if (!card) {
    return [
      'No card is assigned to this role yet.',
      '',
      'Do not pick one. Say so in the panel and wait: the board is the user\u2019s,',
      'and a card nobody assigned is a card nobody agreed to.',
    ].join('\n');
  }
  const lines = [`**${card.id}** \u2014 ${card.title || '(untitled)'}`, ''];
  if (card.milestone) lines.push(`Milestone: \`${card.milestone}\``);
  lines.push(`Column: \`${card.column}\``);
  if (card.worktree) lines.push(`Worktree on the card: \`${card.worktree}\``);
  lines.push('');
  const acceptance = Array.isArray(card.acceptance) ? card.acceptance.filter(Boolean) : [];
  if (acceptance.length) {
    lines.push('Accepted when:', '');
    for (const a of acceptance) lines.push(`- ${a}`);
  } else {
    lines.push('This card carries no acceptance criteria. Ask for them before you start.');
  }
  const flags = Array.isArray(card.flags) ? card.flags.filter(Boolean) : [];
  if (flags.length) lines.push('', `Flags: ${flags.map((f) => `\`${f}\``).join(', ')}`);
  return lines.join('\n');
}

/**
 * The four parts, rendered. Pure: every input is already read.
 *
 * @param {{role:any, projectRoot:string, worktree:string|null, card:any,
 *          blueprint:string|null, handover:{name:string, text:string}|null,
 *          bounce:{name:string, text:string}|null, rules:string|null,
 *          rulesPath:string}} parts
 * @returns {string}
 */
export function renderRoleBrief(parts) {
  const role = parts.role || {};
  const name = String(role.name || '');
  const excerpt = blueprintExcerpt(parts.blueprint, parts.card?.milestone || null);

  const out = [
    `# ${name}`,
    '',
    `You are **${name}** on this project. ${role.purpose ? role.purpose : ''}`.trim(),
    '',
    `Project: \`${parts.projectRoot}\``,
    parts.worktree ? `Your worktree: \`${parts.worktree}\`` : 'You have no worktree of your own.',
    '',
    'Everything below was assembled from files in `.deckhq/studio/`. This file is',
    'yours to read and the user\u2019s to edit; DeckHQ will not rewrite it under you.',
    '',
    '---',
    '',
    '## 1. The plan',
    '',
  ];
  if (excerpt.text) {
    out.push(
      excerpt.whole
        ? 'The blueprint, whole:'
        : 'The parts of `blueprint.md` that bear on your card. The whole file is beside it:',
      '',
      excerpt.text,
    );
  } else {
    out.push('There is no `blueprint.md` yet. Ask before you build.');
  }

  out.push('', '## 2. Your card', '', cardSection(parts.card));

  out.push('', '## 3. What happened before', '');
  if (parts.handover) {
    out.push(
      `Previous handover \u2014 \`${parts.handover.name}\`:`,
      '',
      parts.handover.text.trim(),
    );
  } else {
    out.push('No previous handover. This card has not been worked before.');
  }
  if (parts.bounce) {
    out.push(
      '',
      `**This card was bounced back.** The note \u2014 \`${parts.bounce.name}\`:`,
      '',
      parts.bounce.text.trim(),
      '',
      'Read it before you touch anything. A bounce is a review that said no.',
    );
  }

  out.push('', '## 4. The coding rules', '');
  out.push(`From \`${parts.rulesPath}\`. They are the user\u2019s; follow them.`, '');
  out.push(String(parts.rules || '').trim() || '(the rules file is empty)');

  if (role.systemPrompt) {
    out.push('', '## 5. What the roster says about you', '', String(role.systemPrompt).trim());
  }
  out.push('');
  return out.join('\n');
}

/**
 * Gather the four parts for one role out of a store, and render them.
 *
 * @param {import('./store.mjs').StudioStore} store
 * @param {any} role a validated roster role
 * @param {{card?:any, worktree?:string|null}} [opts]
 * @returns {string}
 */
export function roleBriefText(store, role, opts = {}) {
  const card = opts.card || null;
  const blueprint = store.readBlueprint();
  /** @type {{name:string, text:string}|null} */
  let handover = null;
  if (card?.handover) {
    const text = store.readDoc('handovers', card.handover);
    if (text != null) handover = { name: card.handover, text };
  }
  /** @type {{name:string, text:string}|null} */
  let bounce = null;
  if (card?.id) {
    const rel = bounceRel(card.id);
    const text = store.readText(rel);
    if (text != null) bounce = { name: path.basename(rel), text };
  }
  return renderRoleBrief({
    role,
    projectRoot: store.root,
    worktree: opts.worktree || null,
    card,
    blueprint: blueprint.blueprint,
    handover,
    bounce,
    rules: store.readRules(),
    rulesPath: store.pathOf(FILES.rules),
  });
}

/**
 * Put one role's brief on disk, without ever overwriting one the user edited
 * and without ever touching one a session is running under (§6.1, §9.3).
 *
 * @param {import('./store.mjs').StudioStore} store
 * @param {any} role
 * @param {{card?:any, worktree?:string|null, running?:boolean}} [opts]
 * @returns {Promise<{file:string, written:boolean, beside:string|null,
 *                    reason:string|null, rulesWritten:boolean}>}
 */
export async function ensureRoleBrief(store, role, opts = {}) {
  // Part four, first: the rules must exist before a brief can quote them, and
  // `ensureRules()` is the one that refuses to rewrite them.
  const rules = await store.ensureRules();

  const rel = roleBriefRel(role.name);
  const text = roleBriefText(store, role, opts);
  const existing = store.readText(rel);

  if (existing == null) {
    const file = await store.writeText(rel, text);
    return { file, written: true, beside: null, reason: null, rulesWritten: rules.written };
  }
  if (existing === text) {
    // Identical is identical whether or not a session is running: there is
    // nothing to overwrite, so there is nothing to refuse.
    return {
      file: store.pathOf(rel),
      written: false,
      beside: null,
      reason: 'identical',
      rulesWritten: rules.written,
    };
  }
  const beside = await store.writeText(roleBriefNextRel(role.name), text);
  return {
    file: store.pathOf(rel),
    written: false,
    beside,
    reason: opts.running ? 'running' : 'edited',
    rulesWritten: rules.written,
  };
}

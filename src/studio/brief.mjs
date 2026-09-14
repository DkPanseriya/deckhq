/**
 * The planner's interview brief — WP-67, `docs/07-STUDIO-DESIGN.md` §2 and §3.
 *
 * The brief is a documented prompt that ships in the package
 * (`./briefs/planner.md`) with a hole in it for every schema. This module is
 * what fills the holes, and the rule it exists to hold is one sentence:
 *
 * **THE SCHEMAS IN THE BRIEF ARE GENERATED FROM `./schema.mjs`, NEVER COPIED.**
 *
 * A hand-written copy of a schema inside a prompt is a copy that goes stale the
 * first time a validator gains a field. The planner is then told the old shape,
 * writes a file this build refuses, and the refusal names a line the planner
 * has no way to understand — which looks exactly like the model being bad at
 * JSON and is in fact us lying to it. So every column name, every policy word,
 * every ceiling and both document versions below are read off the exported
 * constants, and `test/unit/studio-brief.test.mjs` fails if the rendered brief
 * ever disagrees with them.
 *
 * ## What is written, and where
 *
 * The rendered brief goes to `<project>/.deckhq/studio/briefs/planner.md`,
 * which is inside the consented directory (§3) and is a file the user may edit.
 * **An edited brief is never overwritten** (§6.1, §9 invariant 3): a
 * regeneration that would replace one writes `planner.next.md` beside it and
 * says so, and the user's own file is what the planner runs under.
 *
 * Nothing here starts a process, opens a socket or reads a transcript. It
 * renders a string and writes one file through `StudioStore`, which confines
 * every path it is given.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { DIRS, FILES } from './paths.mjs';
import {
  BOARD_VERSION,
  COLUMNS,
  MAX_ACCEPTANCE,
  MAX_CARDS,
  MAX_PROMPT,
  MAX_ROLES,
  MAX_TEXT,
  MAX_TITLE,
  MAX_TOOLS,
  PERMISSION_POLICIES,
  ROSTER_VERSION,
} from './schema.mjs';

/** The brief's filename, under `briefs/`. A role is a filename (§6.1). */
export const PLANNER_BRIEF = 'planner.md';

/** Where a regeneration goes when the user has edited theirs (§6.1). */
export const PLANNER_BRIEF_NEXT = 'planner.next.md';

/** The template that ships in the package. */
export const PLANNER_TEMPLATE = fileURLToPath(new URL('./briefs/planner.md', import.meta.url));

/**
 * The one sentence the planner session is started WITH, as its first prompt.
 *
 * Fixed text, with no user data and no path in it, for the reason §9 gives:
 * argv is an array and nothing interpolated into it is ever a value somebody
 * typed. The brief itself travels as a FILE — `--append-system-prompt-file` —
 * because a brief is long and a prompt is an argument (§4).
 */
export const PLANNER_KICKOFF =
  'Begin the Studio planning interview now. Ask your first question, and wait for my answer.';

/** `briefs/planner.md`, relative to the studio directory. */
export function plannerBriefRel() {
  return path.join(DIRS.briefs, PLANNER_BRIEF);
}

/** `briefs/planner.next.md`, likewise. */
export function plannerBriefNextRel() {
  return path.join(DIRS.briefs, PLANNER_BRIEF_NEXT);
}

/** JSON as the brief shows it — the same two-space form the store writes. */
function block(doc) {
  return JSON.stringify(doc, null, 2);
}

/**
 * The example `roster.json` the brief embeds, built from the schema's own
 * constants. It is an EXAMPLE and is labelled as one in the brief; what makes
 * it trustworthy is that every enumerated value in it came off the validator.
 *
 * `projectKey` is the real one, not a placeholder. Nothing in the project
 * carries it yet — WP-66's `enable` writes one file and it is the README — so
 * a brief that told the planner to "copy it from the file" would be naming a
 * file with no key in it, and the planner would invent sixteen hex characters
 * that the validator would then refuse. It is a value DeckHQ computes, so
 * DeckHQ says what it is.
 *
 * @param {string} projectKey
 */
export function rosterSchemaText(projectKey) {
  return block({
    version: ROSTER_VERSION,
    projectKey,
    roles: [
      {
        name: 'backend',
        purpose: 'one line: what this role is responsible for',
        systemPrompt: 'The system prompt this role runs under.',
        allowedTools: ['Read', 'Edit', 'Bash'],
        permissionPolicy: PERMISSION_POLICIES[0],
        budget: { tokens: 400000, minutes: 90 },
      },
    ],
  });
}

/**
 * The prose rules for `roster.json`, generated from the same constants.
 * @param {string} projectKey
 */
export function rosterRulesText(projectKey) {
  return [
    `- \`version\` is exactly \`${ROSTER_VERSION}\`.`,
    `- \`projectKey\` is exactly \`${projectKey}\` — DeckHQ's own name for this directory. Write`,
    '  it as it is given here. Do not invent one, and do not change it.',
    `- \`roles\` holds at most ${MAX_ROLES} entries, and two roles may not share a name.`,
    '- `name` is at most 64 characters and carries no path separator: it becomes a filename.',
    `- \`purpose\` is at most ${MAX_TEXT} characters; \`systemPrompt\` at most ${MAX_PROMPT}.`,
    `- \`allowedTools\` is an array of at most ${MAX_TOOLS} tool names, and it is DESCRIPTIVE — it`,
    "  is a line in the role's brief, not something DeckHQ enforces on the runtime.",
    `- \`permissionPolicy\` is one of ${PERMISSION_POLICIES.map((p) => `\`${p}\``).join(', ')}.`,
    '  Anything else is refused, not corrected.',
    '- `budget` is `{ "tokens": n, "minutes": n }`, or `null` when the owner named no cap. Do not',
    '  invent a cap they did not give you.',
    '- Do not write an `agentId`. That is set when a role is hired and is never guessed.',
  ].join('\n');
}

/**
 * The example `board.json`, on the same terms.
 * @param {string} projectKey
 */
export function boardSchemaText(projectKey) {
  return block({
    version: BOARD_VERSION,
    projectKey,
    cards: [
      {
        id: 'c1',
        title: 'Refund path returns the fee',
        acceptance: ['a failing test first', 'npm test green'],
        milestone: 'm2',
        role: 'backend',
        column: COLUMNS[0],
        budget: { tokens: 400000, minutes: 90 },
      },
    ],
  });
}

/**
 * The prose rules for `board.json`.
 * @param {string} projectKey
 */
export function boardRulesText(projectKey) {
  return [
    `- \`version\` is exactly \`${BOARD_VERSION}\`, and \`projectKey\` is exactly \`${projectKey}\`.`,
    `- \`cards\` holds at most ${MAX_CARDS} entries, and two cards may not share an \`id\`.`,
    '- `id` is letters, digits, `.`, `_` or `-`, at most 64 of them. `c1`, `c2`, `c3` … is what',
    '  DeckHQ itself uses, and a card id becomes a handover filename, so keep them short.',
    `- \`title\` is at most ${MAX_TITLE} characters.`,
    `- \`acceptance\` is at most ${MAX_ACCEPTANCE} lines, each at most ${MAX_TEXT} characters, and`,
    '  each one a check somebody can answer yes or no to.',
    '- `milestone` names a milestone from the blueprint; `role` names a role from the roster, or',
    '  is `null` when you cannot say which.',
    `- \`column\` is one of ${COLUMNS.map((c) => `\`${c}\``).join(', ')} — and yours is always`,
    `  \`${COLUMNS[0]}\`. See below.`,
    '- `budget` is `{ "tokens": n, "minutes": n }` or `null`, as above.',
    "- Do not write `agentId`, `worktree`, `handover`, `flags` or `updatedAt`. Those are DeckHQ's,",
    '  and a value you wrote there would be a fact nobody measured.',
  ].join('\n');
}

/** The one rule `blueprint.md` has, in the words the validator uses. */
export function blueprintRulesText() {
  return [
    '**No front matter.** The file must not begin with a `---` line. A blueprint is prose a person',
    'edits; a machine-readable header would be a second copy of the same claims, free to disagree',
    'with the prose under it, and a file that starts with `---` is refused whole.',
  ].join('\n');
}

/**
 * Render the brief for one project.
 *
 * @param {string} projectRoot the project directory, absolute
 * @param {{dir:string, projectKey:string}} opts `dir` is
 *   `<project>/.deckhq/studio`, absolute; `projectKey` is `projectKeyFor()`'s
 *   16 hex characters for the same directory
 * @returns {string}
 */
export function renderPlannerBrief(projectRoot, opts) {
  const dir = String(opts?.dir || '');
  const projectKey = String(opts?.projectKey || '');
  const template = fs.readFileSync(PLANNER_TEMPLATE, 'utf8');
  /** @type {Record<string,string>} */
  const fill = {
    PROJECT_ROOT: path.resolve(String(projectRoot || '')),
    PROJECT_KEY: projectKey,
    BLUEPRINT_NAME: FILES.blueprint,
    ROSTER_NAME: FILES.roster,
    BOARD_NAME: FILES.board,
    BLUEPRINT_PATH: path.join(dir, FILES.blueprint),
    ROSTER_PATH: path.join(dir, FILES.roster),
    BOARD_PATH: path.join(dir, FILES.board),
    BLUEPRINT_RULES: blueprintRulesText(),
    ROSTER_SCHEMA: rosterSchemaText(projectKey),
    ROSTER_RULES: rosterRulesText(projectKey),
    BOARD_SCHEMA: boardSchemaText(projectKey),
    BOARD_RULES: boardRulesText(projectKey),
  };
  const out = template.replace(/\{\{([A-Z_]+)\}\}/g, (whole, key) =>
    key in fill ? fill[key] : whole,
  );
  const left = out.match(/\{\{[A-Z_]+\}\}/g);
  if (left) {
    // A template with a hole nobody fills would hand the planner the literal
    // `{{ROSTER_SCHEMA}}`, which it would do its best with. Louder than that.
    throw new Error(`the planner brief template has no value for ${left.join(', ')}`);
  }
  return out;
}

/**
 * Put the brief on disk, without ever overwriting one the user has edited.
 *
 * Three answers:
 *
 *   `{ written:true }`            there was none; this build wrote it
 *   `{ written:false, beside:null }`  the one on disk is byte-identical to ours
 *   `{ written:false, beside:'…' }`   the user edited theirs. THEIRS is what
 *                                     runs; ours is beside it as `.next.md`
 *
 * §9 invariant 3, and §6.1's rule in as many words: *a regeneration that would
 * overwrite an edited brief writes `<role>.next.md` and says so*.
 *
 * @param {import('./store.mjs').StudioStore} store
 * @returns {Promise<{file:string, written:boolean, beside:string|null}>}
 */
export async function ensurePlannerBrief(store) {
  const rel = plannerBriefRel();
  const text = renderPlannerBrief(store.root, { dir: store.dir, projectKey: store.projectKey });
  const existing = store.readText(rel);
  if (existing == null) {
    const file = await store.writeText(rel, text);
    return { file, written: true, beside: null };
  }
  if (existing === text) return { file: store.pathOf(rel), written: false, beside: null };
  const beside = await store.writeText(plannerBriefNextRel(), text);
  return { file: store.pathOf(rel), written: false, beside };
}

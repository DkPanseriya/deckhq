/**
 * Consent for `.deckhq/studio/` — WP-66.
 *
 * `docs/07-STUDIO-DESIGN.md` §3, steps 1–5, and `docs/02-ARCHITECTURE.md` §6.
 * The directory is outside the state directory, so it needs consent, granted
 * **once per project**, and it is granted by exactly the discipline
 * `deckhq shortcut` grants it by (`src/core/launcher.mjs`'s header):
 *
 *   1. Print every path that would be written, and what each is for, before
 *      writing any of them.
 *   2. Write nothing without `confirm: true` (the browser) or `--yes` (the CLI).
 *   3. Tag what is written, so removal can tell ours from somebody else's.
 *   4. Record exactly what was written, in `<state dir>/installed.json`, and
 *      the grant itself in `state.json`.
 *   5. Remove only files that still prove they are ours, and NAME the rest.
 *
 * ## What enable actually writes, and what it only promises
 *
 * One file: `.deckhq/studio/README.md`, carrying the tag on its first line.
 * The three artefacts, `rules.md` and the two directories are on the consent
 * screen because they are what Studio may write from here on — that is what
 * the screen is for — but nothing writes them until there is something to put
 * in them. WP-67 writes the artefacts; WP-68 writes the briefs; WP-70 watches
 * the handovers. **After this package, nothing runs.**
 *
 * ## Why a surface per project
 *
 * `installed.json` is keyed by surface, and `writeRecord()` replaces one
 * surface's entries wholesale. Consent is per project and is never inferred
 * from another (§3.5), so each project gets its own surface —
 * `studio:<projectKey>` — and enabling a second project cannot disturb the
 * first one's record.
 *
 * No egress. No process is started. Nothing outside `<project>/.deckhq/studio/`
 * and the state directory is touched.
 */
import fs from 'node:fs';
import path from 'node:path';

import { apply, recordedEntries, remove } from '../core/launcher-apply.mjs';
import { DATA_DIR } from '../core/paths.mjs';
import { RECORD_NAME } from '../core/launcher.mjs';
import { now as clockNow } from '../core/clock.mjs';
import { projectKeyFor } from '../core/ledger-record.mjs';
import { DIRS, FILES, studioDirFor } from './paths.mjs';

/**
 * The marker every file Studio writes carries, and the only thing `disable`
 * will delete a file for.
 *
 * Its own string rather than the shortcut installer's: the two surfaces are
 * removed by different commands, and a `README.md` that claimed to have been
 * written by `deckhq shortcut` would be a file that lies about where it came
 * from — which is the one thing a tag exists to prevent.
 */
export const STUDIO_TAG = 'deckhq:installed-by-deckhq-studio';

/**
 * The record surface for one project.
 * @param {string} projectKey
 */
export function surfaceFor(projectKey) {
  return `studio:${projectKey}`;
}

/**
 * `.deckhq/studio/README.md`. The tag is on the first line, inside an HTML
 * comment, so it is a marker to `disable` and invisible to a reader.
 *
 * @param {string} projectRoot
 * @returns {string}
 */
export function readmeText(projectRoot) {
  return [
    `<!-- ${STUDIO_TAG} -->`,
    '',
    '# DeckHQ Studio',
    '',
    'This directory holds a plan, a roster and a board for this project. It is **yours**:',
    'commit it, edit it in any editor, review it in a diff. DeckHQ reads it and writes to it,',
    'and will not write anywhere else under this repository.',
    '',
    `Project: ${projectRoot}`,
    '',
    '| File | What it is |',
    '|---|---|',
    `| \`${FILES.blueprint}\` | goal, non-goals, milestones, acceptance criteria |`,
    `| \`${FILES.roster}\` | the roles: purpose, prompt, tools, budget |`,
    `| \`${FILES.board}\` | the cards. A card's column is yours — nothing DeckHQ observes moves one |`,
    `| \`${FILES.rules}\` | your coding rules, written once and never rewritten |`,
    `| \`${DIRS.briefs}/\` | one brief per role, written before a session is started |`,
    `| \`${DIRS.handovers}/\` | one per finished card, written by the agent that finished it |`,
    '',
    'Take it all back out with `deckhq studio disable` — which deletes only files that still',
    'carry the marker on the first line of this one, and names everything else it left alone.',
    '',
  ].join('\n');
}

/**
 * @typedef {{path:string, why:string, written:boolean}} StudioPath
 */

/**
 * Every path Studio may write under this project, with what each one is for.
 *
 * `written: true` marks the ones `enable` writes now; the rest are what it is
 * asking permission for. Both are on the screen, because a consent screen that
 * showed only today's writes would be asking for less than it means.
 *
 * @param {string} projectRoot
 * @returns {StudioPath[]}
 */
export function plannedPaths(projectRoot) {
  const dir = studioDirFor(projectRoot);
  return [
    {
      path: path.join(dir, FILES.readme),
      why: 'what this directory is, and the marker that lets `disable` recognise it. Written now.',
      written: true,
    },
    {
      path: path.join(dir, FILES.blueprint),
      why: 'the plan: goal, non-goals, milestones, acceptance criteria. Yours to edit.',
      written: false,
    },
    {
      path: path.join(dir, FILES.roster),
      why: 'the roles, with their prompts, tools and budgets. Yours to edit.',
      written: false,
    },
    {
      path: path.join(dir, FILES.board),
      why: "the cards. A card's column is yours; nothing DeckHQ observes moves one.",
      written: false,
    },
    {
      path: path.join(dir, FILES.rules),
      why: 'your coding rules, created once with a two-line default and never rewritten.',
      written: false,
    },
    {
      path: path.join(dir, DIRS.briefs) + path.sep,
      why: 'one brief per role, written before a session is started.',
      written: false,
    },
    {
      path: path.join(dir, DIRS.handovers) + path.sep,
      why: 'one per finished card, written by the agent that finished it.',
      written: false,
    },
  ];
}

/**
 * The plan `apply()` takes. Only the README is in `files`, for the reason in
 * the header.
 *
 * The shape is `src/core/launcher.mjs`'s `Plan` less `launcher`, which
 * `apply()` does not read: Studio has no command to run, and inventing one so
 * the shape matched would be a field nobody could believe.
 *
 * @param {string} projectRoot
 * @returns {{surface:string, files:Array<{path:string, why:string, kind:'text', contents:string}>}}
 */
export function planFor(projectRoot) {
  const root = path.resolve(projectRoot);
  const dir = studioDirFor(root);
  return {
    surface: surfaceFor(projectKeyFor(root)),
    files: [
      {
        path: path.join(dir, FILES.readme),
        why: 'what this directory is, and the marker `disable` reads',
        kind: 'text',
        contents: readmeText(root),
      },
    ],
  };
}

/** Two-space-indented lines of at most 78 characters. `launcher.mjs`'s. */
function wrap(text, width = 76) {
  const out = [];
  let line = '';
  for (const word of String(text).split(/\s+/).filter(Boolean)) {
    if (line && line.length + 1 + word.length > width) {
      out.push(`  ${line}`);
      line = word;
    } else {
      line = line ? `${line} ${word}` : word;
    }
  }
  if (line) out.push(`  ${line}`);
  return out;
}

/**
 * The consent screen, as text — §3 step 1. Every path, what each is for, what
 * is written now, and how to take it back out.
 *
 * @param {string} projectRoot
 * @returns {string}
 */
export function describeEnable(projectRoot) {
  const root = path.resolve(projectRoot);
  const lines = [];
  lines.push(`  This would let Studio write inside ${studioDirFor(root)}:`, '');
  for (const entry of plannedPaths(root)) {
    lines.push(`    ${entry.path}${entry.written ? '' : '   (later)'}`, `      ${entry.why}`);
  }
  lines.push(
    '',
    ...wrap(
      `One file is written now: ${FILES.readme}, carrying the marker "${STUDIO_TAG}" on its ` +
        `first line. The rest are what Studio may write from here on, and nothing writes them ` +
        'until there is something to put in them.',
    ),
    '',
    ...wrap(
      `The grant is recorded in <state dir>/state.json and the paths in <state dir>/${RECORD_NAME}. ` +
        'It is granted for THIS project only and is never inferred from another. ' +
        '`deckhq studio disable` deletes only files that still carry the marker, and names ' +
        'everything else it left alone.',
    ),
    '',
    ...wrap(
      'Nothing runs. Studio starts no session, spawns no process and makes no network call in ' +
        'this package; enabling it creates a directory and a record, and that is all.',
    ),
    '',
  );
  return lines.join('\n');
}

/**
 * What `disable` would delete, and what it would leave.
 *
 * The record names what was written; everything else under the directory is
 * the user's — a board they edited, a handover an agent wrote — and is listed
 * so they can see it is being left where it is.
 *
 * @param {string} projectRoot
 * @param {{dataDir?:string}} [opts]
 * @returns {{tagged:string[], others:string[], dir:string}}
 */
export function describeDisable(projectRoot, opts = {}) {
  const root = path.resolve(projectRoot);
  const dir = studioDirFor(root);
  const dataDir = opts.dataDir || DATA_DIR;
  const tagged = recordedEntries(surfaceFor(projectKeyFor(root)), dataDir)
    .filter((e) => e.proof !== 'dir')
    .map((e) => e.path);
  const taggedSet = new Set(tagged);
  const others = walk(dir).filter((f) => !taggedSet.has(f));
  return { tagged, others, dir };
}

/**
 * Every file under the studio directory, one level plus the two known
 * subdirectories. Not recursive without bound: this is a listing for a
 * message, and a directory somebody has put a repository inside is not a
 * reason to walk a repository.
 *
 * @param {string} dir
 * @returns {string[]}
 */
function walk(dir) {
  /** @type {string[]} */
  const out = [];
  const read = (d) => {
    try {
      for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
        if (entry.isFile()) out.push(path.join(d, entry.name));
      }
    } catch {
      /* not there, which is the normal case */
    }
  };
  read(dir);
  for (const sub of Object.values(DIRS)) read(path.join(dir, sub));
  return out.sort();
}

/**
 * Grant consent and write the tagged README — §3 steps 2–3.
 *
 * @param {string} projectRoot
 * @param {{dataDir?:string, store?:any, now?:number}} [opts]
 * @returns {Promise<{written:string[], dirs:string[], consent:{grantedAt:number, root:string},
 *                    projectKey:string, dir:string}>}
 * @throws when a path exists and was not written by DeckHQ — `apply()`'s rule,
 *   unchanged: a `README.md` somebody else wrote is refused, never replaced.
 */
export async function enable(projectRoot, opts = {}) {
  const root = path.resolve(projectRoot);
  const dataDir = opts.dataDir || DATA_DIR;
  const projectKey = projectKeyFor(root);
  const plan = planFor(root);
  const result = await apply(/** @type {any} */ (plan), { dataDir, tag: STUDIO_TAG });
  const consent = { grantedAt: opts.now ?? clockNow(), root };
  opts.store?.grantStudioConsent?.(projectKey, consent);
  return {
    written: result.written,
    dirs: result.dirs,
    consent,
    projectKey,
    dir: studioDirFor(root),
  };
}

/**
 * Take it back out — §3 step 5.
 *
 * Deletes only files the record names AND that still carry the tag; anything
 * else is named and left. The grant is revoked either way: a user who has
 * asked for Studio to be off must not have it on because a file they edited
 * could not be deleted.
 *
 * @param {string} projectRoot
 * @param {{dataDir?:string, store?:any}} [opts]
 * @returns {Promise<{removed:string[], missing:string[], foreign:string[], kept:string[],
 *                    projectKey:string, dir:string}>}
 */
export async function disable(projectRoot, opts = {}) {
  const root = path.resolve(projectRoot);
  const dataDir = opts.dataDir || DATA_DIR;
  const projectKey = projectKeyFor(root);
  const before = describeDisable(root, { dataDir });
  const result = await remove(surfaceFor(projectKey), { dataDir, tag: STUDIO_TAG });
  opts.store?.revokeStudioConsent?.(projectKey);
  return {
    removed: result.removed,
    missing: result.missing,
    foreign: result.foreign,
    kept: before.others,
    projectKey,
    dir: before.dir,
  };
}

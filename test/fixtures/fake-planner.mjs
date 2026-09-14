#!/usr/bin/env node
/**
 * A fake Studio planner, for WP-67 — `test/fixtures/fake-claude.mjs`'s pattern.
 *
 * `fake-claude` stands in for `claude -p` on a machine whose login has expired.
 * This stands in for the other thing a real `claude` does under Studio: it
 * receives the interview brief on its command line, reads it, and writes the
 * three artefacts. It is a real child process with real argv, so the argv
 * `POST /api/studio/plan` builds is exercised for real and asserted verbatim —
 * WP-67 acceptance criterion (2) — and only the interview is missing.
 *
 * It behaves like a planner that has already had the conversation: there is no
 * model here and nothing is inferred. What it writes is fixed text, apart from
 * the paths and the project key, which it takes OUT OF THE BRIEF rather than
 * being told separately. That is the point: if the brief stopped naming the
 * three files, or stopped carrying the project key, this fixture would fail to
 * find them and the test would say so.
 *
 * Configured entirely by environment, so its argv is untouched:
 *
 *   FAKE_PLANNER_ARGV_FILE   write the argv it was given here, as JSON
 *   FAKE_PLANNER_CWD_FILE    write its own working directory here
 *   FAKE_PLANNER_MODE        write (default) | bad-roster | nothing
 *   FAKE_PLANNER_DONE_FILE   touched once every file has been written
 *
 * `bad-roster` writes a `roster.json` whose `permissionPolicy` is a word the
 * schema does not know, on a line this fixture controls, so the test can assert
 * that the failure is reported with its file, its line and its reason — and
 * that nothing rewrites it.
 */

import fs from 'node:fs';
import path from 'node:path';

const argv = process.argv.slice(2);
const mode = process.env.FAKE_PLANNER_MODE || 'write';

if (process.env.FAKE_PLANNER_ARGV_FILE) {
  fs.writeFileSync(process.env.FAKE_PLANNER_ARGV_FILE, JSON.stringify(argv), 'utf8');
}
if (process.env.FAKE_PLANNER_CWD_FILE) {
  fs.writeFileSync(process.env.FAKE_PLANNER_CWD_FILE, process.cwd(), 'utf8');
}

if (mode === 'nothing') {
  // A planner that was started and said nothing. The three files stay absent,
  // which is a plan nobody has written yet and not an error.
  process.exitCode = 0;
} else {
  const flag = argv.indexOf('--append-system-prompt-file');
  if (flag === -1 || !argv[flag + 1]) {
    process.stderr.write(`fake-planner: no brief on the command line: ${JSON.stringify(argv)}\n`);
    process.exitCode = 2;
  } else {
    const brief = fs.readFileSync(argv[flag + 1], 'utf8');

    /** The absolute path the brief names for one artefact. */
    const pathOf = (name) => {
      const line = brief.split('\n').find((l) => l.trim().startsWith('- ') && l.includes(name));
      if (!line) throw new Error(`the brief does not name ${name}`);
      return line.trim().replace(/^- /, '').replace(/^`|`$/g, '');
    };
    const key = /DeckHQ's name for this project directory is `([0-9a-f]{16})`/.exec(brief)?.[1];
    if (!key) throw new Error('the brief does not carry a project key');

    const blueprint = pathOf('blueprint.md');
    const roster = pathOf('roster.json');
    const board = pathOf('board.json');
    for (const file of [blueprint, roster, board]) {
      fs.mkdirSync(path.dirname(file), { recursive: true });
    }

    fs.writeFileSync(
      blueprint,
      [
        '# Orbital',
        '',
        '## Goal',
        '',
        'A refund path that returns the fee.',
        '',
        '## Non-goals',
        '',
        '- No new billing provider.',
        '',
        '## Milestones',
        '',
        '### m1 — the failing test',
        '',
        '- a test that fails for the right reason',
        '',
        '### m2 — the fix',
        '',
        '- npm test green',
        '',
      ].join('\n'),
      'utf8',
    );

    const policy = mode === 'bad-roster' ? 'yolo' : 'ask';
    fs.writeFileSync(
      roster,
      `${JSON.stringify(
        {
          version: 1,
          projectKey: key,
          roles: [
            {
              name: 'backend',
              purpose: 'the refund path',
              systemPrompt: 'You are the backend.',
              allowedTools: ['Read', 'Edit', 'Bash'],
              permissionPolicy: policy,
              budget: { tokens: 400000, minutes: 90 },
            },
          ],
        },
        null,
        2,
      )}\n`,
      'utf8',
    );

    fs.writeFileSync(
      board,
      `${JSON.stringify(
        {
          version: 1,
          projectKey: key,
          cards: [
            {
              id: 'c1',
              title: 'Refund path returns the fee',
              acceptance: ['a failing test first', 'npm test green'],
              milestone: 'm2',
              role: 'backend',
              column: 'backlog',
              budget: { tokens: 400000, minutes: 90 },
            },
          ],
        },
        null,
        2,
      )}\n`,
      'utf8',
    );

    // The last line of the last message, on a line of its own — the brief's
    // own rule, said here so a test can assert the fixture obeys it too.
    process.stdout.write('written\n');
    if (process.env.FAKE_PLANNER_DONE_FILE) {
      fs.writeFileSync(process.env.FAKE_PLANNER_DONE_FILE, 'written', 'utf8');
    }
    process.exitCode = 0;
  }
}

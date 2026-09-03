/**
 * Hook install / remove, and the port it writes.
 *
 * A hook aimed at the wrong port is the one failure mode that looks exactly
 * like a working install from the outside: the settings file is perfect, the
 * header says state is exact, and no event ever arrives. These tests exist to
 * keep that impossible.
 *
 * Both modules resolve their paths at import time from the environment, so
 * the environment is set up before the dynamic imports below.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const CLAUDE_DIR = await fsp.mkdtemp(path.join(os.tmpdir(), 'deckhq-claude-'));
const STATE_DIR = await fsp.mkdtemp(path.join(os.tmpdir(), 'deckhq-state-'));
process.env.CLAUDE_CONFIG_DIR = CLAUDE_DIR;
process.env.DECKHQ_STATE_DIR = STATE_DIR;

const hooks = await import('../../src/adapters/claude-code/hooks.mjs');
const SETTINGS = path.join(CLAUDE_DIR, 'settings.json');

/** Start each test from a known settings file (or none at all). */
async function reset(contents) {
  await fsp.rm(SETTINGS, { force: true });
  if (contents !== undefined) await fsp.writeFile(SETTINGS, contents, 'utf8');
  for (const name of await fsp.readdir(path.join(STATE_DIR, 'backups')).catch(() => [])) {
    await fsp.rm(path.join(STATE_DIR, 'backups', name), { force: true });
  }
}

function read() {
  return JSON.parse(fs.readFileSync(SETTINGS, 'utf8'));
}

/** Every `_deckhq`-tagged command in a settings object. */
function ourCommands(settings) {
  const out = [];
  for (const groups of Object.values(settings.hooks || {})) {
    for (const group of groups || []) {
      for (const h of group.hooks || []) if (h && h._deckhq === true) out.push(h.command);
    }
  }
  return out;
}

test('describe() writes the port it is given, not a hard-coded 4317', () => {
  const plan = hooks.describe(4400);
  assert.match(plan.json, /port:4400,path:'\/api\/hook'/);
  assert.doesNotMatch(plan.json, /port:4317/);
  assert.match(plan.note, /127\.0\.0\.1:4400/);
  assert.equal(plan.file, SETTINGS);
});

test('describe() falls back to the default port when not told one', () => {
  assert.match(hooks.describe().json, /port:4317,path:'\/api\/hook'/);
  assert.equal(hooks.DEFAULT_PORT, 4317);
});

test('install() writes every event, tagged, pointing at the given port', async () => {
  await reset();
  await hooks.install(4400);

  const settings = read();
  const commands = ourCommands(settings);
  assert.equal(commands.length, 9); // 8 events, Notification split across 2 matchers
  for (const c of commands) assert.match(c, /port:4400/);

  assert.equal(await hooks.installed(4400), true);
  assert.equal(await hooks.installedPort(), 4400);
});

test('install() writes the WP-52 tool events, and the consent screen names them', async () => {
  await reset();
  await hooks.install(4317);

  const settings = read();
  for (const event of ['PreToolUse', 'PostToolUse']) {
    const groups = settings.hooks[event];
    assert.ok(Array.isArray(groups) && groups.length === 1, `${event} was not written`);
    // No matcher: every tool, because "which tool" is the whole point.
    assert.equal(groups[0].matcher, undefined);
    assert.equal(groups[0].hooks.length, 1);
    assert.equal(groups[0].hooks[0]._deckhq, true);
    assert.match(groups[0].hooks[0].command, /port:4317,path:'\/api\/hook'/);
  }

  // The consent screen shows the literal JSON and the event list, so both
  // new events have to be visible there before anything is written
  // (docs/02-ARCHITECTURE.md §6).
  const plan = hooks.describe(4317);
  assert.ok(plan.events.includes('PreToolUse'), 'PreToolUse is missing from the consent screen');
  assert.ok(plan.events.includes('PostToolUse'), 'PostToolUse is missing from the consent screen');
  assert.match(plan.json, /"PreToolUse"/);
  assert.match(plan.json, /"PostToolUse"/);
});

test('remove() takes the tool events out again, leaving no empty event keys behind', async () => {
  await reset();
  await hooks.install(4317);
  await hooks.remove();
  // The file did not exist before install and nothing else was added, so it
  // is gone entirely; either way, none of ours may remain.
  const after = fs.existsSync(SETTINGS) ? read() : {};
  assert.equal(ourCommands(after).length, 0);
  assert.equal((after.hooks && after.hooks.PreToolUse) ?? null, null);
  assert.equal((after.hooks && after.hooks.PostToolUse) ?? null, null);
});

test('installed() reports FALSE when the hooks point at a different port', async () => {
  await reset();
  await hooks.install(4400);

  // The daemon came back on a different port. Nothing would be delivered, so
  // this must not read as installed — otherwise the header promises exact
  // state that is never arriving.
  assert.equal(await hooks.installed(4317), false);
  assert.equal(await hooks.installed(4400), true);
  // Asking without a port still answers "is anything of ours present".
  assert.equal(await hooks.installed(), true);
});

test('install() at the same port twice is a byte-for-byte no-op', async () => {
  await reset();
  await hooks.install(4400);
  const first = fs.readFileSync(SETTINGS, 'utf8');
  await hooks.install(4400);
  assert.equal(fs.readFileSync(SETTINGS, 'utf8'), first);
});

test('install() at a new port repoints rather than accumulating a second set', async () => {
  await reset();
  await hooks.install(4317);
  await hooks.install(4400);

  const commands = ourCommands(read());
  assert.equal(commands.length, 9, 'the stale set must be removed, not left behind');
  for (const c of commands) assert.match(c, /port:4400/);
  assert.equal(await hooks.installed(4400), true);
  assert.equal(await hooks.installed(4317), false);
});

test('remove() restores the original file byte-for-byte', async () => {
  const original = JSON.stringify(
    { model: 'opus', hooks: { Stop: [{ hooks: [{ type: 'command', command: 'echo hi' }] }] } },
    null,
    2,
  );
  await reset(original);
  await hooks.install(4317);
  assert.notEqual(fs.readFileSync(SETTINGS, 'utf8'), original);

  await hooks.remove();
  assert.equal(fs.readFileSync(SETTINGS, 'utf8'), original);
  assert.equal(await hooks.installed(4317), false);
  assert.equal(await hooks.installedPort(), null);
});

test("remove() leaves another tool's untagged hooks alone", async () => {
  const theirs = { type: 'command', command: 'echo hi' };
  await reset(JSON.stringify({ hooks: { Stop: [{ hooks: [theirs] }] } }, null, 2));
  await hooks.install(4317);

  // The user edits the file by hand after install, so the byte-identical
  // restore path cannot be taken and the pruning path has to be correct.
  const edited = read();
  edited.permissions = { allow: ['Bash'] };
  await fsp.writeFile(SETTINGS, JSON.stringify(edited, null, 2), 'utf8');

  await hooks.remove();
  const after = read();
  assert.deepEqual(after.hooks.Stop, [{ hooks: [theirs] }]);
  assert.deepEqual(after.permissions, { allow: ['Bash'] });
  assert.equal(ourCommands(after).length, 0);
});

test('a malformed settings file aborts with a clear error and changes nothing', async () => {
  const broken = '{ this is not json';
  await reset(broken);
  await assert.rejects(() => hooks.install(4317), /not valid JSON/);
  assert.equal(fs.readFileSync(SETTINGS, 'utf8'), broken);
  assert.equal(await hooks.installed(4317), false, 'never throws, just reads as not installed');
});

test('install() backs the original up outside the package directory', async () => {
  await reset(JSON.stringify({ model: 'opus' }, null, 2));
  await hooks.install(4317);

  const backups = await fsp.readdir(path.join(STATE_DIR, 'backups'));
  assert.ok(
    backups.some((n) => /^settings-backup-\d+\.json$/.test(n)),
    'a backup is written to the user data directory, not next to the package',
  );
});

// ---------------------------------------------------------------------------
// WP-52 — the tool summary parsed out of a PreToolUse payload.
//
// Paths are built with `path.join` from a real absolute base, so these run
// the same way on Windows and POSIX (`path.relative` is platform-specific by
// design, and so is the thing being tested).
// ---------------------------------------------------------------------------

const SESSION_CWD = path.join(path.resolve(os.tmpdir()), 'deckhq-project');

/** @param {string} name @param {object} input @param {string} [cwd] */
function pre(name, input, cwd = SESSION_CWD) {
  return {
    session_id: 's',
    cwd,
    hook_event_name: 'PreToolUse',
    tool_name: name,
    tool_input: input,
  };
}

test('toolSummary: Bash carries the command, cut to 80 characters', () => {
  assert.deepEqual(hooks.toolSummary(pre('Bash', { command: 'npm test' })), {
    name: 'Bash',
    summary: 'Bash npm test',
  });
  const long = hooks.toolSummary(pre('Bash', { command: 'x'.repeat(500) }));
  // 80 characters of command (79 + an ellipsis), plus "Bash ".
  assert.equal(long.summary.length, 85);
  assert.ok(long.summary.startsWith('Bash xxx'));
  assert.ok(long.summary.endsWith('…'));
});

test('toolSummary: Edit and Read carry a path relative to the session cwd', () => {
  assert.equal(
    hooks.toolSummary(pre('Edit', { file_path: path.join(SESSION_CWD, 'src', 'foo.ts') })).summary,
    'Edit src/foo.ts',
  );
  assert.equal(
    hooks.toolSummary(pre('Read', { file_path: path.join(SESSION_CWD, 'README.md') })).summary,
    'Read README.md',
  );
  // Separators are normalised for display, whatever the platform uses.
  assert.doesNotMatch(
    hooks.toolSummary(pre('Edit', { file_path: path.join(SESSION_CWD, 'a', 'b', 'c.ts') })).summary,
    /\\/,
  );
});

test('SECURITY: a path outside the session cwd is reduced to its basename', () => {
  // The bubble ends up on a floor that gets screenshotted. WP-52's acceptance
  // criterion is that it "never contains project paths outside the session's
  // cwd" — so an absolute path elsewhere, a parent-directory escape and a
  // different drive all keep nothing but the last segment.
  const elsewhere = path.join(path.resolve(os.tmpdir()), 'someone-elses-secret', 'notes.md');
  assert.equal(hooks.toolSummary(pre('Read', { file_path: elsewhere })).summary, 'Read notes.md');
  assert.equal(
    hooks.toolSummary(pre('Edit', { file_path: path.join(SESSION_CWD, '..', 'up.txt') })).summary,
    'Edit up.txt',
  );
  const other = process.platform === 'win32' ? 'Z:\\other\\deep\\file.rs' : '/other/deep/file.rs';
  assert.equal(hooks.toolSummary(pre('Edit', { file_path: other })).summary, 'Edit file.rs');
  // A relative path is resolved against the SESSION's cwd, never the
  // daemon's — otherwise it would escape by accident.
  assert.equal(
    hooks.toolSummary(pre('Read', { file_path: 'src/deep/thing.ts' })).summary,
    'Read src/deep/thing.ts',
  );
});

test('SECURITY: control characters and newlines never survive into a summary', () => {
  const nasty = `npm test\n\r\tthen \u001b[31mred\u001b[0m and \u202ereversed`;
  const out = hooks.toolSummary(pre('Bash', { command: nasty }));
  assert.doesNotMatch(out.summary, /[\u0000-\u001F\u007F-\u009F\u202A-\u202E]/);
  assert.equal(out.summary.includes('\n'), false);
  assert.match(out.summary, /^Bash npm test then \[31mred/);
});

test('toolSummary: any other tool is its name alone, and never longer than 120 characters', () => {
  assert.deepEqual(hooks.toolSummary(pre('WebFetch', { url: 'https://example.invalid/x' })), {
    name: 'WebFetch',
    summary: 'WebFetch',
  });
  assert.equal(hooks.toolSummary(pre('Task', {})).summary, 'Task');
  for (const payload of [
    pre('Bash', { command: 'y'.repeat(4000) }),
    pre('Edit', { file_path: path.join(SESSION_CWD, 'a'.repeat(400), 'b'.repeat(400)) }),
    pre('W'.repeat(400), {}),
  ]) {
    const out = hooks.toolSummary(payload);
    assert.ok(out.summary.length <= 120, `"${out.summary}" is ${out.summary.length} chars`);
  }
});

test('toolSummary: a payload that names no tool has nothing to say', () => {
  assert.equal(hooks.toolSummary(pre('', { command: 'npm test' })), null);
  assert.equal(hooks.toolSummary({}), null);
  assert.equal(hooks.toolSummary(null), null);
  // A tool with no input at all still reports itself.
  assert.equal(hooks.toolSummary({ tool_name: 'Bash' }).summary, 'Bash');
  // ...and a Bash with an empty command falls back to the bare name rather
  // than a trailing space.
  assert.equal(hooks.toolSummary(pre('Bash', { command: '   ' })).summary, 'Bash');
});

test.after(async () => {
  await fsp.rm(CLAUDE_DIR, { recursive: true, force: true });
  await fsp.rm(STATE_DIR, { recursive: true, force: true });
});

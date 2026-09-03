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

/** Every `_deckhq`-tagged entry in a settings object, of any type. */
function ourEntries(settings) {
  const out = [];
  for (const groups of Object.values(settings.hooks || {})) {
    for (const group of groups || []) {
      for (const h of group.hooks || []) if (h && h._deckhq === true) out.push(h);
    }
  }
  return out;
}

/**
 * Every `_deckhq`-tagged `command` entry's command line. WP-19 added one
 * `http` entry to the block, which has no command at all — it is checked
 * separately by `ourHttp` below.
 */
function ourCommands(settings) {
  return ourEntries(settings)
    .filter((h) => h.type !== 'http')
    .map((h) => h.command);
}

/** Every `_deckhq`-tagged `http` entry (WP-19's PermissionRequest hook). */
function ourHttp(settings) {
  return ourEntries(settings).filter((h) => h.type === 'http');
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
  assert.equal(commands.length, 9); // 8 command events, Notification split across 2 matchers
  for (const c of commands) assert.match(c, /port:4400/);

  // WP-19's PermissionRequest is the tenth entry and the only `http` one.
  const http = ourHttp(settings);
  assert.equal(http.length, 1);
  assert.equal(http[0].url, 'http://127.0.0.1:4400/api/permission');

  assert.equal(await hooks.installed(4400), true);
  assert.equal(await hooks.installedPort(), 4400);
});

test('install() writes PermissionRequest as an http hook that holds, and the consent screen says what it does', async () => {
  await reset();
  await hooks.install(4317);

  const settings = read();
  const groups = settings.hooks.PermissionRequest;
  assert.ok(Array.isArray(groups) && groups.length === 1, 'PermissionRequest was not written');
  // No matcher and no `if`: the product's claim is that EVERY raised hand
  // appears, so the hook narrows on nothing (docs/DEVIATIONS.md §86.4).
  assert.equal(groups[0].matcher, undefined);
  assert.equal(groups[0].if, undefined);
  assert.equal(groups[0].hooks.length, 1);

  const entry = groups[0].hooks[0];
  assert.equal(entry.type, 'http');
  assert.equal(entry._deckhq, true);
  // Its own route: /api/hook answers in under 200 ms by contract, this one
  // holds. Two contracts, two routes (§86.5).
  assert.equal(entry.url, 'http://127.0.0.1:4317/api/permission');
  assert.doesNotMatch(entry.url, /\/api\/hook/);
  // Written explicitly rather than inherited, so a change to the runtime's own
  // default cannot silently shorten the hold.
  assert.equal(entry.timeout, 600);
  assert.equal(entry.timeout, hooks.PERMISSION_TIMEOUT_SECONDS);
  assert.equal(typeof entry.statusMessage, 'string');

  const plan = hooks.describe(4317);
  assert.ok(
    plan.events.includes('PermissionRequest'),
    'PermissionRequest is missing from the consent screen',
  );
  assert.match(plan.json, /"PermissionRequest"/);
  assert.match(plan.json, /"http:\/\/127\.0\.0\.1:4317\/api\/permission"/);
  // The consent screen must say what this one DOES, not just that it exists:
  // it is the entry that lets a web page answer a permission prompt.
  assert.match(plan.note, /PermissionRequest/);
  assert.match(plan.note, /Allow, Deny or Allow for this session/);
  assert.match(plan.note, /never allows anything by itself/);
  assert.match(plan.note, /never answers on a timer/);
  assert.match(plan.note, /never writes a permanent/);
  assert.match(plan.note, /terminal/);
});

test('remove() takes the http hook out too, and installedPort() can read it back', async () => {
  await reset();
  await hooks.install(4400);
  assert.equal(await hooks.installedPort(), 4400);

  // The port is readable from the http entry alone — the case that arises if
  // the command entries are ever removed by hand.
  const onlyHttp = { hooks: { PermissionRequest: read().hooks.PermissionRequest } };
  await fsp.writeFile(SETTINGS, JSON.stringify(onlyHttp, null, 2), 'utf8');
  assert.equal(await hooks.installedPort(), 4400);
  assert.equal(await hooks.installed(4400), true);
  assert.equal(await hooks.installed(4317), false);

  await hooks.remove();
  const after = fs.existsSync(SETTINGS) ? read() : {};
  assert.equal(ourEntries(after).length, 0);
  assert.equal((after.hooks && after.hooks.PermissionRequest) ?? null, null);
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
  assert.equal(ourEntries(after).length, 0);
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

  const settings = read();
  const commands = ourCommands(settings);
  assert.equal(commands.length, 9, 'the stale set must be removed, not left behind');
  for (const c of commands) assert.match(c, /port:4400/);
  // The http entry repoints with the rest: its port is a literal in its URL,
  // so a stale one posts a raised hand into a void (docs/DEVIATIONS.md §86.6).
  const http = ourHttp(settings);
  assert.equal(http.length, 1);
  assert.equal(http[0].url, 'http://127.0.0.1:4400/api/permission');
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
  assert.equal(ourEntries(after).length, 0);
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

// ---------------------------------------------------------------------------
// WP-19 — the PermissionRequest payload, and the body that answers it.
//
// The response shape is the one thing in this package that a reasonable
// reading of the published documentation gets WRONG (docs/DEVIATIONS.md §86.3:
// `decision` is an object discriminated on `behavior`, not a bare string), and
// a body in the documented shape fails the runtime's parser silently — the
// prompt just sits there looking like DeckHQ is doing nothing. So the spelling
// is asserted literally, field by field.
// ---------------------------------------------------------------------------

const PERM_CWD = path.join(path.resolve(os.tmpdir()), 'deckhq-project');

/** A realistic PermissionRequest payload. */
function perm(over = {}) {
  return {
    session_id: 'bf6a1bf1',
    transcript_path: '/x/y.jsonl',
    cwd: PERM_CWD,
    permission_mode: 'default',
    hook_event_name: 'PermissionRequest',
    tool_name: 'Bash',
    tool_input: { command: 'npm test', description: 'Run test suite' },
    tool_use_id: 'toolu_01ABC',
    permission_suggestions: [
      {
        type: 'addRules',
        rules: [{ toolName: 'Bash', ruleContent: 'npm test:*' }],
        behavior: 'allow',
        destination: 'localSettings',
      },
    ],
    ...over,
  };
}

test('permissionRequest: the card gets the tool, the literal input and the id', () => {
  const out = hooks.permissionRequest(perm());
  assert.equal(out.id, 'toolu_01ABC');
  assert.equal(out.sessionId, 'bf6a1bf1');
  assert.equal(out.tool, 'Bash');
  assert.equal(out.summary, 'npm test');
  assert.equal(out.requiresUserInteraction, false);
  assert.equal(out.suggestions.length, 1);
  assert.equal(out.suggestions[0].label, 'Bash(npm test:*)');
});

test('permissionRequest: a payload that names no tool has nothing to ask about', () => {
  assert.equal(hooks.permissionRequest(perm({ tool_name: '' })), null);
  assert.equal(hooks.permissionRequest({}), null);
  assert.equal(hooks.permissionRequest(null), null);
});

test('permissionRequest: only addRules earns the third button', () => {
  // setMode and addDirectories are wider grants than "allow for this session"
  // says on the button, so they are dropped rather than retargeted.
  const out = hooks.permissionRequest(
    perm({
      permission_suggestions: [
        { type: 'setMode', mode: 'acceptEdits', destination: 'localSettings' },
        { type: 'addDirectories', directories: ['/etc'], destination: 'localSettings' },
      ],
    }),
  );
  assert.deepEqual(out.suggestions, []);
  assert.deepEqual(hooks.permissionRequest(perm({ permission_suggestions: null })).suggestions, []);
});

test('permissionRequest: a path inside the cwd is relative, one outside it is NOT hidden', () => {
  const inside = hooks.permissionRequest(
    perm({ tool_name: 'Write', tool_input: { file_path: path.join(PERM_CWD, 'src', 'a.ts') } }),
  );
  assert.equal(inside.summary, 'src/a.ts');

  // Deliberately the opposite of the WP-52 bubble, which reduces an outside
  // path to its basename so a screenshot cannot carry somebody's directory
  // tree. Here the reader is deciding whether to allow the write, and a write
  // landing outside the project is exactly when hiding where it goes would be
  // the dangerous choice.
  const outside = path.join(path.resolve(os.tmpdir()), 'somewhere-else', 'secrets.env');
  const out = hooks.permissionRequest(
    perm({ tool_name: 'Write', tool_input: { file_path: outside } }),
  );
  assert.equal(out.summary, outside);
});

test('SECURITY: a permission summary is one line of printable text, at most 400 characters', () => {
  const nasty = `rm -rf /\n\r\t\u001b[31mred\u001b[0m \u202ereversed`;
  const out = hooks.permissionRequest(perm({ tool_input: { command: nasty } }));
  assert.doesNotMatch(out.summary, /[\u0000-\u001F\u007F-\u009F\u202A-\u202E]/);
  assert.equal(out.summary.includes('\n'), false);
  const long = hooks.permissionRequest(perm({ tool_input: { command: 'x'.repeat(5000) } }));
  assert.equal(long.summary.length, 400);
  assert.ok(long.summary.endsWith('…'));
});

test('permissionRequest: the tools that must be answered in the session are flagged', () => {
  // A hook allow is DISCARDED for these by the runtime, so the panel must
  // offer no buttons at all (docs/DEVIATIONS.md §86.3).
  for (const tool of ['AskUserQuestion', 'ExitPlanMode']) {
    assert.equal(hooks.permissionRequest(perm({ tool_name: tool })).requiresUserInteraction, true);
  }
  assert.equal(
    hooks.permissionRequest(perm({ requires_user_interaction: true })).requiresUserInteraction,
    true,
  );
  assert.equal(hooks.permissionRequest(perm()).requiresUserInteraction, false);
});

test('permissionDecisionBody: allow is the exact object the installed runtime parses', () => {
  assert.deepEqual(hooks.permissionDecisionBody('allow'), {
    hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: { behavior: 'allow' } },
  });
});

test('INVARIANT: deny never sets interrupt — denying a command is not stopping the agent', () => {
  const body = hooks.permissionDecisionBody('deny');
  assert.deepEqual(body, {
    hookSpecificOutput: {
      hookEventName: 'PermissionRequest',
      decision: { behavior: 'deny', message: 'denied from DeckHQ' },
    },
  });
  assert.equal('interrupt' in body.hookSpecificOutput.decision, false);
  assert.doesNotMatch(JSON.stringify(body), /interrupt/);
});

test('INVARIANT: "allow for this session" retargets the runtime\'s own rule at the session, and nowhere else', () => {
  const { suggestions } = hooks.permissionRequest(perm());
  const body = hooks.permissionDecisionBody('session', suggestions);
  const decision = body.hookSpecificOutput.decision;
  assert.equal(decision.behavior, 'allow');
  // An ARRAY of update objects, not the documented {allow, allowForSession}.
  assert.ok(Array.isArray(decision.updatedPermissions));
  assert.deepEqual(decision.updatedPermissions, [
    {
      type: 'addRules',
      rules: [{ toolName: 'Bash', ruleContent: 'npm test:*' }],
      behavior: 'allow',
      destination: 'session',
    },
  ]);
  // The rule text is the runtime's own, never one DeckHQ minted, and `label`
  // is ours for the panel and must not travel back.
  assert.equal('label' in decision.updatedPermissions[0], false);
  // userSettings / projectSettings / localSettings write a PERMANENT grant
  // into the user's settings files. That is not a button this panel has.
  const json = JSON.stringify(body);
  assert.doesNotMatch(json, /userSettings|projectSettings|localSettings|cliArg/);
});

test('INVARIANT: with no suggestion there is no updatedPermissions to send', () => {
  const body = hooks.permissionDecisionBody('session', []);
  assert.deepEqual(body.hookSpecificOutput.decision, { behavior: 'allow' });
});

test.after(async () => {
  await fsp.rm(CLAUDE_DIR, { recursive: true, force: true });
  await fsp.rm(STATE_DIR, { recursive: true, force: true });
});

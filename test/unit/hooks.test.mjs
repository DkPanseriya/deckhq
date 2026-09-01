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
  assert.equal(commands.length, 7); // 6 events, Notification split across 2 matchers
  for (const c of commands) assert.match(c, /port:4400/);

  assert.equal(await hooks.installed(4400), true);
  assert.equal(await hooks.installedPort(), 4400);
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
  assert.equal(commands.length, 7, 'the stale set must be removed, not left behind');
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

test.after(async () => {
  await fsp.rm(CLAUDE_DIR, { recursive: true, force: true });
  await fsp.rm(STATE_DIR, { recursive: true, force: true });
});

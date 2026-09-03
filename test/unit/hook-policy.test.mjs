/**
 * WP-56 — the managed settings that switch DeckHQ's hooks off over its head.
 *
 * `allowManagedHooksOnly` and `allowedHttpHookUrls` were found by the WP-19
 * spike (`docs/DEVIATIONS.md` §86.4) and left undetected by the WP-19 build
 * (§97.4). On a managed machine either one makes a perfect install deliver
 * nothing: the settings file is exactly right, the port is exactly right, the
 * daemon is up, and no event ever arrives. These tests exist so that state has
 * a name in the report rather than looking like a bug in DeckHQ.
 *
 * Every path here is injected. Nothing reads — and nothing could write — the
 * real `/etc/claude-code`, `/Library/Application Support/ClaudeCode` or
 * `C:\Program Files\ClaudeCode`; the module's own paths are resolved at import
 * time from an environment set up before the dynamic import below.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const CLAUDE_DIR = await fsp.mkdtemp(path.join(os.tmpdir(), 'deckhq-policy-claude-'));
const STATE_DIR = await fsp.mkdtemp(path.join(os.tmpdir(), 'deckhq-policy-state-'));
process.env.CLAUDE_CONFIG_DIR = CLAUDE_DIR;
process.env.DECKHQ_STATE_DIR = STATE_DIR;

const hooks = await import('../../src/adapters/claude-code/hooks.mjs');
const { policyNote } = await import('../../public/hooks-ui.js');

const PORT = 4317;
const OUR_URL = `http://127.0.0.1:${PORT}/api/permission`;

let count = 0;
/** A fresh, empty managed-settings directory. */
async function managedDir() {
  return fsp.mkdtemp(path.join(os.tmpdir(), `deckhq-managed-${count++}-`));
}

/** Write `managed-settings.json` into `dir`. */
async function writeManaged(dir, value) {
  const file = path.join(dir, 'managed-settings.json');
  await fsp.writeFile(file, typeof value === 'string' ? value : JSON.stringify(value), 'utf8');
  return file;
}

/** Write one drop-in into `dir/managed-settings.d/`. */
async function writeDropIn(dir, name, value) {
  const dropDir = path.join(dir, 'managed-settings.d');
  await fsp.mkdir(dropDir, { recursive: true });
  const file = path.join(dropDir, name);
  await fsp.writeFile(file, typeof value === 'string' ? value : JSON.stringify(value), 'utf8');
  return file;
}

/** A user settings file with the given content, or none at all. */
async function userSettings(value) {
  const file = path.join(
    await fsp.mkdtemp(path.join(os.tmpdir(), `deckhq-user-${count++}-`)),
    'settings.json',
  );
  if (value !== undefined) await fsp.writeFile(file, JSON.stringify(value), 'utf8');
  return file;
}

// ---------------------------------------------------------------------------
// Where the files are
// ---------------------------------------------------------------------------

test('the managed settings directory is the documented one for each platform', () => {
  assert.equal(hooks.managedSettingsDir('darwin', {}), '/Library/Application Support/ClaudeCode');
  assert.equal(hooks.managedSettingsDir('linux', {}), '/etc/claude-code');
  assert.equal(
    hooks.managedSettingsDir('win32', { ProgramFiles: 'C:\\Program Files' }),
    path.join('C:\\Program Files', 'ClaudeCode'),
  );
});

test('Windows follows %ProgramFiles% rather than assuming the system drive', () => {
  assert.equal(
    hooks.managedSettingsDir('win32', { ProgramFiles: 'D:\\Apps' }),
    path.join('D:\\Apps', 'ClaudeCode'),
  );
  // And falls back to the usual place when the variable is not set at all.
  assert.equal(hooks.managedSettingsDir('win32', {}), path.join('C:\\Program Files', 'ClaudeCode'));
});

test('the legacy Windows path is not read, because the runtime does not read it', () => {
  const dir = hooks.managedSettingsDir('win32', { ProgramFiles: 'C:\\Program Files' });
  assert.doesNotMatch(dir, /ProgramData/);
});

test('an unknown platform is treated as Linux rather than guessing', () => {
  assert.equal(hooks.managedSettingsDir('freebsd', {}), '/etc/claude-code');
});

test('the file list is managed-settings.json, then the drop-ins alphabetically', async () => {
  const dir = await managedDir();
  await writeManaged(dir, {});
  await writeDropIn(dir, '20-security.json', {});
  await writeDropIn(dir, '10-telemetry.json', {});
  await writeDropIn(dir, 'notes.txt', 'not json');
  await writeDropIn(dir, '.hidden.json', {});

  assert.deepEqual(await hooks.managedSettingsFiles(dir), [
    path.join(dir, 'managed-settings.json'),
    path.join(dir, 'managed-settings.d', '10-telemetry.json'),
    path.join(dir, 'managed-settings.d', '20-security.json'),
  ]);
});

test('no drop-in directory is not an error', async () => {
  const dir = await managedDir();
  assert.deepEqual(await hooks.managedSettingsFiles(dir), [
    path.join(dir, 'managed-settings.json'),
  ]);
});

// ---------------------------------------------------------------------------
// What the files say
// ---------------------------------------------------------------------------

test('no managed settings file at all reports neither key', async () => {
  const managed = await hooks.managedSettings({ dir: await managedDir() });
  assert.equal(managed.allowManagedHooksOnly.value, false);
  assert.equal(managed.allowedHttpHookUrls.value, null);
  assert.deepEqual(managed.files, []);
  assert.deepEqual(managed.unreadable, []);
});

test('allowManagedHooksOnly is reported with the file that set it', async () => {
  const dir = await managedDir();
  const file = await writeManaged(dir, { allowManagedHooksOnly: true });
  const managed = await hooks.managedSettings({ dir });
  assert.deepEqual(managed.allowManagedHooksOnly, { value: true, file });
});

test('allowManagedHooksOnly false is a value, not a block', async () => {
  const dir = await managedDir();
  await writeManaged(dir, { allowManagedHooksOnly: false });
  const managed = await hooks.managedSettings({ dir });
  assert.equal(managed.allowManagedHooksOnly.value, false);
  assert.equal(managed.allowManagedHooksOnly.file, null);
});

test('a drop-in can set allowManagedHooksOnly on its own', async () => {
  const dir = await managedDir();
  await writeManaged(dir, { model: 'whatever' });
  const file = await writeDropIn(dir, '20-hooks.json', { allowManagedHooksOnly: true });
  const managed = await hooks.managedSettings({ dir });
  assert.deepEqual(managed.allowManagedHooksOnly, { value: true, file });
});

test('an empty allowedHttpHookUrls array is defined, and it is empty', async () => {
  const dir = await managedDir();
  const file = await writeManaged(dir, { allowedHttpHookUrls: [] });
  const managed = await hooks.managedSettings({ dir });
  assert.deepEqual(managed.allowedHttpHookUrls, { value: [], file });
});

test('allowedHttpHookUrls is unioned across the managed sources, in merge order', async () => {
  const dir = await managedDir();
  const file = await writeManaged(dir, { allowedHttpHookUrls: ['https://a.example/'] });
  await writeDropIn(dir, '10-hooks.json', { allowedHttpHookUrls: ['https://b.example/'] });
  const managed = await hooks.managedSettings({ dir });
  assert.deepEqual(managed.allowedHttpHookUrls.value, ['https://a.example/', 'https://b.example/']);
  // The file named is the first source that defined the key.
  assert.equal(managed.allowedHttpHookUrls.file, file);
});

test('a managed file that exists and cannot be parsed is listed, never guessed at', async () => {
  const dir = await managedDir();
  const file = await writeManaged(dir, '{ not json');
  const managed = await hooks.managedSettings({ dir });
  assert.deepEqual(managed.unreadable, [file]);
  assert.equal(managed.allowManagedHooksOnly.value, false);
  assert.equal(managed.allowedHttpHookUrls.value, null);
});

test('a managed file whose top level is not an object is unreadable, not empty', async () => {
  const dir = await managedDir();
  const file = await writeManaged(dir, [1, 2, 3]);
  const managed = await hooks.managedSettings({ dir });
  assert.deepEqual(managed.unreadable, [file]);
});

test('a plugin force-enabled by the managed policy is reported', async () => {
  const dir = await managedDir();
  await writeManaged(dir, { enabledPlugins: { 'deckhq@some-marketplace': true } });
  assert.equal((await hooks.managedSettings({ dir })).managedPluginEnabled, true);
  const other = await managedDir();
  await writeManaged(other, { enabledPlugins: { 'somethingelse@m': true, 'deckhq@m': false } });
  assert.equal((await hooks.managedSettings({ dir: other })).managedPluginEnabled, false);
});

// ---------------------------------------------------------------------------
// What counts as "on the allowlist"
// ---------------------------------------------------------------------------

test('an allowlist entry covers the URL exactly, by prefix, and by glob', () => {
  assert.equal(hooks.allowlistCovers(OUR_URL, OUR_URL), true);
  assert.equal(hooks.allowlistCovers('http://127.0.0.1:4317', OUR_URL), true);
  assert.equal(hooks.allowlistCovers('http://127.0.0.1:4317/', OUR_URL), true);
  assert.equal(hooks.allowlistCovers('http://127.0.0.1:4317/*', OUR_URL), true);
  assert.equal(hooks.allowlistCovers('http://127.0.0.1:*/api/permission', OUR_URL), true);
  assert.equal(hooks.allowlistCovers('*', OUR_URL), true);
  assert.equal(hooks.allowlistCovers(`  ${OUR_URL}  `, OUR_URL), true);
  assert.equal(hooks.allowlistCovers('HTTP://127.0.0.1:4317/API/PERMISSION', OUR_URL), true);
});

test('an allowlist entry that is not this URL does not cover it', () => {
  assert.equal(hooks.allowlistCovers('https://hooks.example.com/', OUR_URL), false);
  assert.equal(hooks.allowlistCovers('http://127.0.0.1:4318/api/permission', OUR_URL), false);
  assert.equal(hooks.allowlistCovers('http://127.0.0.2:4317/', OUR_URL), false);
  assert.equal(hooks.allowlistCovers('', OUR_URL), false);
  assert.equal(hooks.allowlistCovers('   ', OUR_URL), false);
  assert.equal(hooks.allowlistCovers(null, OUR_URL), false);
  assert.equal(hooks.allowlistCovers(42, OUR_URL), false);
});

test('a glob is matched as a glob, not as a regular expression', () => {
  // `.` is a literal in a URL pattern; a naive translation would let this one
  // through and the report would say a blocked machine was fine.
  assert.equal(hooks.allowlistCovers('http://127x0x0x1:4317/*', OUR_URL), false);
});

// ---------------------------------------------------------------------------
// The verdict
// ---------------------------------------------------------------------------

test('an unmanaged machine is not blocked', async () => {
  const blocked = await hooks.blockedByPolicy({
    port: PORT,
    dir: await managedDir(),
    userSettingsFile: await userSettings(),
  });
  assert.equal(blocked, null);
});

test('allowManagedHooksOnly blocks, and names its key and file', async () => {
  const dir = await managedDir();
  const file = await writeManaged(dir, { allowManagedHooksOnly: true });
  assert.deepEqual(
    await hooks.blockedByPolicy({ port: PORT, dir, userSettingsFile: await userSettings() }),
    { key: 'allowManagedHooksOnly', file },
  );
});

test('allowManagedHooksOnly blocks a plugin install too, unless the policy enables it', async () => {
  const dir = await managedDir();
  const file = await writeManaged(dir, { allowManagedHooksOnly: true });
  assert.deepEqual(
    await hooks.blockedByPolicy({ viaPlugin: true, dir, userSettingsFile: await userSettings() }),
    { key: 'allowManagedHooksOnly', file },
  );

  // Hooks from a plugin the managed policy force-enables are exempt.
  const enabled = await managedDir();
  await writeManaged(enabled, {
    allowManagedHooksOnly: true,
    enabledPlugins: { 'deckhq@m': true },
  });
  assert.equal(
    await hooks.blockedByPolicy({
      viaPlugin: true,
      dir: enabled,
      userSettingsFile: await userSettings(),
    }),
    null,
  );
  // The exemption is for the plugin route only: a settings-file install is
  // still on the ignored side of the line.
  assert.deepEqual(
    await hooks.blockedByPolicy({
      port: PORT,
      viaPlugin: false,
      dir: enabled,
      userSettingsFile: await userSettings(),
    }),
    { key: 'allowManagedHooksOnly', file: path.join(enabled, 'managed-settings.json') },
  );
});

test('an empty allowedHttpHookUrls blocks the http hook', async () => {
  const dir = await managedDir();
  const file = await writeManaged(dir, { allowedHttpHookUrls: [] });
  assert.deepEqual(
    await hooks.blockedByPolicy({ port: PORT, dir, userSettingsFile: await userSettings() }),
    { key: 'allowedHttpHookUrls', file },
  );
});

test('an allowedHttpHookUrls that omits the daemon URL blocks', async () => {
  const dir = await managedDir();
  const file = await writeManaged(dir, {
    allowedHttpHookUrls: ['https://hooks.example.com/', 'http://127.0.0.1:9999/'],
  });
  assert.deepEqual(
    await hooks.blockedByPolicy({ port: PORT, dir, userSettingsFile: await userSettings() }),
    { key: 'allowedHttpHookUrls', file },
  );
});

test('an allowedHttpHookUrls that lists the loopback URL is fine', async () => {
  const dir = await managedDir();
  await writeManaged(dir, { allowedHttpHookUrls: ['https://hooks.example.com/', OUR_URL] });
  assert.equal(
    await hooks.blockedByPolicy({ port: PORT, dir, userSettingsFile: await userSettings() }),
    null,
  );

  // The loopback origin alone is enough, and so is a glob over it.
  const origin = await managedDir();
  await writeManaged(origin, { allowedHttpHookUrls: ['http://127.0.0.1:4317/'] });
  assert.equal(
    await hooks.blockedByPolicy({
      port: PORT,
      dir: origin,
      userSettingsFile: await userSettings(),
    }),
    null,
  );
});

test('the allowlist is followed to the port the hooks actually use', async () => {
  const dir = await managedDir();
  await writeManaged(dir, { allowedHttpHookUrls: ['http://127.0.0.1:4317/api/permission'] });
  // A daemon that walked forward to 4318 is no longer on the list.
  assert.equal(
    (await hooks.blockedByPolicy({ port: 4318, dir, userSettingsFile: await userSettings() }))?.key,
    'allowedHttpHookUrls',
  );
});

test('allowedHttpHookUrls says nothing about an install with no http entry', async () => {
  // The plugin route writes command hooks only, so it carries no port and the
  // allowlist cannot reach it. Claiming otherwise would be an invented block.
  const dir = await managedDir();
  await writeManaged(dir, { allowedHttpHookUrls: [] });
  assert.equal(
    await hooks.blockedByPolicy({ viaPlugin: true, dir, userSettingsFile: await userSettings() }),
    null,
  );
});

test("the user's own allowlist entry widens the merged list rather than being ignored", async () => {
  // The documented scope of this key is any file and the allowlist merges, so
  // an entry the user wrote lifts a managed block. Reading it is what keeps
  // `doctor` from failing a machine whose policy is fine.
  const dir = await managedDir();
  await writeManaged(dir, { allowedHttpHookUrls: ['https://hooks.example.com/'] });
  assert.equal(
    await hooks.blockedByPolicy({
      port: PORT,
      dir,
      userSettingsFile: await userSettings({ allowedHttpHookUrls: [OUR_URL] }),
    }),
    null,
  );
});

test("the user's own file can never originate a block", async () => {
  // Only a managed source blocks. A user file that narrows the list on its own
  // is not a managed policy, and the row would name the wrong thing.
  const dir = await managedDir();
  assert.equal(
    await hooks.blockedByPolicy({
      port: PORT,
      dir,
      userSettingsFile: await userSettings({ allowedHttpHookUrls: [] }),
    }),
    null,
  );
});

test('a managed file that cannot be read blocks nothing', async () => {
  const dir = await managedDir();
  await writeManaged(dir, '{{{');
  assert.equal(
    await hooks.blockedByPolicy({ port: PORT, dir, userSettingsFile: await userSettings() }),
    null,
  );
});

test('an unreadable user settings file widens nothing and breaks nothing', async () => {
  const dir = await managedDir();
  const file = await writeManaged(dir, { allowedHttpHookUrls: [] });
  const userFile = await userSettings();
  await fsp.writeFile(userFile, 'not json at all', 'utf8');
  assert.deepEqual(await hooks.blockedByPolicy({ port: PORT, dir, userSettingsFile: userFile }), {
    key: 'allowedHttpHookUrls',
    file,
  });
});

test('when both keys block, the one that takes away everything is reported', async () => {
  const dir = await managedDir();
  const file = await writeManaged(dir, {
    allowManagedHooksOnly: true,
    allowedHttpHookUrls: [],
  });
  assert.deepEqual(
    await hooks.blockedByPolicy({ port: PORT, dir, userSettingsFile: await userSettings() }),
    { key: 'allowManagedHooksOnly', file },
  );
});

test('blockedByPolicy never throws, whatever it is pointed at', async () => {
  // A directory where a file is expected, and a path that cannot exist.
  const dir = await managedDir();
  await fsp.mkdir(path.join(dir, 'managed-settings.json'), { recursive: true });
  assert.equal(await hooks.blockedByPolicy({ port: PORT, dir }), null);
  assert.equal(
    await hooks.blockedByPolicy({ port: PORT, dir: path.join(dir, 'nope', 'nowhere') }),
    null,
  );
});

// ---------------------------------------------------------------------------
// The banner
// ---------------------------------------------------------------------------

test('the banner names the key and the file, and says a reinstall will not help', () => {
  const note = policyNote({ key: 'allowManagedHooksOnly', file: '/etc/claude-code/x.json' });
  assert.match(note, /allowManagedHooksOnly/);
  assert.match(note, /\/etc\/claude-code\/x\.json/);
  assert.match(note, /Installing them again will not change that/);
});

test('the banner says nothing when nothing is blocking', () => {
  assert.equal(policyNote(null), null);
  assert.equal(policyNote(undefined), null);
  assert.equal(policyNote({ key: 'allowManagedHooksOnly' }), null);
  assert.equal(policyNote({ file: '/etc/claude-code/x.json' }), null);
});

test('INVARIANT OF HONESTY: the banner claims nothing about sight', () => {
  const note = policyNote({ key: 'allowedHttpHookUrls', file: '/etc/claude-code/x.json' });
  assert.doesNotMatch(note, /cannot see/i);
  assert.doesNotMatch(note, /(?:invisible|blind|hidden)/i);
});

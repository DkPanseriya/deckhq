/**
 * WP-37 — the shape of `plugin/`, and the promise it has to keep.
 *
 * These are contract tests against the files `claude plugin install` copies
 * into `~/.claude/plugins/cache/`. Two of them are the whole reason the package
 * exists:
 *
 *   - the plugin is **self-contained** (the install is a copy of `plugin/`
 *     alone, so a single import reaching outside it breaks on every machine
 *     but the author's), and
 *   - the plugin adds **no egress** — the acceptance criterion in
 *     `docs/plan/08-PLAN-V2-100X.md` §9 WP-37, and `08` §1.1 rule 2.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PLUGIN_DIR = path.join(ROOT, 'plugin');

const manifest = readJson(path.join(PLUGIN_DIR, '.claude-plugin', 'plugin.json'));
const marketplace = readJson(path.join(ROOT, '.claude-plugin', 'marketplace.json'));
const hooks = readJson(path.join(PLUGIN_DIR, 'hooks', 'hooks.json'));
const mcp = readJson(path.join(PLUGIN_DIR, '.mcp.json'));

/** @param {string} file */
function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

/** Every file under `plugin/`, as absolute paths. */
function walk(dir) {
  /** @type {string[]} */
  const out = [];
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    if (fs.statSync(full).isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out.sort();
}

const FILES = walk(PLUGIN_DIR);

// ---------------------------------------------------------------------------
// The manifests
// ---------------------------------------------------------------------------

test('the plugin declares the name the marketplace installs', () => {
  assert.equal(manifest.name, 'deckhq');
  const entry = marketplace.plugins.find((p) => p.name === 'deckhq');
  assert.ok(entry, 'marketplace.json does not list a plugin called deckhq');
  assert.equal(entry.source, './plugin');
});

test('the marketplace names an owner, as the schema requires', () => {
  assert.equal(typeof marketplace.name, 'string');
  assert.equal(typeof marketplace.owner?.name, 'string');
  assert.ok(Array.isArray(marketplace.plugins));
});

test('the plugin version tracks the package version', () => {
  const pkg = readJson(path.join(ROOT, 'package.json'));
  assert.equal(manifest.version, pkg.version);
  assert.equal(marketplace.plugins.find((p) => p.name === 'deckhq').version, pkg.version);
});

test('the name the daemon looks for in enabledPlugins is the manifest name', async () => {
  const { PLUGIN_NAME } = await import('../../src/adapters/claude-code/hooks.mjs');
  assert.equal(PLUGIN_NAME, manifest.name);
});

// ---------------------------------------------------------------------------
// The hook block
// ---------------------------------------------------------------------------

test('the plugin hooks cover exactly the events the settings-file block covers', () => {
  // Both routes deliver the same product. A drift between them is a floor that
  // behaves differently depending on how the user installed the same thing.
  const settingsEvents = [
    'UserPromptSubmit',
    'Notification',
    'Stop',
    'SubagentStop',
    'SessionStart',
    'SessionEnd',
    'PreToolUse',
    'PostToolUse',
  ];
  assert.deepEqual(Object.keys(hooks.hooks).sort(), settingsEvents.slice().sort());
});

test('Notification is split into the two matchers the docs name', () => {
  assert.deepEqual(
    hooks.hooks.Notification.map((g) => g.matcher),
    ['permission_prompt', 'idle_prompt'],
  );
});

test('every hook entry is a command hook run through the plugin root', () => {
  for (const [event, groups] of Object.entries(hooks.hooks)) {
    for (const group of groups) {
      for (const entry of group.hooks) {
        assert.equal(entry.type, 'command', `${event} is not a command hook`);
        assert.match(
          entry.command,
          /^node "\$\{CLAUDE_PLUGIN_ROOT}\/scripts\/hook\.mjs"/,
          `${event} does not run the plugin's own hook script`,
        );
        assert.equal(entry._deckhq, true, `${event} is not tagged`);
        assert.equal(typeof entry.timeout, 'number');
      }
    }
  }
});

test('no hook entry carries a port — that is the whole point', () => {
  // `docs/DEVIATIONS.md` §86.6: an http hook's url is a literal and a command
  // hook's port is baked in at install time. A plugin has no install-time
  // moment in which a port could be known, so it must discover one instead.
  const raw = fs.readFileSync(path.join(PLUGIN_DIR, 'hooks', 'hooks.json'), 'utf8');
  assert.equal(/port[:=]\s*\d+/.test(raw), false);
  assert.equal(/:\d{4,5}\b/.test(raw), false);
});

test('SessionStart is async, so a cold start never blocks the session', () => {
  const entry = hooks.hooks.SessionStart[0].hooks[0];
  assert.equal(entry.async, true);
  assert.match(entry.command, /--start$/);
  // It may spawn a daemon and wait for it to bind. Anything shorter than that
  // wait would have Claude Code kill it mid-start.
  assert.ok(entry.timeout >= 30, 'SessionStart needs room to start a daemon');
});

test('only SessionStart starts a daemon', () => {
  for (const [event, groups] of Object.entries(hooks.hooks)) {
    if (event === 'SessionStart') continue;
    for (const group of groups) {
      for (const entry of group.hooks) {
        assert.equal(/--start/.test(entry.command), false, `${event} must not start a daemon`);
      }
    }
  }
});

test('the MCP server is a stdio node process inside the plugin', () => {
  assert.deepEqual(Object.keys(mcp.mcpServers), ['deckhq']);
  assert.equal(mcp.mcpServers.deckhq.command, 'node');
  assert.deepEqual(mcp.mcpServers.deckhq.args, ['${CLAUDE_PLUGIN_ROOT}/scripts/mcp-server.mjs']);
  assert.equal('url' in mcp.mcpServers.deckhq, false, 'an MCP server with a url is egress');
});

test('both slash commands exist and are user-invoked only', () => {
  for (const name of ['deck', 'waiting']) {
    const body = fs.readFileSync(path.join(PLUGIN_DIR, 'commands', `${name}.md`), 'utf8');
    assert.match(body, /^---\n[\s\S]*?\n---\n/, `${name}.md has no frontmatter`);
    assert.match(body, /disable-model-invocation: true/, `${name}.md is model-invocable`);
    assert.match(
      body,
      /!`node "\$\{CLAUDE_PLUGIN_ROOT}\/scripts\/\w+\.mjs"`/,
      `${name}.md does not run a bundled script`,
    );
  }
});

// ---------------------------------------------------------------------------
// Self-containment
// ---------------------------------------------------------------------------

test('nothing in the plugin imports from outside the plugin directory', () => {
  // `claude plugin install` copies `plugin/` and nothing else — measured on
  // Claude Code 2.1.231, see `docs/DEVIATIONS.md` §94. A `../src/...` import
  // resolves on the author's machine and on no user's.
  for (const file of FILES.filter((f) => f.endsWith('.mjs'))) {
    const source = fs.readFileSync(file, 'utf8');
    for (const m of source.matchAll(/(?:^|\s)(?:import|from)\s+['"]([^'"]+)['"]/g)) {
      const spec = m[1];
      if (spec.startsWith('node:')) continue;
      assert.ok(spec.startsWith('.'), `${path.basename(file)} imports the bare package "${spec}"`);
      const resolved = path.resolve(path.dirname(file), spec);
      assert.ok(
        resolved.startsWith(PLUGIN_DIR + path.sep),
        `${path.basename(file)} imports "${spec}", which is outside plugin/`,
      );
      assert.ok(fs.existsSync(resolved), `${path.basename(file)} imports a missing "${spec}"`);
    }
  }
});

test('the plugin ships no package.json, so nothing can acquire a dependency', () => {
  assert.equal(fs.existsSync(path.join(PLUGIN_DIR, 'package.json')), false);
});

// ---------------------------------------------------------------------------
// No egress
// ---------------------------------------------------------------------------

test('SECURITY: no file in the plugin names a non-loopback host', () => {
  // The acceptance criterion in `08` §9 WP-37 is "no egress added", and this
  // is what enforces it: every URL in every file the installer copies has to
  // be loopback. The two exceptions are inert metadata — the manifest's
  // `homepage` and `repository`, which Claude Code shows in the plugin manager
  // and never fetches.
  const allowed = new Set([manifest.homepage, manifest.repository]);
  const loopback = /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:|\/|$)/;

  for (const file of FILES) {
    // `${HOST}` is the constant asserted below to be 127.0.0.1; substituting
    // it lets the scan read a template literal the way the runtime does.
    const source = fs.readFileSync(file, 'utf8').replaceAll('${HOST}', '127.0.0.1');
    for (const m of source.matchAll(/https?:\/\/[^\s"'`),]+/g)) {
      const url = m[0];
      if (allowed.has(url)) continue;
      assert.ok(
        loopback.test(url),
        `${path.relative(PLUGIN_DIR, file)} names ${url}, which is not loopback`,
      );
    }
  }
});

test('SECURITY: the only allowed non-loopback urls are the manifest metadata', () => {
  // Pinned by key, so that adding a third URL-bearing field to plugin.json has
  // to be a deliberate change to this test rather than a silent widening of
  // the allowlist above.
  const withUrls = Object.entries(manifest).filter(
    ([, v]) => typeof v === 'string' && /https?:\/\//.test(v),
  );
  assert.deepEqual(
    withUrls.map(([k]) => k).sort(),
    ['homepage', 'repository'],
    'plugin.json gained a new field carrying a URL',
  );
});

test('SECURITY: the host is one constant, and nothing can move it', async () => {
  const lib = await import('../../plugin/lib/deckhq.mjs');
  assert.equal(lib.HOST, '127.0.0.1');

  const source = fs.readFileSync(path.join(PLUGIN_DIR, 'lib', 'deckhq.mjs'), 'utf8');
  // Exactly one place assigns it, and it is a literal.
  const assignments = [...source.matchAll(/HOST\s*=\s*(.+);/g)].map((m) => m[1]);
  assert.deepEqual(assignments, ["'127.0.0.1'"]);
  // Every `net.connect` in the plugin takes `host: HOST` and nothing else.
  for (const file of FILES.filter((f) => f.endsWith('.mjs'))) {
    const body = fs.readFileSync(file, 'utf8');
    for (const m of body.matchAll(/host:\s*([^,\s}]+)/g)) {
      assert.equal(m[1], 'HOST', `${path.basename(file)} connects to host: ${m[1]}`);
    }
    assert.equal(/process\.env\.[A-Za-z_]*HOST/i.test(body), false);
  }
});

test('the npm tarball does not ship the plugin', () => {
  // The plugin's distribution channel is the repository, which is what
  // `claude plugin marketplace add` clones; shipping a second copy inside
  // every `npx deckhq` download would be bytes nobody uses.
  const pkg = readJson(path.join(ROOT, 'package.json'));
  assert.equal(pkg.files.includes('plugin'), false);
  assert.equal(pkg.files.includes('.claude-plugin'), false);
});

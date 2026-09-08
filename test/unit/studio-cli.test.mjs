/**
 * `deckhq studio enable|disable` — WP-66's CLI half.
 *
 * The daemon and the socket are injected, so what is under test is the
 * command's own contract: it prints the list and changes nothing without
 * `--yes`, it sends `confirm` only with it, it resolves the directory the same
 * way the daemon does, and it says the one line and exits 2 when there is no
 * daemon to record the grant in.
 */
import '../helpers/isolate.mjs';

import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';

const { runStudio, NO_DAEMON, STUDIO_HELP } = await import('../../src/cli/studio.mjs');

/** A CLI run with its output captured and its network replaced. */
function run(argv, opts = {}) {
  let out = '';
  let err = '';
  /** @type {any[]} */
  const sent = [];
  const deps = {
    write: (s) => {
      out += s;
    },
    error: (s) => {
      err += s;
    },
    cwd: opts.cwd || path.join(path.sep === '\\' ? 'C:\\' : '/', 'work'),
    find: async () => (opts.daemon === false ? null : { port: 4317 }),
    post: async (port, verb, body) => {
      sent.push({ port, verb, body });
      return { ok: true, status: 200, body: opts.reply || {} };
    },
  };
  return runStudio(argv, deps).then((code) => ({ code, out, err, sent }));
}

test('with no arguments it prints the help and exits 2', async () => {
  const r = await run([]);
  assert.equal(r.code, 2);
  assert.equal(r.out, STUDIO_HELP);
  // The help says what this package does and does not do.
  assert.match(STUDIO_HELP, /NOTHING RUNS/);
  assert.match(STUDIO_HELP, /never inferred from another/);
});

test('a verb it does not know is refused, and nothing is sent', async () => {
  const r = await run(['start', '.']);
  assert.equal(r.code, 2);
  assert.match(r.err, /unknown: "start"/);
  assert.deepEqual(r.sent, []);
});

test('a missing directory is refused before a daemon is looked for', async () => {
  const r = await run(['enable']);
  assert.equal(r.code, 2);
  assert.match(r.err, /a project directory is required/);
  assert.deepEqual(r.sent, []);
});

test('with no daemon it says so in one line and exits 2', async () => {
  const r = await run(['enable', '.'], { daemon: false });
  assert.equal(r.code, 2);
  assert.match(r.err, new RegExp(NO_DAEMON));
  assert.deepEqual(r.sent, []);
});

test('without --yes it prints the plan and sends no confirm', async () => {
  const dir = path.resolve(path.sep === '\\' ? 'C:\\work\\orbital' : '/work/orbital');
  const r = await run(['enable', dir], {
    reply: {
      confirmed: false,
      enabled: false,
      describe: '  This would let Studio write inside somewhere:\n\n    a-path\n\n',
      paths: [],
    },
  });
  assert.equal(r.code, 0);
  assert.deepEqual(r.sent, [{ port: 4317, verb: 'enable', body: { cwd: dir } }]);
  assert.ok(!('confirm' in r.sent[0].body), 'a describe must not carry confirm');
  assert.match(r.out, /a-path/);
  assert.match(r.out, /Nothing was changed\. Run it again with --yes to write it\./);
});

test('`.` is resolved against the working directory, the way the daemon expects', async () => {
  const cwd = path.resolve(path.sep === '\\' ? 'C:\\work\\orbital' : '/work/orbital');
  const r = await run(['enable', '.', '--yes'], { cwd, reply: { written: [] } });
  assert.equal(r.sent[0].body.cwd, cwd);
  assert.equal(r.sent[0].body.confirm, true);
  assert.equal(r.code, 0);
});

test('disable without --yes names what it would delete and what it would leave', async () => {
  const r = await run(['disable', '/work/orbital'], {
    reply: { wouldRemove: ['/x/README.md'], wouldKeep: ['/x/board.json'] },
  });
  assert.equal(r.code, 0);
  assert.equal(r.sent[0].verb, 'disable');
  assert.ok(!('confirm' in r.sent[0].body));
  assert.match(r.out, /This would delete:[\s\S]*README\.md/);
  assert.match(r.out, /would LEAVE, because they are yours:[\s\S]*board\.json/);
  assert.match(r.out, /Nothing was changed\./);
});

test('disable with --yes reports what was removed, and exits 1 when something was left behind', async () => {
  const clean = await run(['disable', '/work/orbital', '--yes'], {
    reply: { removed: ['/x/README.md'], kept: ['/x/board.json'] },
  });
  assert.equal(clean.code, 0);
  assert.match(clean.out, /Removed 1:/);
  assert.match(clean.out, /Left alone — yours:[\s\S]*board\.json/);

  const stale = await run(['disable', '/work/orbital', '--yes'], {
    reply: { removed: [], foreign: ['/x/README.md'] },
  });
  assert.equal(stale.code, 1);
  assert.match(stale.out, /no longer carries the DeckHQ marker/);
});

test('a refusal from the daemon is printed and exits 1', async () => {
  let err = '';
  const code = await runStudio(['enable', '/work/orbital', '--yes'], {
    write: () => {},
    error: (s) => {
      err += s;
    },
    find: async () => ({ port: 4317 }),
    post: async () => ({ ok: false, status: 409, body: { error: 'that file is not ours' } }),
  });
  assert.equal(code, 1);
  assert.match(err, /that file is not ours/);
  assert.match(err, /Nothing was changed\./);
});

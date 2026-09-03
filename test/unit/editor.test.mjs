/**
 * "open in editor" (WP-47) — the allowlist, and what happens to everything
 * that is not on it.
 *
 * Nothing here starts a program. `resolveEditor` is given a fake PATH and a
 * fake "is this a file" predicate, and `editorArgv` returns the exact argv a
 * launch would use, so the argv can be asserted character by character
 * without a window opening on the machine running the suite.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  EDITORS,
  EDITOR_NAMES,
  editorArgv,
  editorNameFromEnv,
  findOnPath,
  openInEditor,
  resolveEditor,
} from '../../src/core/editor.mjs';

/** A PATH containing exactly the named commands. */
function fakeMachine(commands, { platform = 'linux', dir = '/usr/bin' } = {}) {
  const win = platform === 'win32';
  const present = new Set(
    commands.map((c) => (win ? `${dir}\\${c}` : `${dir}/${c}`).toLowerCase()),
  );
  return {
    platform,
    env: win
      ? { PATH: dir, PATHEXT: '.COM;.EXE;.BAT;.CMD' }
      : { PATH: `/nowhere:${dir}`, PATH_: '' },
    isFile: (p) => present.has(String(p).toLowerCase()),
  };
}

test('the allowlist is the five editors WP-47 names, and nothing else', () => {
  assert.deepEqual(EDITOR_NAMES, ['code', 'cursor', 'zed', 'idea', 'subl']);
  for (const name of EDITOR_NAMES) {
    assert.equal(typeof EDITORS[name].label, 'string');
    assert.equal(typeof EDITORS[name].args, 'function');
  }
});

test('REFUSAL: an editor that is not on the allowlist is never resolved', () => {
  const machine = fakeMachine(['code', 'rm', 'sh', 'curl', 'node']);
  for (const preference of ['rm', 'sh', 'curl', 'node', 'vim', 'notepad', '../../bin/sh']) {
    assert.throws(
      () => resolveEditor({ ...machine, preference }),
      /is not an editor DeckHQ will launch/,
      `${preference} must be refused`,
    );
  }
  // And the one on the list still resolves, so the refusal is the allowlist
  // and not a broken resolver.
  assert.equal(resolveEditor({ ...machine, preference: 'code' }).name, 'code');
});

test('REFUSAL: $EDITOR only ever picks between allowlisted editors', () => {
  const machine = fakeMachine(['zed', 'code']);

  // An $EDITOR that is not on the list selects nothing; the PATH order does.
  for (const hostile of ['rm -rf /', '/bin/sh', 'vim', 'emacs', '']) {
    const chosen = resolveEditor({ ...machine, env: { ...machine.env, EDITOR: hostile } });
    assert.equal(chosen.name, 'code', `EDITOR=${hostile} must not select anything itself`);
  }

  // An $EDITOR that IS on the list wins over PATH order, in every shape it
  // shows up in the wild: bare, with flags, and as a full path.
  for (const value of ['zed', 'zed --wait', '/usr/local/bin/zed', '"/usr/local/bin/zed"']) {
    const chosen = resolveEditor({ ...machine, env: { ...machine.env, EDITOR: value } });
    assert.equal(chosen.name, 'zed', `EDITOR=${value} names zed`);
  }
  assert.equal(editorNameFromEnv('CODE.EXE'), 'code');
  assert.equal(editorNameFromEnv('rm'), null);
  assert.equal(editorNameFromEnv(undefined), null);
});

test('with no preference, the first allowlisted editor on PATH wins, in list order', () => {
  assert.equal(resolveEditor(fakeMachine(['subl', 'idea', 'cursor'])).name, 'cursor');
  assert.equal(resolveEditor(fakeMachine(['subl', 'idea'])).name, 'idea');
  assert.equal(resolveEditor(fakeMachine(['subl'])).name, 'subl');
  assert.throws(() => resolveEditor(fakeMachine([])), /No editor found on PATH/);
});

test('a named editor that is not installed is an error, never a silent substitution', () => {
  const machine = fakeMachine(['code']);
  assert.throws(() => resolveEditor({ ...machine, preference: 'zed' }), /zed is not on PATH/);
});

test('findOnPath tries PATHEXT on Windows and the bare name elsewhere', () => {
  const win = fakeMachine(['code.cmd'], { platform: 'win32', dir: 'C:\\bin' });
  assert.equal(findOnPath('code', win), 'C:\\bin\\code.cmd');
  assert.equal(findOnPath('zed', win), null);
  const posix = fakeMachine(['code']);
  assert.equal(findOnPath('code', posix), '/usr/bin/code');
});

test('the argv is an array, and the file always travels as its own element', () => {
  const file = '/home/me/proj/src/a b&c.ts';
  assert.deepEqual(
    editorArgv({ name: 'code', command: '/usr/bin/code' }, file, 42, {
      platform: 'linux',
    }),
    ['/usr/bin/code', ['-g', `${file}:42`], {}],
  );
  assert.deepEqual(
    editorArgv({ name: 'zed', command: '/usr/bin/zed' }, file, 7, { platform: 'linux' })[1],
    [`${file}:7`],
  );
  assert.deepEqual(
    editorArgv({ name: 'idea', command: '/usr/bin/idea' }, file, 7, { platform: 'linux' })[1],
    ['--line', '7', file],
  );
  // A line number is a line number: no zero, no negatives, no fractions.
  for (const bad of [0, -3, NaN, undefined, 'nonsense']) {
    assert.match(
      editorArgv({ name: 'code', command: '/usr/bin/code' }, file, bad, {
        platform: 'linux',
      })[1][1],
      /:1$/,
    );
  }
});

test('WINDOWS: a .cmd launcher goes through cmd.exe verbatim, and unsafe paths are refused', () => {
  const editor = { name: 'code', command: 'C:\\bin\\code.cmd' };
  const [cmd, args, opts] = editorArgv(editor, 'C:/proj/src/a b.ts', 12, { platform: 'win32' });
  assert.equal(cmd, 'cmd.exe');
  assert.deepEqual(args.slice(0, 3), ['/d', '/s', '/c']);
  // `cmd /s` strips the first and last character of the string after /c, so
  // the real command line carries its own pair of quotes inside them.
  assert.equal(args[3], '""C:\\bin\\code.cmd" "-g" "C:/proj/src/a b.ts:12""');
  assert.equal(opts.windowsVerbatimArguments, true);

  // `&` and `|` are literal inside the quotes (checked against cmd.exe), so
  // they are opened rather than refused...
  assert.doesNotThrow(() => editorArgv(editor, 'C:/proj/a&b|c.ts', 1, { platform: 'win32' }));
  // ...but a quote closes the quoting and `%` expands a variable inside it.
  for (const hostile of ['C:/proj/a".ts', 'C:/proj/%PATH%.ts', 'C:/proj/a\n&calc.ts']) {
    assert.throws(
      () => editorArgv(editor, hostile, 1, { platform: 'win32' }),
      /Windows cannot pass to a \.cmd launcher safely/,
      `${JSON.stringify(hostile)} must be refused`,
    );
  }
  // An .exe on Windows needs none of that: straight argv, no shell at all.
  const [exe, exeArgs] = editorArgv(
    { name: 'code', command: 'C:\\bin\\code.exe' },
    'C:/a%b.ts',
    3,
    {
      platform: 'win32',
    },
  );
  assert.equal(exe, 'C:\\bin\\code.exe');
  assert.deepEqual(exeArgs, ['-g', 'C:/a%b.ts:3']);
});

test('openInEditor spawns detached, with an argv array, and never a shell', () => {
  /** @type {any[]} */
  const spawned = [];
  const child = { on() {}, unref() {} };
  const machine = fakeMachine(['code']);
  const out = openInEditor({
    ...machine,
    file: '/home/me/proj/src/a.ts',
    line: 9,
    cwd: '/home/me/proj',
    spawnFn: (cmd, args, opts) => {
      spawned.push([cmd, args, opts]);
      return child;
    },
  });
  assert.equal(out.editor, 'code');
  assert.equal(spawned.length, 1);
  const [cmd, args, opts] = spawned[0];
  assert.equal(cmd, '/usr/bin/code');
  assert.deepEqual(args, ['-g', '/home/me/proj/src/a.ts:9']);
  assert.equal(opts.detached, true);
  assert.equal(opts.stdio, 'ignore');
  assert.equal(opts.cwd, '/home/me/proj');
  assert.ok(!('shell' in opts), 'a shell would undo every guarantee above');
});

test('REFUSAL: openInEditor starts nothing when the editor is not on the allowlist', () => {
  let spawns = 0;
  assert.throws(
    () =>
      openInEditor({
        ...fakeMachine(['code', 'rm']),
        preference: 'rm',
        file: '/home/me/proj/src/a.ts',
        line: 1,
        spawnFn: () => {
          spawns++;
          return { on() {}, unref() {} };
        },
      }),
    /is not an editor DeckHQ will launch/,
  );
  assert.equal(spawns, 0, 'nothing was started');
});

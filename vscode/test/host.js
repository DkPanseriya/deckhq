/**
 * The one test that has to run inside a real VS Code.
 *
 *     node scripts/vscode-verify.mjs
 *
 * Everything else about this extension is asserted from `node --test` against
 * plain functions, which is where assertions belong. Four claims cannot be
 * made there, because they are claims about the editor:
 *
 *   1. the extension activates at all, in a real extension host;
 *   2. the four commands are registered under the ids the manifest promises;
 *   3. `DeckHQ: Open floor` produces a webview tab whose document frames the
 *      running daemon's loopback origin;
 *   4. **the status bar item appears, with the queue in it** — WP-31's
 *      acceptance criterion, and the reason `activate()` returns a read-only
 *      view: VS Code offers no API to read a status bar item back.
 *
 * Run by `code --extensionDevelopmentPath=vscode --extensionTestsPath=…`,
 * which is plain `code` and no test framework. It needs a DeckHQ on loopback;
 * `scripts/vscode-verify.mjs` starts the demo floor and points the workspace
 * at it, so this never runs against anybody's real projects.
 */
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vscode = require('vscode');

/**
 * Where the result is left for `scripts/vscode-verify.mjs` to print. The
 * fallback is a fixed name because the extension host does not reliably
 * inherit the launching process's environment, and its stdout does not
 * reliably reach the terminal that started `code`.
 */
const REPORT =
  process.env.DECKHQ_VERIFY_REPORT || path.join(os.tmpdir(), 'deckhq-vscode-verify.txt');

/** @param {string[]} lines */
function report(lines) {
  const text = lines.join('\n') + '\n';
  process.stdout.write(text);
  try {
    fs.mkdirSync(path.dirname(REPORT), { recursive: true });
    fs.writeFileSync(REPORT, text);
  } catch {
    /* stdout is the other channel */
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function run() {
  const lines = [];
  const ok = (label, detail) => lines.push(`  PASS  ${label}${detail ? ` — ${detail}` : ''}`);

  const extension = vscode.extensions.getExtension('DkPanseriya.deckhq');
  assert.ok(extension, 'the DeckHQ extension was not found in this host');
  const api = await extension.activate();
  ok('the extension activates', extension.id);

  const commands = await vscode.commands.getCommands(true);
  const expected = [
    'deckhq.openFloor',
    'deckhq.showWaiting',
    'deckhq.startDaemon',
    'deckhq.stopDaemon',
  ];
  for (const id of expected) assert.ok(commands.includes(id), `${id} is not registered`);
  ok('the four commands are registered', expected.join(', '));

  // The daemon the workspace points at.
  assert.ok(api && api.ready, 'activate() returned no view of its own state');
  await api.ready;
  for (let i = 0; i < 40 && api.state.status !== 'connected'; i++) await sleep(500);
  assert.equal(api.state.status, 'connected', 'no DeckHQ daemon was found on loopback');
  ok('a daemon was found on loopback', `127.0.0.1:${api.state.port}`);

  // The status bar item — the acceptance criterion.
  const text = api.statusBarText;
  assert.match(text, /^▣ (clear|\d+ waiting( · \d+ hands? up)?)$/u, `status bar reads "${text}"`);
  const counts = api.state.counts;
  const wanted =
    counts.needsYou > 0
      ? `▣ ${counts.needsYou} waiting${counts.handsUp > 0 ? ` · ${counts.handsUp} hand${counts.handsUp === 1 ? '' : 's'} up` : ''}`
      : '▣ clear';
  assert.equal(text, wanted, 'the status bar disagrees with the daemon');
  ok('the status bar item shows the queue', `"${text}" against needsYou=${counts.needsYou}`);

  // The panel.
  await vscode.commands.executeCommand('deckhq.openFloor');
  await sleep(2500);
  const html = api.panelHtml;
  assert.ok(html.length > 0, 'the panel has no document');
  assert.ok(
    html.includes(`src="http://127.0.0.1:${api.state.port}/`),
    'the panel does not frame the daemon',
  );
  assert.match(html, /Content-Security-Policy" content="default-src 'none'; frame-src http:/);
  const tabs = vscode.window.tabGroups.all.flatMap((group) => group.tabs);
  const ours = tabs.filter((tab) => tab.label === 'DeckHQ');
  assert.ok(ours.length === 1, `expected one DeckHQ tab, found ${ours.length}`);
  ok('the floor opens in a webview tab', `frames 127.0.0.1:${api.state.port}`);

  // Reopening reveals the same panel rather than stacking another.
  await vscode.commands.executeCommand('deckhq.openFloor');
  await sleep(1000);
  const again = vscode.window.tabGroups.all
    .flatMap((group) => group.tabs)
    .filter((tab) => tab.label === 'DeckHQ');
  assert.equal(again.length, 1, 'a second Open floor opened a second panel');
  ok('a second Open floor reveals the same panel');

  report(['', `  DeckHQ ${extension.packageJSON.version} verified in VS Code`, '', ...lines, '']);
}

exports.run = function () {
  return run().catch((err) => {
    report(['', `  FAIL  ${err && err.message ? err.message : String(err)}`, '']);
    throw err;
  });
};

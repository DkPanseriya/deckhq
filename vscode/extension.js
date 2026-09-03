/**
 * DeckHQ for VS Code — WP-31.
 *
 * A thin extension, deliberately. It starts nothing new and renders nothing
 * new: it finds the DeckHQ daemon on loopback (or starts one), puts the floor
 * in a panel, and puts the needs-you count in the status bar. Every behaviour
 * of substance lives in the daemon, where it is already tested.
 *
 * Four things it does not do, and will not:
 *
 *   - **No telemetry.** No usage reporting, no error reporting, no
 *     `vscode.env.isTelemetryEnabled` check to be virtuous about, because
 *     there is nothing to gate. `docs/plan/08-PLAN-V2-100X.md` §1.1 rule 2.
 *   - **No network beyond loopback.** Every socket this extension opens goes
 *     to 127.0.0.1. `test/unit/vscode-extension.test.mjs` reads this file and
 *     `lib/*.js` and fails if another host appears in either.
 *   - **No writes to DeckHQ state.** It reads `/api/state` and `/api/events`
 *     and posts nothing. A status bar cannot discharge a debt by displaying
 *     it; actions belong in the panel, where the invariant's guardrails are.
 *   - **No dependencies.** `package.json` has no `dependencies` and no
 *     `devDependencies`; the extension is seven files of plain CommonJS.
 */
const vscode = require('vscode');

const { floorUrl, HOST } = require('./lib/loopback');
const { Monitor } = require('./lib/monitor');
const { statusBarText, statusBarTooltip, waitingItems } = require('./lib/format');
const { DEFAULT_START_COMMAND, startArgv } = require('./lib/command');
const daemonProcess = require('./lib/process');
const { floorHtml } = require('./lib/webview');

const VIEW_TYPE = 'deckhq.floor';

/** @type {vscode.WebviewPanel|undefined} */
let panel;
/** @type {vscode.StatusBarItem|undefined} */
let statusItem;
/** @type {InstanceType<typeof Monitor>|undefined} */
let monitor;
/** @type {vscode.OutputChannel|undefined} */
let output;
/** @type {{child:any}|undefined} */
let started;

/** @param {string} message */
function log(message) {
  if (output) output.appendLine(`${new Date().toISOString()}  ${message}`);
}

/**
 * The configured port, or null for "scan the loopback range".
 * @returns {number|null}
 */
function configuredPort() {
  const value = vscode.workspace.getConfiguration('deckhq').get('port');
  const port = Number(value);
  return Number.isInteger(port) && port > 0 && port < 65536 ? port : null;
}

/**
 * The configured start command — **user scope and the default only**.
 *
 * A workspace can carry a `.vscode/settings.json`, and a repository you cloned
 * to read is not a party this extension takes a program name from. VS Code
 * treats this class of setting the same way (`git.path`,
 * `php.validate.executablePath`), and here it is not a nicety: this value is
 * spawned.
 *
 * @returns {string[]}
 */
function configuredStartCommand() {
  const inspected = vscode.workspace.getConfiguration('deckhq').inspect('startCommand');
  const value =
    (inspected && (inspected.globalValue || inspected.defaultValue)) || DEFAULT_START_COMMAND;
  if (!Array.isArray(value) || value.length === 0) return DEFAULT_START_COMMAND.slice();
  return value.map((v) => String(v));
}

/** Push the current state into the status bar item. */
function renderStatusBar() {
  if (!statusItem || !monitor) return;
  const showing = vscode.workspace.getConfiguration('deckhq').get('statusBar') !== false;
  if (!showing) return statusItem.hide();
  const state = monitor.state;
  statusItem.text = statusBarText(state);
  statusItem.tooltip = new vscode.MarkdownString(statusBarTooltip(state));
  statusItem.show();
}

/**
 * Open the panel, or reveal it, pointed at the floor — and at one agent if
 * asked. `deckhq open <id>` builds the same URL; see `docs/DEVIATIONS.md` §93
 * for what the fragment does and does not do yet.
 * @param {string} [agentId]
 */
async function openFloor(agentId) {
  if (!monitor) return;
  if (monitor.status !== 'connected') {
    const port = await ensureDaemon();
    if (port == null) return;
  }
  const port = monitor.connectedPort;
  if (port == null) return;
  const url = floorUrl(port, agentId);

  if (panel) {
    panel.reveal(panel.viewColumn, false);
    // Moving an existing frame rather than rebuilding the document: the floor
    // holds an SSE stream and an animation loop, and neither should be torn
    // down to change a fragment.
    panel.webview.postMessage({ type: 'deckhq.setUrl', url });
    return;
  }

  panel = vscode.window.createWebviewPanel(VIEW_TYPE, 'DeckHQ', vscode.ViewColumn.Active, {
    enableScripts: true,
    // The floor is a live surface: an SSE stream, a queue and an animation
    // loop. Rebuilding it every time the tab loses focus would make the panel
    // feel like a page and not like a room.
    retainContextWhenHidden: true,
    localResourceRoots: [],
  });
  panel.iconPath = vscode.Uri.joinPath(vscode.Uri.file(__dirname), 'media', 'icon.png');
  panel.webview.html = floorHtml({ url, origin: `http://${HOST}:${port}` });
  panel.onDidDispose(() => {
    panel = undefined;
  });
  log(`panel opened on ${url}`);
}

/**
 * Make sure something is listening, starting a daemon if the user allows it.
 * @param {{force?:boolean}} [opts] `force` is the explicit Start command
 * @returns {Promise<number|null>}
 */
async function ensureDaemon(opts = {}) {
  if (!monitor) return null;
  await monitor.tick();
  if (monitor.status === 'connected') {
    if (opts.force) {
      vscode.window.showInformationMessage(
        `DeckHQ is already running on ${HOST}:${monitor.connectedPort}.`,
      );
    }
    return monitor.connectedPort;
  }

  const autoStart = vscode.workspace.getConfiguration('deckhq').get('autoStart') !== false;
  if (!opts.force && !autoStart) return null;

  const argv = startArgv({ command: configuredStartCommand(), port: configuredPort() });
  monitor.starting();
  renderStatusBar();

  try {
    started = daemonProcess.start({
      argv,
      cwd: vscode.workspace.workspaceFolders?.[0]?.uri?.fsPath,
      log,
    });
  } catch (err) {
    monitor.markOff();
    renderStatusBar();
    vscode.window.showErrorMessage(`DeckHQ could not be started: ${err.message}`);
    return null;
  }

  const port = await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Window, title: 'Starting DeckHQ…' },
    () => monitor.waitForDaemon(),
  );
  if (port == null) {
    monitor.markOff();
    renderStatusBar();
    vscode.window
      .showWarningMessage('DeckHQ did not come up. Check the DeckHQ output channel.', 'Show output')
      .then((choice) => {
        if (choice === 'Show output' && output) output.show(true);
      });
    return null;
  }
  renderStatusBar();
  return port;
}

/** `DeckHQ: Show waiting` — the needs-you queue, oldest first. */
async function showWaiting() {
  if (!monitor) return;
  if (monitor.status !== 'connected' && (await ensureDaemon()) == null) {
    vscode.window.showInformationMessage('DeckHQ is not running.');
    return;
  }
  await monitor.tick();
  const items = waitingItems(monitor.snapshot || { agents: [] });
  if (items.length === 0) {
    vscode.window.showInformationMessage('DeckHQ: nothing is waiting.');
    return;
  }
  const picked = await vscode.window.showQuickPick(
    items.map((item) => ({
      label: item.label,
      description: item.description,
      detail: item.detail,
      id: item.id,
    })),
    { title: 'Waiting on you', placeHolder: 'Open the floor at one of these' },
  );
  if (picked) await openFloor(picked.id);
}

/** `DeckHQ: Stop daemon`. */
async function stopDaemon() {
  if (started && daemonProcess.stop({ child: started.child, log })) {
    started = undefined;
    if (monitor) monitor.markOff();
    renderStatusBar();
    vscode.window.showInformationMessage('DeckHQ stopped.');
    return;
  }
  if (monitor && monitor.status === 'connected') {
    vscode.window.showInformationMessage(
      `DeckHQ on ${HOST}:${monitor.connectedPort} was not started by this window, so it was left ` +
        'running. Stop it where you started it.',
    );
    return;
  }
  vscode.window.showInformationMessage('DeckHQ is not running.');
}

/** @param {vscode.ExtensionContext} context */
function activate(context) {
  output = vscode.window.createOutputChannel('DeckHQ');
  context.subscriptions.push(output);

  statusItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusItem.command = 'deckhq.openFloor';
  statusItem.name = 'DeckHQ';
  context.subscriptions.push(statusItem);

  monitor = new Monitor({
    port: configuredPort,
    onChange: renderStatusBar,
    log,
  });
  context.subscriptions.push({ dispose: () => monitor && monitor.dispose() });

  context.subscriptions.push(
    vscode.commands.registerCommand('deckhq.openFloor', () => openFloor()),
    vscode.commands.registerCommand('deckhq.showWaiting', () => showWaiting()),
    vscode.commands.registerCommand('deckhq.startDaemon', () => ensureDaemon({ force: true })),
    vscode.commands.registerCommand('deckhq.stopDaemon', () => stopDaemon()),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration('deckhq')) renderStatusBar();
    }),
  );

  renderStatusBar();
  log(`DeckHQ extension activated; looking for a daemon on ${HOST}`);
  const ready = monitor.start().then(() => {
    renderStatusBar();
    if (monitor && monitor.status !== 'connected') return ensureDaemon();
  });

  // A read-only view of what the extension is showing, for `vscode/test/host.js`
  // — VS Code offers no way to read a status bar item back, and "the status bar
  // item appears with the right number in it" is WP-31's acceptance criterion.
  // Everything here is a getter over state the extension already holds; nothing
  // in it can change anything.
  return {
    ready,
    get state() {
      return monitor ? monitor.state : null;
    },
    get statusBarText() {
      return statusItem ? statusItem.text : '';
    },
    get panelHtml() {
      return panel ? panel.webview.html : '';
    },
  };
}

function deactivate() {
  // A daemon started from here is left running on purpose: see lib/process.js.
  if (monitor) monitor.dispose();
}

module.exports = { activate, deactivate };

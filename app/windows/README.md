# DeckHQ for Windows

DeckHQ as an installed Windows application: download `DeckHQ-Setup-<version>.exe`, double-click, and
the floor opens in a window of its own. A Start Menu entry afterwards. No Node to install, no
terminal, no browser, no address to type.

It is the free product, unchanged. `core\` inside the app is file for file what `npm pack` would
publish from this repository; the rest is a small window around it. Nothing in this directory is
part of the npm package (`test/unit/app-windows.test.mjs` holds both of those).

**Status: phase 1.** The folder builds and runs; the installer script and the workflow that
compiles it are written but have not been run yet (see [What has not been run](#what-has-not-been-run)).
Nothing links to a download until a signed build exists.

## What is in the folder

`node app/windows/build.mjs` assembles `dist/app/DeckHQ/`, which runs from wherever it is put.

| Path                                               | What it is                                                                                      |
| -------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `DeckHQ.exe`                                       | The shell: about 65 KB of C#, Windows Forms, .NET Framework 4.8 (part of Windows). `shell/`.    |
| `Microsoft.Web.WebView2.Core.dll`, `…WinForms.dll` | Microsoft's WebView2 SDK, managed half.                                                         |
| `runtimes\win-x64\native\`, `runtimes\win-arm64\…` | `WebView2Loader.dll`, its native loader, for both architectures.                                |
| `node\node.exe`                                    | The Node runtime, Windows x64, one pinned release. Only `node.exe`: no npm, no corepack.        |
| `core\`                                            | The npm package: `bin`, `src`, `public`, `package.json`, `README.md`, `LICENSE`.                |
| `licenses\`, `LICENSE.txt`                         | The WebView2 and Node licences, [THIRD-PARTY.md](THIRD-PARTY.md), and DeckHQ's own MIT licence. |
| `VERSION`                                          | DeckHQ version, commit, which Node, which WebView2 SDK. A test build says so here.              |

The installer adds `Uninstall.exe`, a Start Menu shortcut, a Desktop shortcut if you leave its box
ticked, and one entry under `HKCU\…\Uninstall\DeckHQ`. It installs to
`%LOCALAPPDATA%\Programs\DeckHQ` and never asks for an administrator.

## Building

Windows only. The toolchain is what Windows and GitHub's `windows-2022` runner already have (pinned: the newer image has no NSIS): Node
to run the scripts, and `csc.exe` from `%WINDIR%\Microsoft.NET\Framework64\v4.0.30319`, the C# 5
compiler that is part of the .NET Framework. No SDK, no project file, no package restore.

```sh
node app/windows/fetch-webview2.mjs   # the pinned WebView2 SDK, by hash, into dist/ (git-ignored)
node app/windows/build.mjs            # official Node by hash, compile the shell, assemble the folder
node app/windows/build.mjs --local-node   # a TEST build: this machine's own node.exe, loudly
```

`--local-node` exists so the folder can be tried without downloading Node. It copies whatever Node
is running the script, verifies nothing about it, prints a warning and writes `TEST BUILD` into
`VERSION`. It must never be published; the workflow test refuses a workflow that uses it.

The installer is compiled by `.github/workflows/app-windows.yml` (run it from the Actions tab), or
by hand where NSIS 3 is installed:

```sh
makensis /DVERSION=1.7.1 /DAPP_SRC=<repo>\dist\app\DeckHQ /DBUILD_DIR=<repo>\dist\app\_build app\windows\installer.nsi
```

The two downloads a build makes, and what each is held to, are in [THIRD-PARTY.md](THIRD-PARTY.md)
and `pins.json`. To move a pin, change the version, run `fetch-webview2.mjs --print`, and commit the
hashes it prints together with the matching lines of THIRD-PARTY.md.

## What the shell does

- **One window.** A second launch brings the first one forward and exits.
- **Finds or starts the daemon, and asks the CLI how.** It runs `deckhq app --dry-run` with the
  bundled Node; if that reports a DeckHQ already serving your state folder, the window opens on it.
  Otherwise it starts `node core\bin\deckhq.mjs --no-open` as a child with no console window and
  reads the address from the daemon's first line of output. The daemon picks its own port: where
  your installed hooks post, else 4317, walking forward past ports that are taken.
  `DeckHQ.exe --port <n>` and `DECKHQ_PORT` name one port, exactly as they do for `deckhq app`.
- **Stops only what it started.** Closing the window sends the daemon it started a Ctrl-C, so it
  closes its files and removes its `daemon.json` (measured: about 150 ms), and stops it outright
  only if that takes over four seconds. A daemon that was already running is left running. If the
  shell itself is killed, a Windows job object takes its daemon with it.
- **Stays on `127.0.0.1`.** Navigation to anything but the daemon's own address is cancelled and
  handed to your default browser, as is every link that asks for a new window. Only `http` and
  `https` addresses are handed over.
- **Remembers its size and position**, opens at 1600 x 1000 the first time, and goes full screen
  on `F11`. Reload, zoom and find keep their usual keys.
- **Falls back when WebView2 is missing.** It runs `deckhq app`, the Chrome or Edge app window the
  CLI already has, and tells you why once. In that mode the daemon is detached, as it is from a
  terminal, and closing the browser window does not stop it.

It writes under `%LOCALAPPDATA%\DeckHQ`: the WebView2 profile (`WebView2\`), `window.txt`, and
`shell.log` for the last launch. Your DeckHQ data stays where the daemon keeps it, `~\.deckhq`.

## The network: what was switched off, and what was not

`DeckHQ.exe` has no network code: `test/unit/app-windows-shell.test.mjs` fails if its source names a
socket, an HTTP client or a network assembly, and the compiler is given none to reference. The
daemon binds `127.0.0.1` and makes no outbound call, as everywhere else. That leaves WebView2, which
is Microsoft Edge's engine, and which is the one part of this app DeckHQ does not control.

What the shell sets (`shell/Browser.cs`):

| Setting                                                                                                                                                                                                                                                                                                                 | Kind                                                                        |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `IsReputationCheckingRequired = false`: no SmartScreen lookups                                                                                                                                                                                                                                                          | WebView2 API, supported                                                     |
| `IsCustomCrashReportingEnabled = true`: crash dumps are not uploaded to Microsoft                                                                                                                                                                                                                                       | WebView2 API, supported                                                     |
| `IsPasswordAutosaveEnabled`, `IsGeneralAutofillEnabled`, `IsSwipeNavigationEnabled`, `IsStatusBarEnabled` all `false`                                                                                                                                                                                                   | WebView2 API, supported                                                     |
| `--disable-features=msSmartScreenProtection` `--disable-background-networking` `--disable-component-update` `--disable-domain-reliability` `--disable-client-side-phishing-detection` `--disable-sync` `--disable-breakpad` `--no-pings` `--no-first-run` `--host-resolver-rules="MAP * ~NOTFOUND , EXCLUDE 127.0.0.1"` | Chromium switches. Not a supported WebView2 surface; an update may drop one |

`AreBrowserAcceleratorKeysEnabled` is left on: reload, zoom and find are worth more than hiding them.

**Measured**, 11 October 2026, Windows 11 on ARM64, WebView2 Runtime 154.0.4258.62, demo floor:

- Every switch above was on the `msedgewebview2.exe` command line, with
  `--edge-webview-disable-crash-reporting=1` beside them.
- Chromium's own network log (`--log-net-log`, three runs of about 80 seconds): every request the
  page made went to `http://127.0.0.1:<port>`. Before `--host-resolver-rules` was added the log
  also showed 8 to 10 name lookups for `wpad` (proxy auto-discovery, on the local network); with
  it, those are answered not-found inside the browser. In every run it shows UDP sockets connected
  to one Microsoft IPv6 address on port 443 with no send or receive event after the connect.
- The operating system's connection table, sampled about once a second for 80 to 85 seconds over
  the shell, its daemon and its WebView2 processes: the daemon listened on `127.0.0.1` and nothing
  else; `DeckHQ.exe` owned no connection at all.
- **And one thing that was not switched off.** In that same table the WebView2 _browser_ process
  held two TLS connections to an address in Microsoft's network on every run (`52.98.243.34:443`,
  `52.98.253.34`, and once `52.98.252.66` with `52.110.17.34`), opened about a second after launch.
  They are not in the network log, so they are not requests from the page, and none of the
  settings above prevented them. What they carry was not determined.
- A `crashpad-handler` process still starts. Whether it can upload with the two crash settings
  above was not measured.

**Not measured, and not claimed.** Microsoft documents what WebView2 collects, and that diagnostic
data follows the Windows diagnostic-data setting rather than anything an app sets, in
[Data and privacy in WebView2](https://learn.microsoft.com/microsoft-edge/webview2/concepts/data-privacy).
The Evergreen WebView2 Runtime is updated by Microsoft Edge Update, a service outside this app
([Distribute your app and the WebView2 Runtime](https://learn.microsoft.com/microsoft-edge/webview2/concepts/distribution)).
DeckHQ can turn neither off. If that matters to you, `npx deckhq app` in a browser you have
configured yourself is the same floor.

## What it does not do

- It does not update itself, and nothing in it checks for a new version.
- It does not install, bundle or update the WebView2 Runtime.
- It does not add itself to startup, register a file type or a protocol, or pin anything.
- It does not put `node` on your `PATH`. That has one consequence today: the hooks DeckHQ installs
  for Claude Code run `node -e …`, so on a PC with no Node of its own they do nothing and the floor
  stays in its degraded, hook-less mode. Fixing that is a change to the core, not to this shell.

## Limits

- **Unsigned.** Neither `DeckHQ.exe` nor the installer is code-signed, so Windows SmartScreen warns
  before the installer runs ("Windows protected your PC") until a signed build exists.
- **x64 Node on ARM.** The shell is one `AnyCPU` exe and runs natively on x64 and ARM64. The Node it
  carries is x64, so on Windows on ARM the daemon runs under emulation.
- **WebView2 is required for the app window.** It is part of Windows 11 and arrives with Edge on
  Windows 10. Without it the shell falls back to `deckhq app`.
- **Windows 10 and 11.** The shell needs the .NET Framework 4.6.2 or later that Windows carries
  (4.8 since Windows 10 1903), which is what the WebView2 SDK itself asks for.
- **Per user.** One install per Windows account; there is no machine-wide install.

## Uninstalling

"Installed apps" → DeckHQ → Uninstall. It removes each file the installer wrote by name, the two
shortcuts, its registry entry and `%LOCALAPPDATA%\DeckHQ`, and then asks whether to delete
`~\.deckhq` as well. The default answer is No. A silent uninstall (`Uninstall.exe /S`) removes the
program and leaves both folders.

## What has not been run

NSIS is not on the machine this was written on, and the pinned Node zip was not to be downloaded
there. So `installer.nsi` has never been compiled, `fetch-node.mjs` has never met nodejs.org, and
the workflow has never run; `pins.json` has no SHA-256 for the Node zip until its first run prints
one. Everything else here was run: the WebView2 fetch and its signature check, the compile, the
folder, the app against a demo floor (reusing a daemon, starting its own, a second launch, `F11`,
closing), the fallback to `deckhq app`, and the workflow's own smoke step by hand.

All of that was on one machine: Windows 11 on ARM64, with the machine's own ARM64 Node in the
folder. The app has not been run on x64, on Windows 10, or with the x64 Node a release carries, and
the one-time message of the fallback has not been seen on screen.

## Test switches

For the people building it, not features: `--capture <file.png>` writes the WebView's picture of
the page after `--capture-delay <ms>` (default 8000), `--exit-after-capture` closes afterwards, and
`DECKHQ_SHELL_NO_WEBVIEW2=1` takes the fallback path as if the Runtime were absent. `LOCALAPPDATA`,
`DECKHQ_STATE_DIR` and the rest of the environment are honoured, which is how the app is run
against a scratch home.

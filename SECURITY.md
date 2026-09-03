# Security

DeckHQ runs on your machine, reads your AI coding transcripts, and can start processes on your
behalf. That is a meaningful amount of trust, so this document describes what actually protects
you rather than a template.

## Supported versions

The latest published release on npm is the only supported version. Fixes go out as a new patch or
minor release; there are no backports.

| Version | Supported |
| ------- | --------- |
| 1.2.x   | Yes       |
| < 1.2   | No        |

## Reporting a vulnerability

**Please do not open a public issue for a security problem.**

Use GitHub's private vulnerability reporting:
<https://github.com/DkPanseriya/deckhq/security/advisories/new>. It is private between you and the
maintainer until a fix is published, and it lets us credit you in the advisory if you want that.

Please include what you have: the version, the OS, what an attacker needs to be able to do first
(a page open in the user's browser? a file on the user's disk? local shell access?), and the
smallest reproduction you can manage.

You should get a first reply within **five days**. If a fix is warranted, the aim is a released
version within **thirty days** of confirmation, and an advisory published alongside it. If you have
had no reply after a week, please open a public issue saying only that you are waiting on a
security response — no details — so it is visible.

## The threat model

The design assumes a single trusted human at the keyboard on a machine they control. It does not
attempt to defend against someone who already has code execution as that user; if an attacker can
run processes as you, they can read `~/.claude` directly and DeckHQ is not the weak link.

What it does defend against, and how:

### The network cannot reach it

The daemon binds `127.0.0.1` and nothing else (`src/daemon.mjs`). **There is no `--host` flag and
there never will be one**, so there is no configuration in which DeckHQ listens on a LAN address by
accident. Requests arriving with a `Host` header that is not loopback are refused with a 403.

This is also why there is no password: the listener is not reachable from your network, so there is
nothing for a password to protect against.

### Other web pages cannot drive it

**Binding loopback is not sufficient on its own, and it is worth being explicit about why.** It
keeps the network out; it does _not_ keep other web pages out. Any site you visit in any tab can
issue a `POST` to `http://127.0.0.1:4317`, and the browser will attach a perfectly correct `Host`
header to that request, so the loopback check waves it through. Before this was fixed, a page in
another tab could spawn a terminal via `/api/open`, or inject a prompt into a live session via
`/api/send`.

Mutating requests — anything that is not `GET` or `HEAD` — must therefore carry an `Origin` that is
loopback, and must not carry `Sec-Fetch-Site: cross-site`. A cross-origin request always carries an
`Origin` the attacking page cannot forge. Anything else is refused with a 403 and logged. `GET`
requests are unaffected.

This is recorded in full in [`docs/DEVIATIONS.md`](docs/DEVIATIONS.md) §28, including the note that
`docs/02-ARCHITECTURE.md` §9's original reasoning — "no authentication is required precisely
because it is not reachable from the network" — is incomplete. Two named `SECURITY:` tests in
`test/integration/daemon.test.mjs` fail if the guard is removed.

### Static serving cannot escape its directory

`src/http/server.mjs` resolves every static request against the `public/` root and refuses the
response unless the resolved path is still inside it, after normalisation and after backslashes are
folded to forward slashes. `..`, absolute paths, and Windows separator tricks all land outside the
root and are rejected. Only `public/` is served; nothing else in the package or on the disk is
reachable over HTTP.

### Processes are spawned as argv arrays, never as shell strings

Every child process — resuming a session, opening a terminal, probing for an installed binary — is
started with an explicit argument array through `spawn` or `execFile`. Session ids, project paths
and user-typed prompts are passed as arguments, never interpolated into a command line, so there is
no shell metacharacter to escape and no quoting bug to get wrong.

Windows has two places where that is not possible, and both are handled by one rule rather than by
hope. Opening a console window means `start`, which is an internal `cmd.exe` command and not a
program; opening VS Code means `code.cmd`, which Node refuses to spawn without a shell
(CVE-2024-27980). `cmd.exe` does not parse a command line the way `CreateProcess` does — `&`, `|`,
`^`, `<` and `>` are its metacharacters and Node's Windows quoting does not escape them — so for
those two DeckHQ builds the command line itself, in `src/core/cmdline.mjs`, and passes it with
`windowsVerbatimArguments`. Every value is double-quoted, where those metacharacters are literal;
the two characters that can escape a double-quoted `cmd` argument, `"` and `%`, are **refused**
rather than escaped, because nothing can make them safe and neither belongs in a session id or a
project path. `docs/DEVIATIONS.md` §98 records the defect this replaced, measured on a real
machine, and the tests that keep it out.

On macOS, three applications (Terminal.app, iTerm2, Warp) accept only a shell line or a file. For
those, DeckHQ writes a short `#!/bin/sh` wrapper with every value single-quoted and passes only its
absolute path, so no user data is ever part of a command string.

### Conversation content is text, never markup

Transcript content is untrusted input: it is whatever the model produced and whatever the tools it
ran returned. Every message is written into the DOM with `textContent`. Nothing from a transcript
is ever assigned to `innerHTML` or built by string-concatenating HTML. A `<script>` tag inside an
assistant message renders as the visible characters `<script>`.

The page is served with a Content-Security-Policy of `default-src 'self'` — `object-src 'none'`,
`base-uri 'none'`, `form-action 'none'`, and `connect-src 'self'` — so even a successful injection
has no third-party host to reach and no form to submit to.

### Nothing leaves the machine

DeckHQ makes **no outbound network calls of any kind**: no analytics, no telemetry, no update
checks, no crash reporting, no remote fonts or scripts. It has **no runtime dependencies**, so
there is no transitive package that could add one without being noticed. The only sockets are the
loopback listener and the runtime processes DeckHQ starts for you.

Your transcripts, your project names and your prompts stay on your disk. This holds for the free
core permanently; see [`CONTRIBUTING.md`](CONTRIBUTING.md) §2.

## What it writes

- `~/.deckhq/state.json` — your acknowledgements, benches and let-gos. Nothing else.
- `~/.deckhq/backups/` — a timestamped copy of your runtime settings file, taken before DeckHQ
  edits it to install hooks.
- Your runtime's settings file, **only** when you install hooks, **only** after you have been shown
  the literal JSON that will be added, and **only** after you click through. The write is atomic —
  a temporary file in the same directory, then a rename — so an interrupted install cannot leave
  you with a truncated settings file.
- A short `.command` wrapper in the system temp directory on macOS, when you open a session in
  Terminal. It exists so that your project path and session id are never interpolated into a shell
  command string.

It never writes inside the package directory, and never modifies your transcripts.

## Known limitations, stated plainly

- **Any local process running as you can talk to the daemon.** There is no token, so a malicious
  program already running under your user account can call the API. So can it read `~/.claude`
  directly. We consider this outside the model rather than solved.
- **The port is predictable.** The daemon starts at 4317 and walks forward. This is not a secret
  and is not treated as one; the origin check, not obscurity, is what protects mutating requests.
- **Resumed sessions run with your privileges.** DeckHQ starts your runtime the same way your
  terminal does. It does not sandbox the agent, and it does not review what the agent then decides
  to do.

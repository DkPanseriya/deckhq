# <img src="public/brand/deckhq-mark.svg" alt="" width="34" height="34" align="top" /> DeckHQ

[![npm](https://img.shields.io/npm/v/deckhq)](https://www.npmjs.com/package/deckhq)
[![CI](https://github.com/DkPanseriya/deckhq/actions/workflows/ci.yml/badge.svg)](https://github.com/DkPanseriya/deckhq/actions/workflows/ci.yml)

**Every AI coding session on your machine, on one office floor.** It sees the ones your terminal
forgot, and it remembers what's waiting on you even after you've read it. Local, private, MIT,
zero dependencies.

![The DeckHQ floor: three project rooms of agents at desks, a lounge along the service column, and the reception where sessions that finished their turn stand waiting for a reply](test/goldens/win32/three.png)

_Screenshot — three repositories, nine sessions, two of them waiting on you._

## Install

**One line**, if you have Node 18 or newer. It starts the daemon, opens the floor in a window of
its own, and — the first time only — asks once whether to write a Desktop and Start Menu icon.

```bash
npx deckhq app
```

**No Node on the machine?** Download and run [`Install-DeckHQ.cmd`](https://github.com/DkPanseriya/deckhq/releases/latest/download/Install-DeckHQ.cmd) on Windows or [`Install-DeckHQ.command`](https://github.com/DkPanseriya/deckhq/releases/latest/download/Install-DeckHQ.command) on macOS, or paste the matching line, which is all either file carries:

```powershell
irm https://dkpanseriya.github.io/deckhq/install.ps1 | iex
```

```bash
curl -fsSL https://dkpanseriya.github.io/deckhq/install.sh | sh
```

Each checks for Node 18 or newer and **offers** to install it (`winget`, `brew`, or your
distribution's own command printed on Linux, never without asking), installs DeckHQ, offers the
icon, and opens the window. Read them first — [`install.ps1`](scripts/install/install.ps1) and [`install.sh`](scripts/install/install.sh)
are two short files in this repository, served from the site byte for byte, in no tarball and
imported by nothing. SmartScreen may warn about the unsigned `.cmd`, and a downloaded `.command` arrives without its run bit; the two lines above have neither caveat.

**A step at a time, if you prefer:** `npm install -g deckhq`, then `deckhq app`, then
`deckhq shortcut --install --yes` for the icon.

**Before you install anything**, `npx deckhq doctor` prints the number nobody else counts —
sessions that finished, left the agent view when their process exited, and are still waiting on
you — and a `swallowed` row: what a running daemon quietly failed at instead of telling you.

## What you see

- **Every session, not only the live ones.** `claude agents` lists what is _running_. DeckHQ reads
  every transcript on disk, so a session that finished an hour ago is still on the floor with what
  it last said.
- **A queue only you can clear.** What a session is doing changes on its own. What you owe it
  changes when you press a button. Opening a conversation does not clear it; scrolling past it does
  not clear it; reading it does not clear it.
- **Six states, and two different "needs you" signals.** A raised hand at a desk means _I am
  mid-task and blocked_. A person standing in your office means _I finished; review this_. Those
  need different responses, so they look different and are counted separately.
- **A review card, not a notification.** Click anyone and the panel has how long they have been
  waiting, what they said as the markdown they actually wrote, and what changed in that project's
  working tree — then `1` reply, `2` approve, `3` bench.
- **The crew, when a session fires three or more sub-agents.** The desk becomes a formation: the
  juniors on the floor in an arc around it, a laptop each, and a cable from each laptop to the desk
  with a pulse running up it while that junior's transcript is still being written. A junior that
  has stopped keeps its cable and it goes grey. Twelve are drawn; beyond that a `+N` chip, with the
  rest in the panel and in the deck.
- **Tokens, by project, session, model, day and tool**, from your own local ledger. Dollars are one
  setting away and off by default, because most people run these tools on a subscription.
- **The same queue in your terminal.** `deckhq waiting` prints it, `deckhq ack <id>` discharges one,
  and `deckhq statusline` gives a status bar `▣ 3 waiting · 1 hand up`.

All of it, with a picture each, is on the site: [the features](https://dkpanseriya.github.io/deckhq/features.html).
[The manual](docs/GUIDE.md) has every command, key and file.

## What it never does

- **Binds anything but `127.0.0.1`.** There is no `--host` flag and there never will be one. It is
  not reachable from your network, and it refuses cross-site requests, so a page in another tab
  cannot drive it.
- **Leaves the machine.** No analytics, no telemetry, no update checks, no crash reporting, no
  fonts or scripts from a CDN. The only sockets are the loopback listener and the runtime processes
  DeckHQ starts on your behalf.
- **Simulates work.** Every figure on the floor is a session that exists on your disk. Nothing is
  animated to look busy, and a number DeckHQ cannot substantiate is printed as `no data` rather
  than as a confident zero.
- **Collects anything.** No accounts, no billing, no licence checks. Your conversation content
  never leaves the machine and is rendered as text, never as HTML.
- **Touches `~/.claude` without your consent.** It reads your transcripts; it writes a hook block
  into your settings only after showing you the literal JSON and the exact file, backs the file up
  first, tags what it wrote, and removes only what it tagged.

## Runtimes

| Runtime         | Status                            | What that means                                                                                                        |
| --------------- | --------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| **Claude Code** | verified                          | Read, reply, streamed sends, hooks, and one permission prompt answered from the panel on a real session                |
| **Codex**       | verified for reading and replying | Real sessions read and a real reply sent, 4 September 2026. No hooks, no permission card, liveness inferred from mtime |
| **Gemini CLI**  | **unverified**                    | Implemented against the runtime's documented on-disk format; never run against real data                               |
| **OpenCode**    | **unverified**                    | Implemented against the published CLI; never run against real data                                                     |

An adapter is unverified until somebody has run it against real data from a real install, and it
says so until then — in the app, and here. [`docs/ADAPTERS.md`](docs/ADAPTERS.md) is the rule, and
it is why this table exists.

## Run it like an app

```bash
deckhq app                        # the floor in a window of its own
deckhq shortcut --install --yes   # + a Desktop and Start Menu icon for it
deckhq autostart --install --yes  # + the daemon, quietly, when you log in
```

`deckhq app` reuses the DeckHQ you already have running and starts one if none answers, then opens
the floor in **Chrome or Edge in application mode** — no tab strip, no address bar, its own taskbar
button, its own browser profile. Closing the window costs nothing: the daemon outlives it, which is
the whole point.

Both installers print every path they would write and the exact command each will run **before**
`--yes`, tag every file they create, and remove only what they tagged. **Windows is the platform
this was run on.** The macOS bundle and the Linux desktop entries are written from Apple's and
freedesktop.org's documentation and have never been executed on a machine.

Details, and the `?theme=` parameter that repaints one tab: [`docs/GUIDE.md`](docs/GUIDE.md).

## Change the look

`⌘K` → **Settings** opens a **Look** section: six presets — Studio oak, Night lab, Paper office,
Terrazzo hall, Garden floor, Workshop — then a floor material per zone, a colour scheme, a
furniture set, two rugs, the planting, the prop density and the lounge kit. **56 options over eleven
pickers**, every chip a real swatch painted by the floor painter itself, and a live preview with
the contrast it measured underneath. `⌘K` → `Look: Night lab` puts a whole preset on in two
keystrokes. **Agent size** is in there too — small, medium, large or auto — and the table, the
chair, the sofa and the rug follow the people while the corridors, the room padding and every label
stay exactly where they were, so a floor of five fills the window and a floor of a hundred still
fits. Nothing you can choose produces an illegible floor: a combination that would leave a
rug unreadable on the floor under it is **refused with the reason and changes nothing**, and all
three themes still apply on top. A look is a file you own, and unlike a layout it names no project,
no path and no session — so it is one you can post:

```bash
deckhq look export > my-floor.json   # or the section's Export button
deckhq look import my-floor.json     # refused whole if it is not paintable
```

## Studio

**In progress.** Studio is the opt-in "idea to office" mode, per project, off everywhere until
`deckhq studio enable <project>`. A real `claude` session interviews you in the ordinary panel
composer and writes a blueprint, a roster and a board into your own repository, with its own tools.

**What exists today is the store, the consent and the planner.** `enable --yes` writes exactly one
marked file and records the grant; a real `claude` session then interviews you in the ordinary
panel composer and writes the blueprint, the roster and the board itself, with its own tools.

**Hire starts people.** `⌘K` → **Studio: hire &lt;role&gt;**, one row per role not already at a desk.
Each press gives that role a git worktree of its own (`git worktree add … -b studio/<role>`), a
brief file that is yours to edit and is never rewritten under a running session, and a real session
in that worktree under that brief — on the floor within one scan, wearing the role's name. **Firing
leaves the worktree and the process alone.** A Codex, Gemini CLI or OpenCode role is hired and
marked _unverified launch_: nobody has opened a terminal on those three. **What does not exist yet is the board tab** and the handover gate. The loop is on
[the site](https://dkpanseriya.github.io/deckhq/studio.html).

## Docs

| Document                               | What is in it                                                           |
| -------------------------------------- | ----------------------------------------------------------------------- |
| [`docs/GUIDE.md`](docs/GUIDE.md)       | The manual: every command, every key, every file DeckHQ reads or writes |
| [`CHANGELOG.md`](CHANGELOG.md)         | What changed and when                                                   |
| [`SECURITY.md`](SECURITY.md)           | How to report a vulnerability, and what happens after you do            |
| [`LICENSE`](LICENSE)                   | MIT                                                                     |
| [`docs/ADAPTERS.md`](docs/ADAPTERS.md) | For anyone adding support for another coding tool                       |

[dkpanseriya.github.io/deckhq](https://dkpanseriya.github.io/deckhq/) is the product site: what it
does, how it looks, how to install it, and the answers to the questions it gets asked.

## Honest limits

Real, and listed here rather than discovered later.

- **Gemini CLI and OpenCode support is unverified.** Both adapters are written against each
  runtime's documented on-disk format or published CLI, and **neither has ever run against real
  data**, because neither runtime is installed on the development machine. Each reports itself
  unavailable rather than guessing.
- **Codex is verified for reading and replying, and nothing else.** No compressed session file has
  been read; "Open in terminal" has never opened a window for Codex; Codex cannot say which of its
  sessions are alive, so DeckHQ judges it from when the file was last written; and there are no
  Codex hooks, so a Codex session waiting on your permission and one that has simply stopped look
  the same.
- **Answering a permission prompt from the panel has been run once**, against one runtime, one
  machine, one day — Claude Code 2.1.260 on Windows, 4 September 2026. A streamed reply has been
  watched once, the same day.
- **A crew's pulses say a file is moving, not how fast or how far.** A sub-agent's transcript
  carries no progress and no success or failure, so all DeckHQ can see is that the file grew. A
  cable pulses while that happened recently and goes grey when it stops. Nothing on a junior tells
  you whether it worked.
- **The crew is a Claude Code formation.** The other runtimes report too little about sub-agents to
  draw one, so there a junior keeps its seat beside its parent and never gets a cable.
- **Without hooks, "waiting on you" and "stopped" are not distinguishable.** A transcript alone
  does not separate them, and the header says so rather than showing you a confident guess.
- **Which sessions are the same resumed conversation is a good guess, not a fact.** Claude Code
  gives a resumed chat a new id and nothing in the file names the one it continues, so DeckHQ
  matches on the first message. On 101 real transcripts it found 92 conversations. A resume from a
  different directory stays two agents.
- **"Open in terminal" is verified on Windows only.** Six macOS terminals and eight Linux ones are
  written against their documented interfaces and have never been run on a real Mac or a real Linux
  desktop.
- **You get tokens, not dollars**, until you turn **Show cost** on. It is an estimate and never a
  bill: DeckHQ multiplies the tokens it counted by published list prices, has no idea what your
  plan charges you, and prints `no rate` rather than `$0.00` for a model it has no price for.
- **MCP server status is only ever as good as `claude mcp list`.** DeckHQ never connects to an MCP
  server — it asks the runtime once and quotes the answer.
- **Token totals for very large transcripts are approximate.** Reads are capped to keep scans fast,
  so a multi-gigabyte session's history is sampled rather than summed.
- **Given names do not run out below 600 sessions.** Past 600 live identities on one machine you
  would get `Wren 2` — not a duplicate, but the pool being smaller than your history.
- **Local only.** One machine, one human. No remote sessions, no team presence, no cloud sync.

## Support

DeckHQ is free, MIT, and built by one person. If it saves you time and you want to support the
work, the best help is a bug report with `deckhq doctor` output, or telling one colleague. If you
would rather send something, write to the author at the address in `package.json` and ask for a
private channel (PayPal or similar); there is no official sponsorship programme, on purpose, and
nothing in the product changes either way.

## Contributing

Issues and pull requests are welcome. Read [`CONTRIBUTING.md`](CONTRIBUTING.md) first — it leads
with the two things that get a change rejected regardless of how good it is: **letting anything but
you decide what you owe**, and **sending anything off the machine**. Security policy in
[`SECURITY.md`](SECURITY.md).

```bash
npm install     # dev tooling only; the product itself has zero runtime dependencies
npm test        # node --test, no test framework
npm run lint
npm run demo    # a synthetic floor in a temp directory, for screenshots
```

## Licence

MIT. See [`CHANGELOG.md`](CHANGELOG.md) for what changed and when.

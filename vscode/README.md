# DeckHQ for VS Code

**Every AI coding session on your machine, on one office floor — in a panel, and a count in your
status bar.** It sees the ones your terminal forgot, and it remembers what's waiting on you even
after you've read it. Local, private, MIT.

<!-- The image URL is absolute on purpose. `vsce` rewrites a relative one using
     `repository.url` alone and ignores `repository.directory`, so a relative
     `media/panel.png` here becomes `…/deckhq/raw/HEAD/media/panel.png` on the
     Marketplace — a path that does not exist. docs/DEVIATIONS.md §104. -->

![The DeckHQ floor in a VS Code panel: project rooms with agents at desks, a lounge of benched agents, four sessions waiting in your office for review, and the status bar reading "7 waiting, 2 hands up"](https://github.com/DkPanseriya/deckhq/raw/HEAD/vscode/media/panel.png)

## What it is for

If you are building more than one thing at a time, your agents are scattered across a dozen
terminals in a dozen repositories. `claude agents` lists what is **running**. DeckHQ keeps what is
**owed**: the moment a session finishes its turn and exits, it leaves that list, and nothing
records that it asked you a question twenty minutes ago.

DeckHQ reads every transcript on disk, so it has all of them. Every project is a room, every
session is a person at a desk, and the sessions waiting on you queue in your office, oldest first,
with how long they have been waiting.

This extension is the thin part: it finds the DeckHQ daemon on `127.0.0.1`, starts one if there
isn't one, and puts the floor where you already are.

## What it adds to VS Code

- **A count in the status bar.** `▣ 3 waiting · 1 hand up`, or `▣ clear`. It is pushed live from
  the daemon's event stream, so it moves the moment a session's turn ends. Click it to open the
  floor.
- **`DeckHQ: Open floor`** — the whole floor in a panel, beside your code.
- **`DeckHQ: Show waiting`** — the queue as a quick pick: who, which project, how long, and the
  last thing they said. Enter opens the panel at that one.
- **`DeckHQ: Start daemon` / `DeckHQ: Stop daemon`.**

## Install

Install the extension, and it does the rest: on the first window it looks for a DeckHQ on
`127.0.0.1:4317`–`4326` and, finding none, starts one with `npx --yes deckhq --no-open`. That
first start downloads the `deckhq` package from npm, which is the one moment anything reaches the
network — install it yourself (`npm i -g deckhq`, Homebrew, winget, scoop) and even that stops.

Set `deckhq.autoStart` to `false` if you would rather start it yourself, and `deckhq.startCommand`
if `npx` is not how you want it started. Node 18 or newer.

## Privacy

DeckHQ makes no outbound network calls of any kind, and neither does this extension:

- **No telemetry.** None. Not usage, not errors, not an install ping. There is no setting to turn
  off because there is nothing to turn off.
- **Nothing but loopback.** Every socket the extension opens goes to `127.0.0.1`. A test in the
  repository reads the extension's own source and fails the build if any other host appears in it.
- **It reads; it does not write.** The status bar and the quick pick call `GET /api/state` and
  `GET /api/events` and nothing else. Marking a session as dealt with is something only you do, in
  the panel.
- **No dependencies.** Seven files of plain JavaScript, no bundler, no build step.

The daemon it talks to is the same one: it binds `127.0.0.1`, has no `--host` flag, and keeps its
state in `~/.deckhq/state.json` on your own disk. Run `npx deckhq doctor` and the last line reports
the egress it found.

## Settings

| Setting               | Default                                | What it does                                                                                                                                                         |
| --------------------- | -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `deckhq.port`         | `0`                                    | The daemon's port. `0` scans `4317`–`4326`, the range the daemon itself walks.                                                                                       |
| `deckhq.autoStart`    | `true`                                 | Start a daemon when none is running.                                                                                                                                 |
| `deckhq.startCommand` | `["npx","--yes","deckhq","--no-open"]` | How to start it. An argument list, never a shell string, and read from your **user** settings only — a repository you cloned cannot change what this extension runs. |
| `deckhq.statusBar`    | `true`                                 | Show the count in the status bar.                                                                                                                                    |

## Known limits

- **A daemon this extension starts keeps running after VS Code closes.** That is the point: DeckHQ
  exists because debts accumulate while you are not looking. `DeckHQ: Stop daemon` takes it down.
- **`Stop daemon` can only stop a daemon this window started.** One you started in a terminal is
  yours to stop there; the extension will say so rather than go hunting for a process to kill.
- **`Show waiting` opens the floor, and names the agent in the URL fragment.** The floor does not
  select from the fragment yet — the same limit `deckhq open <id>` has today.
- **Local windows only.** In a Remote-SSH or Codespaces window the daemon that matters is the one
  on your own machine; the extension declares itself a UI extension so VS Code runs it there.

## The rest of DeckHQ

Everything above is the panel. The command line is where the number that surprises people lives:

```bash
npx deckhq doctor
```

Source, issues and the full README: **[github.com/DkPanseriya/deckhq](https://github.com/DkPanseriya/deckhq)**. MIT.

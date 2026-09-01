# DeckHQ

**Command deck for every agent session on your machine.**

You run a lot of Claude Code sessions. Claude finishes a turn, asks a question, and you read the
answer, think _I'll come back to that_, open another terminal, and never return. The session sits
there. The runtime believes it is finished. You have no record that anything is outstanding.

DeckHQ is a local dashboard that fixes exactly that, and it renders as a top-down office floor:
every session is a person, every project is a room, and the sessions that owe you a reply are
standing in your office waiting.

```bash
npx deckhq
```

That is the whole install. Node 18+, no build step, no dependencies, no account.

---

## The one rule

> **What you owe is decided by you, never by the runtime.**

`activityState` is _observed_. It changes on its own: a session starts, produces output, blocks,
goes quiet, exits.

`ackState` is _yours_. It changes only when you press a button.

The waiting area in your office renders your acknowledgement, not the runtime's opinion. **Opening
a conversation does not clear it. Scrolling past it does not clear it. Reading it does not clear
it.** Only an explicit action does.

Every other tool in this category derives its queue from runtime state, so the moment the agent
goes idle the item is "complete" and disappears. That is the bug this product exists to fix.

## The six states

| State         | What it means                                      | Where the agent is       | What you see                                           |
| ------------- | -------------------------------------------------- | ------------------------ | ------------------------------------------------------ |
| `working`     | Live and producing output                          | Its project desk         | Typing, occasional coffee                              |
| `needs_input` | Live, blocked on a question or a permission prompt | **Stays at its desk**    | **Raises a hand**, pulsing ring                        |
| `stalled`     | Live but silent longer than the stall window       | Its desk                 | Slumped, amber                                         |
| `for_review`  | Finished a turn, waiting on you                    | **Walks to your office** | Standing in the waiting area with a waiting-time badge |
| `benched`     | Reviewed, no work assigned, available              | The lounge               | Pool, table tennis, arcade, coffee                     |
| `let_go`      | Off the floor                                      | Hidden                   | Hidden unless "Show let go" is on                      |

**The two "needs you" signals are deliberately different.** A raised hand at a desk means _I am
mid-task and blocked_. A person standing in your office means _I finished; review this_. Those
need different responses from you, so they look different and are counted separately.

`working`, `needs_input`, `stalled` and `for_review` are observed. `benched` and `let_go` are
yours. `for_review` is entered automatically and can only be _left_ by you.

## What it reads from your disk

Everything is read locally and nothing leaves the machine.

- `~/.claude/projects/**/*.jsonl` — Claude Code transcripts. Read in bounded chunks: the head for
  the title, the tail for recent state and token usage. Transcripts on a busy machine reach tens of
  megabytes, so DeckHQ never reads a whole one.
- `claude agents --json` — which sessions are alive right now.
- `~/.codex/sessions/**` — Codex rollout files, when Codex is installed.
- `~/.claude/settings.json` — only if you opt into hooks, and only the block DeckHQ wrote.

It writes exactly two things: `state.json` next to the package (your acknowledgements and
settings), and — only with your explicit consent — a tagged hook block in your Claude Code
settings, backed up first.

## Hooks are optional and reversible

Without hooks, DeckHQ infers state from transcripts: it can tell you a session is alive and
whether the last word was yours or the agent's. It **cannot** tell `needs_input` from `stalled` —
those two states are invisible from the outside. The header says so plainly rather than showing
you a confidently wrong picture.

With hooks installed, state is exact and instant: a permission prompt raises a hand within
milliseconds of it appearing in your terminal.

The consent screen shows you the literal JSON that will be written and the exact file it goes in.
Nothing is written until you click. Every entry DeckHQ writes is tagged, removal deletes only
tagged entries, and your settings file is backed up before the first write.

## Privacy

- **The daemon binds `127.0.0.1` and nothing else.** There is no `--host` flag and there never
  will be one. It is not reachable from your network, which is why it needs no password.
- **No network egress whatsoever.** No analytics, no telemetry, no update checks, no crash
  reporting, no fonts or scripts from a CDN. The only sockets are the loopback listener and the
  runtime processes DeckHQ starts on your behalf.
- Your conversation content never leaves the machine, and is rendered as text, never as HTML.
- No accounts, no billing, no licence checks. MIT licensed.

## Honest limits

- **Codex support is unverified.** The adapter is implemented against documented rollout-file
  conventions but has never run against real Codex data, because Codex is not installed on the
  development machine. It reports itself unavailable cleanly and degrades without throwing. Treat
  DeckHQ as a Claude Code tool until that adapter has been exercised end to end.
- **Cost is an estimate, not a bill.** DeckHQ multiplies observed token counts by public list
  prices so you can compare projects against each other. It has no idea what your plan actually
  charges you, and it is labelled as an estimate everywhere it appears.
- **Token totals for very large transcripts are approximate.** Reads are bounded to keep scans
  fast, so a multi-gigabyte session's historical usage is sampled rather than summed.
- **Without hooks, `needs_input` and `stalled` are not detectable.** See above.
- **Local only.** One machine, one human. No remote sessions, no team presence, no cloud sync.
- **One verified runtime.** Claude Code. A Codex adapter ships alongside it but is unverified,
  as above. No other runtime is supported yet.

## Keyboard

| Key                 | Action                                            |
| ------------------- | ------------------------------------------------- |
| `J` / `K`           | Move through the needs-you queue, oldest first    |
| `A`                 | Acknowledge the selected agent                    |
| `B`                 | Bench the selected agent                          |
| `Esc`               | Close the panel                                   |
| `+` / `-`           | Magnify, 1x to 2.5x                               |
| `0`                 | Back to fit — which is also the minimum           |
| `Ctrl`/`⌘` + scroll | Zoom about the cursor                             |
| Drag / scroll       | Pan, whenever the floor is bigger than the window |

Everything is reachable without a mouse. `prefers-reduced-motion` is honoured: characters snap
instead of walking, clips hold a representative pose, and the floor stays fully legible.

## Options

```bash
npx deckhq --port 4400    # a different loopback port
npx deckhq --no-open      # start the daemon without opening a browser
npx deckhq --version
```

The daemon outlives the browser tab on purpose. Closing the tab does not stop state accruing —
the whole point is that debts accumulate while you are not looking.

## Development

```bash
npm install     # dev tooling only; the product itself has zero runtime dependencies
npm start
npm test        # node --test, no test framework
npm run lint
```

Layout, contracts and the reasoning behind every decision are in [`docs/`](docs/README.md).
`reference/` holds the prototype that validated the idea against real data. It is reference, not
foundation.

## Licence

MIT.

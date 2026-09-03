# DeckHQ — Architecture & Data Contracts

**Status:** approved for build · Read `01-PRODUCT.md` first.

Every interface in this document is normative. Implement exactly these shapes. If something is
underspecified, raise it; do not invent it.

---

## 1. Process model

```
  npx deckhq
        │
        ├── daemon (node, 127.0.0.1:4317)          ← single source of truth
        │     ├── adapters/     poll + watch each runtime
        │     ├── store/        ack state, settings  (state.json)
        │     ├── hooks/        opt-in hook install / removal
        │     └── http/         REST + Server-Sent Events
        │
        └── browser client (static, served by the daemon)
              ├── render/       canvas floor, characters, animation
              ├── panel/        session detail, conversation, composer
              └── net/          SSE subscription + REST calls
```

**Loopback only.** The server binds `127.0.0.1`. It must never bind `0.0.0.0`. No authentication
is required precisely because it is not reachable from the network; this is a deliberate trade and
must not be relaxed.

The daemon outlives the browser tab. Closing the tab must not stop state accruing — the whole
point is that debts accumulate while you are not looking.

## 2. The adapter interface

This is the most important contract in the codebase. All runtime-specific knowledge lives behind
it; nothing outside `adapters/` may read a transcript file or shell out to a runtime CLI.

```ts
interface RuntimeAdapter {
  readonly id: 'claude-code' | 'codex';
  readonly label: string;

  /** Is this runtime present on the machine? Cheap, cached for the process lifetime. */
  available(): Promise<boolean>;

  /** Sessions the runtime reports as currently alive. */
  liveSessions(): Promise<LiveSession[]>;

  /** Every session on disk, newest first, bounded by opts. */
  scanSessions(opts: { maxAgeDays: number; limit: number }): Promise<SessionSummary[]>;

  /** Full message list for one session, most recent last. */
  conversation(id: string, opts: { maxMessages: number }): Promise<Message[]>;

  /** Send a turn into a session. Resolves when the runtime returns. */
  send(id: string, text: string, opts: { cwd: string; timeoutMs: number }): Promise<SendResult>;

  /** Spawn an interactive terminal attached to this session. */
  openInTerminal(id: string, cwd: string): Promise<void>;

  /**
   * Hook support. Adapters without hooks return supported:false and the daemon degrades.
   * Every entry point takes the daemon's real port; see §6.
   */
  hooks: {
    supported: boolean;
    describe(port: number): HookPlan;   // exactly what would be written, for the consent screen
    install(port: number): Promise<void>;
    remove(): Promise<void>;
    installed(port?: number): Promise<boolean>;  // false when installed at a DIFFERENT port
    installedPort(): Promise<number | null>;     // what the installed hooks actually target
  };
}
```

### 2.1 Stability rules

- `scanSessions` and `conversation` read undocumented on-disk formats. **All parsing lives in one
  file per adapter** so a format break is a single-file fix.
- A parse failure on one session must never fail the scan. Log it, skip that session, continue.
- `liveSessions` uses each runtime's supported CLI surface (`claude agents --json` for Claude
  Code). Prefer supported surfaces over file parsing wherever both exist.

## 3. Data model

```ts
type ActivityState = 'working' | 'needs_input' | 'stalled' | 'for_review' | 'ended';
type AckState      = 'active' | 'benched' | 'let_go';
type Placement     = 'desk' | 'office' | 'lounge' | 'off_floor';

interface Agent {
  id: string;                 // runtime session id, globally unique with runtime prefix
  runtime: 'claude-code' | 'codex';
  title: string;              // user's chat title; falls back to runtime name, then id[0..8]
  hasCustomTitle: boolean;
  projectId: string;          // slug of cwd
  projectName: string;
  cwd: string;
  gitBranch: string | null;
  model: string | null;

  live: boolean;
  activityState: ActivityState;   // observed
  ackState: AckState;             // user-owned

  reviewSince: number | null;     // ms epoch, set when for_review entered, cleared by user only
  needsInputSince: number | null;
  lastOutputAt: number | null;
  lastActivityAt: number;

  tokens: number;                 // input + output only
  cacheTokens: number;            // cache read + write, reported separately
  costEstimate: number;           // list-price equivalent, NEVER labelled as a bill

  lastRole: 'user' | 'assistant' | null;
  lastText: string;               // ≤ 400 chars
}
```

### 3.1 Placement is derived, never stored

```
placement(agent):
  if ackState === 'let_go'                    -> 'off_floor'
  if ackState === 'benched'                   -> 'lounge'
  if activityState === 'for_review'           -> 'office'
  otherwise                                   -> 'desk'      // in its project room
```

Note what this means: a session that is not running still sits at its project desk. Only an
explicit bench moves it to the lounge. This is §4.1 of the product spec and is not negotiable.

### 3.2 The "needs you" count

```
needsYou = agents where activityState ∈ { needs_input, stalled, for_review }
                   and ackState === 'active'
```

The header shows the total plus a breakdown: *hands up* (`needs_input`), *stalled*, *for review*.

## 4. State determination

### 4.1 With hooks installed (accurate path)

| Hook event | Effect |
|---|---|
| `UserPromptSubmit` | `activityState = working`, clear `reviewSince` and `needsInputSince`, set `lastOutputAt` |
| `Notification` (matcher `permission_prompt` or `idle_prompt`) | `activityState = needs_input`, set `needsInputSince` if unset |
| `Stop` | `activityState = for_review`, set `reviewSince` if unset |
| `SubagentStop` | update `lastOutputAt` only; does not change parent state |
| `SessionEnd` | `live = false`. **`activityState` becomes `ended` only if it is not `for_review`; `reviewSince` is never touched.** A session that finished a turn and then exited still owes you a review. |
| `SessionStart` | register the session, `live = true`. **`activityState` becomes `working` only if it is not `for_review`; `reviewSince` is never touched.** |
| `PreToolUse` | set `currentTool = {name, summary, since}` from the adapter's reading of the payload. **Nothing else** — not `activityState`, not `lastOutputAt`, not one user-owned field (WP-52, `docs/DEVIATIONS.md` §88). |
| `PostToolUse` | clear `currentTool`. Nothing else. |

`currentTool` is also cleared by `Stop`, by `SessionEnd`, and by the tick once it is older than
`stallWindowMs` — a `PostToolUse` that never arrives must not leave a stale claim on the floor.

Hooks POST to `http://127.0.0.1:<port>/api/hook` with the payload the runtime provides, where
`<port>` is the port the daemon was actually listening on when the hooks were installed — never a
fixed 4317 (see §6). The daemon must respond within 200 ms and must never block the hook — process
asynchronously, respond immediately.

> **Amendment, 30 Aug 2026 (tech lead).** The rows above are subordinate to §2. Where this table
> and the invariant disagree, the invariant wins: no row here may clear `reviewSince`. The single
> exception is `UserPromptSubmit`, which represents the user personally submitting a turn to that
> session, and its degraded-path equivalent (a new user *text* turn appearing in the transcript).
> Tool results and subagent traffic must never satisfy that condition.

### 4.2 Without hooks (degraded path)

Polling every 5 s:

- `live` from `liveSessions()`.
- `activityState = for_review` if live and the last transcript record is an assistant turn.
- `activityState = working` if live and the last record is a user turn.
- `activityState = ended` if not live.
- `needs_input` and `stalled` are **not detectable** — the UI must state this plainly in the
  header ("Install hooks for exact state") rather than silently showing a less accurate picture.

### 4.3 Stall detection

Applies only when hooks are installed.

```
stalled  ⟺  live
          ∧ activityState === 'working'
          ∧ now - lastOutputAt > stallWindowMs      // default 10 min, configurable 2–120
```

A stalled agent that produces output returns to `working` automatically. Stall is observed, so it
may clear on its own — unlike `for_review`.

### 4.4 First-run seeding

On a machine with existing history, seed so the queue is immediately useful:

- Assistant spoke last **and** last activity < 72 h → `for_review`, `reviewSince = lastActivityAt`
- Last activity < 14 days → `active`, at its desk
- Older → `ackState = let_go`

Seeding runs **once** and is recorded in `state.json` as `seededAt`. It never re-runs, and any
explicit user action always wins.

## 5. HTTP API

All JSON. All errors `{ error: string }` with an appropriate status.

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/state` | Full snapshot: agents, projects, counts, settings, hook status |
| `GET` | `/api/events` | **SSE stream.** Pushes `state` on every change. The client subscribes here and does not poll. |
| `GET` | `/api/conversation?id=` | Messages for one session |
| `POST` | `/api/ack` | `{ id, action: 'review'\|'acknowledge'\|'bench'\|'recall'\|'let_go'\|'rehire' }` |
| `POST` | `/api/send` | `{ id, text }` — runs a turn; long-running, returns the result |
| `POST` | `/api/open` | `{ id }` — spawn a terminal |
| `GET` | `/api/hooks` | `{ supported, installed, plan }` for each adapter |
| `POST` | `/api/hooks/install` | Consent-gated; writes hooks |
| `POST` | `/api/hooks/remove` | Removes only what was written |
| `POST` | `/api/hook` | Hook callback endpoint (from the runtime) |
| `GET`/`POST` | `/api/settings` | Stall window, notification prefs, poll interval |

### 5.1 Action semantics

| Action | Effect | Legal from |
|---|---|---|
| `acknowledge` | Clears `reviewSince`/`needsInputSince`; agent returns to its desk | `for_review`, `needs_input`, `stalled` |
| `review` | Forces `activityState = for_review`; agent walks to the office | any active state |
| `bench` | `ackState = benched`; agent walks to the lounge | any active state |
| `recall` | `ackState = active`; agent returns to its project desk | `benched` |
| `let_go` | `ackState = let_go`; agent leaves the floor | any |
| `rehire` | `ackState = active` | `let_go` |

`acknowledge` **must not** be inferred from opening a conversation, hovering, or any passive
interaction. It is a button press and nothing else.

## 6. Hook installation

The consent screen shows the literal JSON that will be written and the file it will be written to.
No installation without an explicit click.

- Claude Code hooks are written to the user's settings under a single dedicated block, tagged with
  `"_deckhq": true` so removal is exact.
- **The hook command carries the daemon's real port.** The daemon walks forward from 4317 when the
  port is taken and accepts `--port`, so a fixed port in the hook command would post into a void
  while the settings file went on looking perfect. `installed()` therefore compares the port in the
  installed command against the listening port: a mismatch reads as *not installed*, which puts
  the degraded banner back up and offers a one-click reinstall. Installing at a new port removes
  the stale entries first rather than accumulating a second set.
- The daemon backs up the settings file before writing, to
  `~/.deckhq/backups/settings-backup-<ts>.json`.
- Removal deletes only entries carrying the tag. It must be safe to run on a settings file the
  user has since edited by hand.
- If the settings file is malformed, abort with a clear error and change nothing.

## 7. Persistence

`state.json`, in the user's data directory — `~/.deckhq/state.json`, or `$DECKHQ_STATE_DIR` if
set. **Never inside the package directory:** `npx` owns that directory and is free to evict or
replace it on a version bump, and a root-owned global install cannot write to it at all. Either
would silently discard the user-owned half of the model. A `state.json` left beside the package by
a pre-1.1 build is copied across once, on first start, and the original is left in place.

A write that fails is not only logged — it is reported in `snapshot().writeError` and shown in the
header, because an acknowledgement that did not reach disk is an acknowledgement that will be gone
at the next restart.

```jsonc
{
  "version": 1,
  "seededAt": 1788000000000,
  "settings": { "stallWindowMs": 600000, "notifications": true, "sound": false, "zoom": 0 },
  "ack": {
    "<agentId>": { "state": "benched", "reviewSince": null, "updatedAt": 1788000000000 }
  }
}
```

Written atomically (temp file + rename). A corrupt file must not prevent startup — log, back it
up, and start from defaults.

## 8. Performance budget

Non-negotiable. This runs all day beside terminals on ARM64 Windows.

| Budget | Limit |
|---|---|
| Idle CPU with the tab visible | < 2% of one core |
| Frame budget | 16 ms; the floor backdrop is a pre-rendered bitmap and is never re-drawn per frame |
| Cold scan of 200 sessions (once per daemon start) | < 5000 ms |
| Warm scan (every poll) | < 50 ms |
| Bytes read per session during scan | ≤ 2 MB (head for the title, tail for state and tokens) |
| Memory, daemon | < 150 MB steady state |
| Animation | Characters only. Furniture, floors, walls and shadows are baked. |

If the tab is hidden, the client must stop its animation loop entirely and rely on SSE.

## 9. Security and privacy

- Loopback bind only. Never `0.0.0.0`, never a `--host` flag.
- Static file serving must resolve and confine paths to the public directory.
- All conversation text is rendered as text, never as HTML.
- `send` and `open` execute a runtime CLI: arguments passed as an argv array, never through a
  shell string.
- **No network egress whatsoever.** No analytics, no update checks, no crash reporting. The only
  sockets are the loopback listener and the runtime child processes.
- Conversation content never leaves the machine.

## 10. Repository layout

```
deckhq/
├── bin/deckhq.mjs          # npx entry: start daemon, open browser
├── src/
│   ├── daemon.mjs                # http, SSE, wiring
│   ├── adapters/
│   │   ├── index.mjs             # registry
│   │   ├── claude-code/{adapter,parse,hooks}.mjs
│   │   └── codex/{adapter,parse,hooks}.mjs
│   ├── core/
│   │   ├── model.mjs             # Agent shape, placement, needsYou
│   │   ├── state-machine.mjs     # hook + poll → activityState
│   │   ├── store.mjs             # state.json, atomic writes
│   │   ├── paths.mjs             # where state lives, and the legacy migration
│   │   └── seed.mjs              # first-run seeding
│   └── http/routes/*.mjs
├── public/
│   ├── index.html
│   ├── app.js                    # client bootstrap, SSE, panel
│   ├── render/
│   │   ├── plan.js               # floor generation
│   │   ├── backdrop.js           # baked materials/furniture
│   │   ├── rig.js                # character rig
│   │   ├── clips.js              # motion clips
│   │   └── scene.js              # frame loop, LOD, hit-testing
│   └── style.css
├── docs/                         # this blueprint
└── test/
```

Existing prototype code in `public/app.js`, `public/studio.js`, `lib/sessions.mjs` and
`server.mjs` is **reference, not foundation**. See `04-BUILD-PLAN.md` WP0.

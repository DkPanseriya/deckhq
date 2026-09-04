# WP-23 prep — verifying the Codex adapter against real data

**Status: preparation only. Nothing in the adapter changed, and the adapter is still unverified.**
[`DEVIATIONS.md` §8](../DEVIATIONS.md) stands, [`ADAPTERS.md` §6](../ADAPTERS.md#6-the-honesty-rule)
still applies, and the README's Honest limits line is untouched. This document exists so that the
run which closes §8 can be done in twenty minutes by somebody who is not holding all of this in
their head.

Measured on the reference Windows machine (win32-arm64, Windows 11) on **4 September 2026**, after
the owner installed the **OpenAI Codex desktop app, build `26.901.31953`**. Everything under
`~/.codex` was read **read-only**: no file there was opened for writing, no SQLite connection was
made to any file in it (the databases were copied to a scratch directory first and the *copies*
were opened `readOnly`), and no Codex process was started that does anything but print help or a
version string. No token, no credential and no installation identifier appears in this document.

Three classes of evidence are used below and each claim says which one it rests on, per
[`08` §1.1 rule 11](08-PLAN-V2-100X.md):

- **MEASURED** — observed on this machine today.
- **BINARY** — read out of the shipped `codex.exe` 0.153.1 (string tables). Stronger than the
  documentation, because it is the build that is actually installed.
- **DOCS** — read from OpenAI's published documentation or issue tracker. A hypothesis.

---

## 1. The headline

**The app has not run a task yet, so there is still nothing for DeckHQ to verify against.**
`~/.codex/sessions` does not exist. What changed is everything around it, and three of those
changes matter to the adapter:

1. **The app bundles a complete `codex` CLI** — `codex-cli 0.153.1` — but does **not** put it on
   `PATH`. So `available()` is now `true` and every `spawn('codex', …)` in the adapter still fails
   with `ENOENT`. DeckHQ currently reports "Codex is not installed" for `send`, from a machine that
   has Codex installed twice over. This is the single most likely thing to go wrong in the WP-23
   run, and §5 step B is the fix.
2. **Rollout JSONL under `~/.codex/sessions/**` is still the format**, and the adapter's reading of
   it is substantially right. That is the good news and it is worth stating plainly: the
   speculative `parse.mjs` written against documentation appears to describe the real thing.
3. **Old rollout files are compressed to `.jsonl.zst` by a background worker.** The adapter filters
   on `.jsonl` and would silently drop every compressed session from the floor. This is a real
   defect, found before it shipped a wrong number, and §4.2 is it.

---

## 2. What is on this machine now

### 2.1 `~/.codex`, top level (MEASURED)

Sizes in bytes; directories give a recursive file count.

| Entry | Size / count | What it is |
|---|---|---|
| `.codex-global-state.json` | 241 338 B | Electron/desktop UI state (window bounds, onboarding flags, sidebar sections). Not sessions. |
| `.codex-global-state.json.bak` | 241 338 B | Byte-identical backup of the above. |
| `.sandbox/` | 3 files | Windows sandbox setup marker, a deny-read ACL state file, and one dated log. |
| `.sandbox-bin/` | 0 files | Empty. |
| `.sandbox-secrets/` | 1 file | Sandbox user mapping. **Not read.** |
| `.tmp/` | 6 389 files | `bundled-marketplaces/openai-bundled` — plugins shipped inside the app (browser, computer-use, visualize), each with its own `node_modules`. Accounts for nearly every file under `~/.codex`. |
| `auth.json` | 3 935 B | Credentials. **Not read, not quoted, not copied.** |
| `cache/` | 3 files | `codex_apps_server_info`, `codex_apps_tools`, `remote_plugin_catalog`. |
| `config.toml` | 2 550 B | See §2.2. |
| `goals_1.sqlite` (+ `-shm` 32 768 B, `-wal` 78 312 B) | 4 096 B | Per-thread goal/budget tracking. Empty. |
| `installation_id` | 36 B | A UUID. **Not read, not quoted.** |
| `logs_2.sqlite` (+ `-shm` 32 768 B, `-wal` 712 792 B) | 253 952 B | Application log ring. 532 rows. |
| `memories_1.sqlite` (+ `-shm`, `-wal` 65 952 B) | 4 096 B | Cross-session memory pipeline. Empty. |
| `models_cache.json` | 157 559 B | Model catalogue. |
| `plugins/` | 733 files | Installed-plugin cache and the plugin app-server staging area. |
| `queue_1.sqlite` (+ `-shm`, `-wal` 86 552 B) | 4 096 B | `codex queue` message queue. Empty. |
| `skills/` | 60 files | `.system` skills shipped with the app. |
| `sqlite/` | 1 file | `codex-dev.db`, 335 872 B. See §2.4 — **this is the interesting one**. |
| `state_5.sqlite` (+ `-shm`, `-wal` 1 841 672 B) | 4 096 B | The desktop thread index. See §2.3. |
| `tmp/`, `vendor_imports/` | 6 / 1 files | Scratch, and a curated-skills cache. |

**Absent, and each absence is load-bearing** (MEASURED): `sessions/`, `archived_sessions/`,
`session_index.jsonl`, `thread_history_1.sqlite`, `hooks.json`, `history.jsonl`, `projects.json`.

Note the shape of every SQLite file here: a 4 096-byte main file — one page, effectively empty —
and a WAL of up to 1.8 MB holding everything. **A reader that parsed only the main files on this
machine would see nothing at all.** That is §123.3's argument, made concrete, and §7 returns to it.

### 2.2 `config.toml` (MEASURED)

Written by the app on first run. The parts that bear on DeckHQ:

- `model = "gpt-5.6-terra"`, `model_reasoning_effort = "medium"`.
- A `[desktop]` table (`followUpQueueMode`, `conversationDetailMode`, ambient suggestions).
- Five `[marketplaces.*]` / `[plugins."…"]` blocks for the bundled and primary-runtime plugins.
- `[mcp_servers.node_repl]` for the app's own code-execution runtime.
- `[windows] sandbox = "elevated"`.
- **`CODEX_CLI_PATH`**, set in the `node_repl` environment, pointing at
  `%LOCALAPPDATA%\OpenAI\Codex\bin\<hash>\codex.exe`. This is how the bundled CLI was found.

There is **no `[hooks]` table** and no `hooks.json` beside it. Nothing has been installed there and
nothing in this package writes there.

### 2.3 `state_5.sqlite` — the desktop's thread index (MEASURED)

`journal_mode = wal`. 52 applied `_sqlx_migrations`. Tables: `backfill_state`,
`external_agent_config_imports`, `project_idempotency_keys`, `project_roots`, `projects`,
`remote_control_enrollments`, `rollout_migration_skipped_rollouts`, `rollout_migration_state`,
`thread_artifacts`, `thread_dynamic_tools`, `thread_sections`, `thread_spawn_edges`, `threads`.

**Every one of them is empty except `_sqlx_migrations`, `backfill_state` (1) and
`thread_sections` (1).** `threads` has **0 rows** — the app has genuinely not run a task.

`threads` is the table a future reader would want, and its columns read like a `SessionSummary`
that somebody else already built:

```
id, rollout_path, created_at, updated_at, source, model_provider, cwd, title,
sandbox_policy, approval_mode, tokens_used, has_user_event, archived, archived_at,
git_sha, git_branch, git_origin_url, cli_version, first_user_message, agent_nickname,
agent_role, memory_mode, model, reasoning_effort, agent_path, created_at_ms,
updated_at_ms, thread_source, preview, recency_at, recency_at_ms, history_mode,
name, is_pinned, thread_section_id, section_position, section_entered_at_ms, project_id
```

Two things to take from that list. **`rollout_path` is a column** — the database is an *index over*
the rollout files, not a replacement for them; the JSONL remains the artifact. And it carries three
fields the adapter currently cannot get at all: `git_branch` (today hard-coded `null`), `archived`
(today absent, which per [`ADAPTERS.md` rule 7](../ADAPTERS.md#3-stability-rules) correctly means
"cannot report" rather than "not archived"), and `title` / `name` (a real title, where the adapter
truncates the first user message and sets `hasCustomTitle: false`).

The presence of `rollout_migration_state` and `rollout_migration_skipped_rollouts` — both empty —
matches the `codex migrate-rollouts` subcommand in §3.3.

### 2.4 `sqlite/codex-dev.db` — 100 rows that must not reach the floor (MEASURED)

`journal_mode = delete`, no WAL. 28 rows in `codex_schema_migrations`. Tables: `automations`,
`automation_runs`, `inbox_items`, `local_app_server_feature_enablement`, `local_thread_catalog`,
`local_thread_catalog_hosts`, `local_thread_catalog_metadata`,
`local_thread_catalog_scan_checkpoints`, `local_thread_catalog_scan_entries`,
`local_thread_catalog_sync_state`, `thread_timeline_ledger`.

`local_thread_catalog` has **100 rows** — the only real content anywhere under `~/.codex`. They are
**not** local sessions. Aggregates only, no titles or identifiers read:

| Column | Value across all 100 rows |
|---|---|
| host kind | `chatgpt` (of two registered hosts, `chatgpt` and `local`; `local` has 0 rows) |
| `source_kind` | `chatgpt` |
| `cwd` | **NULL in all 100** |
| `git_branch` | NULL in all 100 |
| `model_provider`, `thread_source`, `conversation_origin`, `source_detail` | NULL in all 100 |
| `display_title` | present in all 100 |
| `thread_id` | UUID-shaped, 36 chars, in all 100 |
| `source_updated_at` | Unix **seconds as a float** (~1.774e9 to ~1.788e9) — not milliseconds |

These are the owner's **ChatGPT / Codex Cloud** threads, synced down for the sidebar. They have no
working directory because they never had one.

**This is a trap with a name.** Any future reader that treats `local_thread_catalog` as a session
source would put 100 cloud conversations on the DeckHQ floor, every one of them in the `unknown`
room, none of them resumable, none of them the user's local work. `ADAPTERS.md`'s "`cwd` is what
puts a session in a room — get it right or return `'unknown'`; never guess" is the rule, and here
the honest answer is not `unknown`, it is **do not show these at all**. Filter on
`local_thread_catalog_hosts.host_kind = 'local'` or do not read this table. Recorded in §7.

### 2.5 What DeckHQ sees today (MEASURED)

`node bin/deckhq.mjs doctor`, from this worktree:

```
  codex           available
  transcripts     0 sessions across 0 projects
  running now     0   (codex's own agent view reports 0)
  on the floor    0
```

That is `available()` finding `~/.codex` and `scanSessions()` finding no `sessions/` directory —
exactly the degradation §8 promised, working. The row is honest and the adapter did not throw.

---

## 3. What the app writes, and where

### 3.1 The desktop app and the CLI share `CODEX_HOME`, and it is `~/.codex`

**MEASURED.** `config.toml` sets `CODEX_HOME = 'C:\Users\<user>\.codex'` in the environment it
hands its own runtime, and `app-server-projects-migration-by-host` in
`.codex-global-state.json` is keyed `local:C:\Users\<user>\.codex`. **BINARY:** `CODEX_HOME` occurs
82 times in `codex.exe`. **DOCS:** the issue tracker describes VS Code, CLI, `exec` and subagents as
"sharing the same `CODEX_HOME`", with the desktop scanning all of it
([#20864](https://github.com/openai/codex/issues/20864)).

So the answer to the question WP-23 was asked — *does the app share `~/.codex/sessions` with the
CLI, or does it keep threads in SQLite or `%APPDATA%`?* — is: **it shares `~/.codex/sessions`.**
Nothing Codex-related lives under `%APPDATA%`; the only thing outside `~/.codex` is the program
itself, under `%LOCALAPPDATA%\OpenAI\Codex\` (§3.2). **Per the instruction in the brief, the adapter
is therefore left alone.** §7's reader plan is written for a different reason, and is not a
prerequisite for anything.

### 3.2 The app bundles a CLI, and hides it

**MEASURED.** `%LOCALAPPDATA%\OpenAI\Codex\bin\` holds two hashed directories:

| File | Size |
|---|---|
| `codex.exe` | 250 308 912 B |
| `codex-code-mode-host.exe` | 67 597 616 B |
| `codex-command-runner.exe` | 7 333 168 B |
| `codex-windows-sandbox-setup.exe` | 13 673 264 B |
| `rg.exe` (separate hash dir) | 3 875 120 B |

`codex.exe --version` → **`codex-cli 0.153.1`**. It is the real CLI, not a stub: `--help` lists
`exec`, `resume`, `agents`, `doctor`, `mcp-server`, `app-server`, `migrate-rollouts`, `queue`,
`archive`, `fork`, `cloud` and the rest.

**And `codex` is not on `PATH`.** `which codex` and `which codex.exe` both fail; nothing named
`codex` appears in any `PATH` entry, in `%LOCALAPPDATA%\Programs`, or in `WindowsApps`. The
installer registers the app, not the command.

This is the whole reason `send()`, `openInTerminal()` and `openNewSession()` cannot work here yet,
and it is why §5 has a step B. For the record, the npm route is alive and has a build for this
architecture: `@openai/codex@0.153.2` is `latest`, with dist-tags including `win32-arm64`
(`0.153.2-win32-arm64`) — so `npm i -g @openai/codex` is a supported install on this machine and
would land a version one patch ahead of the bundled one. OpenAI's own CLI page documents only
`curl -fsSL https://chatgpt.com/codex/install.sh | sh`, which is POSIX-only (DOCS).

### 3.3 The session store, as of 0.153.1

**Rollout JSONL, still the source of truth.** `~/.codex/sessions/YYYY/MM/DD/rollout-<ISO
timestamp>-<uuid>.jsonl`, append-only, one JSON object per line, `{type, payload}`, first line
`session_meta` carrying the id, `cwd`, `cli_version` and `model_provider`; the uuid in the filename
matches the id on the first line (DOCS, corroborated by BINARY: `rollout-`, `sessions\append`,
`sessions\records`, `sessions\title`, `sessions\ledger` and `archived_sessions` all appear in
`codex.exe`).

Four things sit on top of it, and none of them replaces it:

1. **`archived_sessions/`** — an archived thread's rollout file is physically **moved** out of
   `sessions/` into `~/.codex/archived_sessions/` (DOCS + BINARY: `archived_sessions` ×10). The
   adapter walks `sessions/` only, so an archived session simply leaves the floor. That is
   defensible behaviour, but it is inferred, not chosen — §6 checks it.
2. **Compression to `.jsonl.zst`.** A background worker rewrites old rollout journals as Zstandard,
   verifies the copy decodes, and deletes the plain file. **BINARY** is decisive here:
   `codex.exe` contains the literal strings `.jsonl.zst`, `rollout compression worker failed for`,
   and a metrics family `codex.rollout_compression.{run.duration_ms, file.source_bytes,
   file.duration_ms, materialize, temp_cleanup}`. **DOCS** put the threshold at roughly seven days
   untouched; **the threshold is the only part of this that is a hypothesis — the mechanism is in
   the binary.** See §4.2.
3. **`thread_history_1.sqlite`** — a page-by-page copy of a conversation, filled in lazily when a
   thread is next read, backing the experimental `paginated` `historyMode` (BINARY:
   `thread_history_1.sqlite` ×5, `thread_history` ×49; DOCS for the semantics). Absent here.
4. **`state_5.sqlite`** — §2.3. The index, with `rollout_path` pointing back at the file.

`codex migrate-rollouts` ("inspect or migrate legacy local sessions to paginated thread history";
`--apply` to publish, `--json` to report) is the transition between 1 and 3. **It reports by
default and does nothing without `--apply`, so it is safe to run** — and it is the cheapest way to
ask the installed build what it thinks of the rollout files on a machine.

`~/.codex/session_index.jsonl` also exists in the string table and is described as a bounded,
desktop-visible subset of the sessions on disk (BINARY + DOCS). Absent here. It is **not** a
substitute for walking the tree — the issue tracker's example has 22 entries against 109 files —
and the adapter is right not to use it.

### 3.4 Hooks — `PermissionRequest` is real, in this build, and §86.7 holds

**BINARY**, from `codex.exe` 0.153.1: `hooks.json` (×7, with the surrounding strings
`failed to parse hooks config`, `failed to read hooks co…`, `invalid existing config.toml`),
`PermissionRequest` (×51), `hook_event_name` (×26), `hookSpecificOutput` (×8), and the event names
`SessionStart`, `SessionEnd`, `PreToolUse`, `PostToolUse`, `UserPromptSubmit`, `TurnStart`,
`TurnEnd`, `Notification`, plus a kebab-case cluster `prompt-submit / subagent-start /
subagent-stop / stop / interrupt`.

**DOCS** (learn.chatgpt.com/docs/hooks, 4 September 2026) fill in the rest and agree with §86.7 on
every point that matters:

- **Discovery:** `~/.codex/hooks.json`, `~/.codex/config.toml` `[hooks]` tables, and the same two
  under `<repo>/.codex/`.
- **Types: `command` and `mcp_tool`. There is still no `http` type.** So §86.6's option 2 — a
  `command` hook that shells a one-liner at the daemon — remains the only route for Codex, exactly
  as WP-19's spike concluded. Nothing here changes that plan.
- **`PermissionRequest` response** is the object form, `hookSpecificOutput.decision.behavior` of
  `allow` / `deny` with an optional `message` — the same shape §86.3 read out of the Claude Code
  binary, and independent corroboration of it.
- **Timeout** 600 s default (1 s, max 3 s, for `SessionEnd` and `Interrupt`).
- Payload: `session_id`, `transcript_path`, `cwd`, `hook_event_name`, `model`, `permission_mode`,
  plus `turn_id` on turn-scoped events and `tool_name` / `tool_input` on this one.

**None of this changes `hooks.mjs` in this package, and it should not be changed on the strength of
it.** `src/adapters/codex/hooks.mjs` currently says Codex "does not provide a way for DeckHQ to be
notified when something happens in a session". **That sentence is now false**, and it is false in
precisely the way `ADAPTERS.md` §5 forbids — a false statement about somebody else's product. It is
Gemini CLI's situation, not the one Codex was in when §8 was written: a real hook mechanism DeckHQ
has not wired up. **Correcting that note is a WP-23 deliverable** (§6, item 8); it is a copy change
to `describe()` and a test, not a hook installation, and `supported: false` stays until somebody
writes a `hooks.json` on a real install and watches Codex read it back.

One further find, unasked for and worth a line: `state_5.sqlite` has an
`external_agent_config_imports` table with a `provider_id` column, and
`.codex-global-state.json` has a key `external-agent-import-discovery:claude-code,claude-cowork`.
The Codex app looks for Claude Code's configuration in order to import it. Nothing to do about it;
noted so nobody discovers it during a demo.

---

## 4. Do the adapter's assumptions hold?

Checked line by line against §3. **Mostly yes**, which is the surprising result and the reason this
document is not a rewrite plan.

### 4.1 What holds

| Assumption in `parse.mjs` / `adapter.mjs` | Verdict |
|---|---|
| Sessions are JSONL under `~/.codex/sessions/**`, walked recursively | **Holds.** The `YYYY/MM/DD` nesting is 3 deep; `MAX_WALK_DEPTH = 8` covers it. |
| Filename is `rollout-<timestamp>-<uuid>.jsonl`; `sessionIdFromFilename` takes the trailing uuid | **Holds** (DOCS). |
| First line is a `session_meta` record, `{type, payload}`, carrying `id`, `timestamp`, `cwd` | **Holds** (DOCS). |
| `cwd` comes from `payload.cwd` | **Holds.** The `originator` / `workdir` aliases are belt-and-braces and cost nothing. |
| Records are `{type, payload}` envelopes; `response_item` / `event_msg` / `turn_context` | **Holds** (DOCS). |
| Tool calls and reasoning are separate item types and must not reach the conversation | **Holds.** The exact `NON_MESSAGE_ITEM_TYPES` membership is still unchecked against a real file. |
| `token_count` usage is cumulative, so last-wins rather than summed | **Unchecked.** Named in §6 as the first number to measure. |
| `available()` is `fsp.access('~/.codex')` | **Holds, and is now `true` here** — see §4.3. |
| `['codex', 'resume', <id>]` | **Holds.** `codex resume [OPTIONS] [SESSION_ID] [PROMPT]`; `SESSION_ID` is "Session id (UUID) or session name". |
| `['codex', <prompt>]` for a new session (§99) | **Holds.** `codex [OPTIONS] [PROMPT]`, "If no subcommand is specified, options will be forwarded to the interactive CLI." |
| `['exec', '--json', <text>]` | **Holds.** `codex exec [OPTIONS] [PROMPT]`, `--json` = "Print events to stdout as JSONL". |
| `['exec', 'resume', <id>, '--json', <text>]` | **Holds as a command.** `codex exec resume [OPTIONS] [SESSION_ID] [PROMPT]` with `--json`. The one soft spot is *ordering* — the adapter puts `--json` between `SESSION_ID` and `PROMPT`. Clap accepts interspersed options, so this should parse, but it is the kind of thing that is cheaper to run than to argue about. §6, item 5. |
| `detectResumeSupport()` greps `exec --help` for "resume" | **Holds**, and will answer `true` on 0.153.1. |
| No supported surface for enumerating live sessions | **Holds.** `codex agents` exists — "Browse all agent sessions on the shared local app-server daemon" — but it is a **TUI with no `--json`**, so it is not the `claude agents --json` analogue. The machine-readable surface, if we ever want one, is `codex app-server` (`daemon`, `proxy`, `generate-json-schema`), which is marked experimental. Leaving `liveSessions()` returning `[]` is still right. |

### 4.2 What does not hold — `.jsonl.zst`

`walkSessionFiles()` accepts a file only when `entry.name.toLowerCase().endsWith('.jsonl')`. A
compressed rollout is named `…jsonl.zst` and fails that test. The consequence is not a crash and not
an error in the log: **the session disappears from the floor**, and the ones that disappear are the
oldest — which is also the population §8's `maxAgeDays` window would usually have excluded anyway,
which is exactly why this could sit undetected for a long time.

It is a real defect and it is now written down. It is **not** fixed in this package, for the reason
`ADAPTERS.md` §6 gives: the fix has to be measured, not reasoned about, and there is no compressed
file on this machine to measure it against. When there is one, the shape of the fix is a decision,
not an implementation:

- **Skip them honestly.** Count them, and let `doctor` say "N sessions are archived-compressed and
  not shown". Zero new code paths, no dependency, and the number is visible rather than silent.
- **Decompress on read.** Node has `zlib.createBrotliDecompress` but no Zstandard before Node 22's
  `zlib.zstdDecompress`; this package's floor is Node 18 ([§130](../DEVIATIONS.md)), so this would
  either raise the floor or add a dependency, and [`08` §1.1 rule 3](08-PLAN-V2-100X.md) forbids the
  dependency. Not free.
- **Read the metadata from `state_5.sqlite` instead**, where a compressed thread still has a row.
  That is §7, and it is the reason §7 exists at all.

The recommendation, for what it is worth, is the first one until somebody has a floor with
compressed sessions on it and can see whether they are missed.

### 4.3 The thing that is now wrong in a new way — `available()` is `true`, `codex` is absent

`available()` answers "does `~/.codex` exist", which is `ADAPTERS.md`'s documented pattern and is
right for the *read* path: the rollout files are there or they are not, no process needed. It is
wrong for the *write* path. On this machine `available()` is `true`, so `send()` gets past its
guard, spawns `codex`, gets `ENOENT`, and `describeSpawnError` turns that into the string
**`'Codex is not installed'`** — reported to a user who installed Codex an hour ago and can see it
running in another window.

Do not change `available()`; a second probe on the poll path is exactly the cost §77 removed. The
honest fix is in the message, and it belongs with the WP-23 run rather than ahead of it: when a
spawn fails with `ENOENT` and `~/.codex` exists, say so — *"Codex's data directory is here but the
`codex` command is not on your PATH"* — and let `doctor` distinguish the two. Filed as §6 item 7.

---

## 5. What the owner should do

Both steps. They answer different questions and neither substitutes for the other: **A** produces
the data the *reading* half of the adapter is verified against, **B** makes the *writing* half
reachable at all.

### Step A — run one task in the desktop app (5 minutes)

1. Open the Codex app.
2. Open a **local** project — a scratch repository, not a ChatGPT/cloud thread. It must be a real
   directory on disk, because the whole point is to see a `cwd` in the rollout file and a room on
   the DeckHQ floor. A throwaway `git init` directory is ideal; do not use
   `1_Project_DeckHQ`, so that nothing real ends up in a screenshot.
3. Send one prompt that provokes at least one tool call and one permission prompt — `list the files
   here and then create a file called hello.txt containing the word hi` does both.
4. Answer the permission prompt in the app.
5. Send a **second** prompt in the same thread (`now read hello.txt back to me`), so the file has
   more than one turn in it. A single-turn file cannot tell last-wins from summed, and §6 item 3
   needs it to.

Afterwards, confirm without opening anything:

```sh
ls ~/.codex/sessions                        # expect YYYY/MM/DD
find ~/.codex/sessions -name '*.jsonl' | wc -l
```

### Step B — put a `codex` command on PATH (2 minutes)

Either is fine; **B1 is preferred** because it verifies the same binary the app is running.

**B1 — use the bundled CLI.** Add
`%LOCALAPPDATA%\OpenAI\Codex\bin\c03fa83159064b45` to the user `PATH` (System → Environment
Variables → user `Path` → New), then open a **new** terminal. Note that the directory name is a
build hash and **will change when the app updates**, so this is a verification convenience, not a
setup instruction to put in the README.

**B2 — install the CLI properly.** `npm i -g @openai/codex` (0.153.2, `win32-arm64` build
published). This is the durable option and the one a user would follow.

Then, in a scratch directory:

```sh
codex --version                             # expect codex-cli 0.153.x
cd /path/to/scratch-repo
codex "say hi"                              # one interactive session, then quit
codex exec --json "say hi in five words"    # one non-interactive turn, JSONL on stdout
codex migrate-rollouts --json               # reports only; does NOT migrate without --apply
```

`codex exec --json` is worth capturing to a file — it is the same event stream
`extractFinalAssistantText()` parses, and it is the cheapest way to check whether the rollout format
and the exec event format really do share a schema, which `adapter.mjs` assumes and has never seen.

### What not to do

Do not run `codex migrate-rollouts --apply`, and do not archive or delete a thread from the app
until §6 item 6 has been checked — archiving **moves the file**, and moving it is the observation.

---

## 6. WP-23 acceptance checklist

Run `node bin/deckhq.mjs doctor` and open the floor after step A. Each line is either satisfied or
becomes a numbered defect; **the package is not done until every one has an answer, including the
ones that turn out to be "no"**.

1. **The session is on the floor.** One Codex agent appears, in a room named for the scratch
   project — **not** in `unknown`. This is the `cwd` chain (`session_meta.payload.cwd` →
   `SessionSummary.cwd` → room) end to end, and it is the single most valuable assertion in the
   list.
2. **The title is the first user prompt**, whitespace-collapsed and truncated to 60 with an ellipsis
   — not a tool name, not empty, not a `[tool: …]` artefact.
3. **The numbers are real.** `tokens` is non-zero and *plausible* — compare it against what the
   Codex app reports for the same thread. A number several times too large means `token_count` is
   incremental and last-wins is wrong; a number several times too small means the opposite.
   `costEstimate` is either a real figure or `null` — **never `$0.00`** ([§111](../DEVIATIONS.md)).
   `cacheTokens` behaves the same way.
4. **The state is right.** After the assistant's final message the agent reads as `ended` /
   turn-ended; while it is mid-tool it does not. Codex sessions poll, so
   `needs_input` and `stalled` are still indistinguishable — confirm the header says so and that the
   header's sentence is the one `hooks.describe()` actually returns (see item 8).
5. **`send` works.** Open the panel, send a reply, get an assistant message back. This exercises
   `codexExecArgs` in its `canResume` form, and specifically whether
   `exec resume <id> --json <text>` parses with `--json` between the two positionals (§4.1). If it
   does not, the fix is one array literal.
6. **`resume` works, and `archive` is understood.** "Open in terminal" launches `codex resume <id>`
   in the pinned emulator and lands in the right session. Separately: archive that thread from the
   app, re-run `doctor`, and record whether the session leaves the floor — then say so in
   `DEVIATIONS.md` as a decision rather than leaving it as an accident.
7. **The "not installed" message is honest.** With `codex` off `PATH` but `~/.codex` present,
   `send` must not claim Codex is not installed (§4.3). Fix the message; add a `doctor` line that
   separates "data directory present" from "`codex` on PATH".
8. **`hooks.describe()` stops saying something false.** §3.4: Codex has `PermissionRequest` and
   `hooks.json` in 0.153.1. `supported` stays `false` — nobody has written a `hooks.json` on a real
   install and watched Codex read it back — but the note must say *"Codex does have a hooks
   mechanism; DeckHQ does not install or read it yet"*, in the shape
   [`ADAPTERS.md` §5](../ADAPTERS.md#5-hooks-and-the-line-you-do-not-cross) requires and Gemini
   CLI's note already uses. Add the test that asserts it does **not** claim the runtime lacks hooks.
9. **Compressed rollouts are accounted for** (§4.2) — either handled or counted and named in
   `doctor`. Do not leave them silently skipped.
10. **No cloud threads leaked onto the floor.** Assert the count: 100 ChatGPT threads live in
    `sqlite/codex-dev.db` and DeckHQ must show none of them. Today this is true because nothing
    reads that file; item 10 exists so it stays true if anyone acts on §7.
11. **A rollout file that has never been touched by DeckHQ is not modified.** `stat` the file before
    and after a full poll cycle plus a panel open. Read-only is a promise the README makes.
12. **Then, and only then, delete the warnings — all of them, in one commit.**
    [`ADAPTERS.md` §6.4](../ADAPTERS.md#6-the-honesty-rule): `DEVIATIONS.md` §8, the `parse.mjs`
    header's "we have never observed it directly on this machine", and the README's Honest limits
    line. Partial verification deletes nothing: if only the read path was exercised, §8 gets
    narrower, it does not disappear.

---

## 7. If we ever read the SQLite — the plan, not the build

**This section is deliberately not acted on.** §3.1 settled the question WP-23 asked: the app shares
`~/.codex/sessions` with the CLI, the JSONL is the source of truth, so **the adapter is left alone**
and the brief's condition for writing a reader does not fire. What follows exists because §4.2's
compressed-rollout problem has `state_5.sqlite` as one of its three possible answers, and because
the next person to look at this should not have to re-derive the schema. Treat it as a design note
with a **no-go** on it.

### 7.1 What it would be for

Three things the JSONL cannot give, in descending order of worth: **`git_branch`** (today `null`);
**`archived`** (today absent, which per `ADAPTERS.md` rule 7 correctly reads as "cannot report");
and metadata for **compressed** rollouts whose bytes we cannot decode (§4.2). Nothing else. It would
be an *enrichment* of a JSONL scan, never a replacement for it — `threads.rollout_path` is the join,
and the file stays the artifact.

### 7.2 The shape

Read `~/.codex/state_5.sqlite`, table `threads` (§2.3), one query, no parameters, `SELECT` only —
the discipline [§123.2](../DEVIATIONS.md) set for OpenCode's SQL, including the test asserting the
constant contains no placeholder. Columns worth taking: `id`, `rollout_path`, `cwd`, `title`,
`name`, `git_branch`, `archived`, `archived_at`, `model`, `tokens_used`, `cli_version`,
`updated_at_ms`, `recency_at_ms`, `first_user_message`, `project_id`.

**`local_thread_catalog` in `sqlite/codex-dev.db` is not a source and must never be read as one**
(§2.4) — 100 cloud threads, no `cwd`, and its timestamps are float seconds while `state_5`'s are
integer milliseconds. If it is ever read for any reason, filter `host_kind = 'local'` and treat the
rest as invisible.

### 7.3 The WAL caveat, which is why this is a no-go today

§123.3 refused a hand-rolled SQLite page reader for OpenCode because the database runs in WAL mode
and a reader of the main file alone would systematically miss the newest sessions — silently. **The
same objection applies here and this machine makes it vivid:** `state_5.sqlite` is a **4 096-byte
main file with a 1 841 672-byte WAL**. Better than 99% of its content is in the WAL. A main-file
parser would report an empty database, confidently.

So the same three conclusions follow, and they are why nothing is built:

1. **No hand-rolled parser.** Correctness needs b-tree pages *and* the WAL index *and* overflow
   chains. `08` §1.1 rule 3 forbids the dependency that would do it properly.
2. **`node:sqlite` is not available at this package's floor.** It exists from Node 22.5 and is what
   was used *for this investigation* (Node 24, on **copies**, `readOnly: true`). This package
   supports Node 18 ([§130](../DEVIATIONS.md)). It would have to be an optional enrichment behind a
   version check that degrades to nothing — which is affordable, but only if there is something
   worth the branch.
3. **Prefer the supported surface** (§2.1). `codex migrate-rollouts --json` already reports
   per-thread metadata, and `codex app-server` speaks a documented JSON-RPC protocol with a
   published schema. Either beats opening somebody else's live database.

**And if it is ever built: open a copy, or open read-only, and never in a way that can checkpoint.**
A reader that folds the WAL into the main file has written to the user's Codex install. That is the
line, and it is the one rule in this section that is not negotiable.

---

## 8. Test fixtures — nothing real enters the repository

**No file from this machine has been copied into the repository, and none may be.**
[`ADAPTERS.md` §7](../ADAPTERS.md#7-the-fixture-convention): *"Synthetic, never a real transcript.
No real paths, no real project names, no real prompts. Nobody's work goes in this repository."*

That applies with particular force here, because the tempting artifact after step A is the actual
rollout file, and it would contain the owner's prompts and an absolute path into their machine.

- The SQLite databases were copied to the **scratchpad**, outside the repository and outside the
  worktree, and only aggregates and column names from them appear in this document. The copies are
  disposable and are not tracked by anything.
- `test/fixtures/codex-sample.jsonl` stays synthetic. When the run finds a shape it does not cover,
  the fix is to **add that shape by hand** — a `.zst` sibling filename in a directory-walk test, a
  second `token_count` record, a `turn_context` carrying a model — and to update the numbered shape
  list at the top of `parse.mjs` **before** the code, as rule 2 requires.
- If a real record's shape must be recorded to reproduce a bug, transcribe the **keys and types**,
  never the values, the way §2.3 and §2.4 do above.
- `test/unit/codex-parse.test.mjs` keeps its `t.skip` guard. It has to pass on this machine, on a
  machine with no Codex, and in CI, which has neither.

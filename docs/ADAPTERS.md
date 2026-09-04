# Adapters — adding a runtime to DeckHQ

**This document is for contributors.** It is meant to be enough on its own: if you have a coding
agent that writes sessions to disk, you should be able to put it on the DeckHQ floor without
asking us anything, and without touching a file outside your own adapter directory and one line of
the registry.

DeckHQ ships four: **Claude Code**, **Codex**, **Gemini CLI** and **OpenCode**. Two of them
(Gemini CLI, OpenCode) have never been run against real data by us, and say so — see
[§6, the honesty rule](#6-the-honesty-rule), which is the part of this document we care about most.

---

## 1. The shape of the work

An adapter is one directory under `src/adapters/<id>/` with three files:

| File | Holds | Rule |
|---|---|---|
| `adapter.mjs` | I/O only: directory walking, bounded reads, spawning. The exported `RuntimeAdapter`. | Every process it starts takes an **argv array**. No shell, ever. |
| `parse.mjs` | **All** knowledge of the runtime's on-disk format: field names, file layout, SQL. Pure functions. | A format break must be a single-file fix. |
| `hooks.mjs` | Hook install/describe/remove, or `supported: false`. | Never write to a user's file you cannot test. |

Plus, outside your directory, exactly two things:

- **one line** in `src/adapters/index.mjs` — import it, add it to `REGISTRY`;
- **one union member** in `src/core/model.mjs`'s `RuntimeId` typedef, because the type gate checks it.

That is the whole integration. `doctor` rows, the floor, the deck, the panel, the ledger, cost
estimates, the hooks status screen and the settings sheet all read the registry and none of them
names a runtime. There is a test that keeps this honest — `test/unit/doctor.test.mjs`, *"a THIRD
and FOURTH runtime get their doctor rows from the real registry, with no doctor change"* — because
the cheap way to add a runtime is to special-case it somewhere, and nobody would notice for a
release.

---

## 2. The contract

The authoritative definition is [`02-ARCHITECTURE.md` §2](02-ARCHITECTURE.md#2-the-adapter-interface).
Reproduced here with what each method owes you in practice.

```ts
interface RuntimeAdapter {
  readonly id: RuntimeId;      // 'claude-code' | 'codex' | 'gemini-cli' | 'opencode' | yours
  readonly label: string;      // shown to humans: 'Gemini CLI'

  available(): Promise<boolean>;
  liveSessions(): Promise<LiveSession[]>;
  scanSessions(opts?: { maxAgeDays?: number; limit?: number }): Promise<SessionSummary[]>;
  conversation(id: string, opts?: { maxMessages?: number }): Promise<Message[]>;
  send(id: string, text: string, opts?: { cwd?: string; timeoutMs?: number }): Promise<SendResult>;
  openInTerminal(id: string, cwd: string, opts?: { terminal?: string }): Promise<void>;
  openNewSession(cwd: string, opts?: { instructions?: string; terminal?: string }): Promise<void>;

  hooks: {
    supported: boolean;
    describe(port: number): HookPlan;
    install(port: number): Promise<void>;
    remove(): Promise<void>;
    installed(port?: number): Promise<boolean>;
    installedPort?(): Promise<number | null>;
  };

  // Optional. Omit them and the product simply asks somebody else.
  version?(): Promise<string | null>;
  countCatchphrase?(opts: { since: number; until?: number }): Promise<CatchphraseCount>;
  watchConversation?(...): ...;
}
```

### `available()`

**Cheap, cached for the process lifetime, never throws.** It is called on the poll path, so it may
not spawn a process. Check for the runtime's data directory:

```js
let availableCache = null;
async function available() {
  if (!availableCache) {
    availableCache = fsp.access(homeDir()).then(() => true).catch(() => false);
  }
  return availableCache;
}
```

`false` is not a failure state — it is the normal answer on most machines, and **every other method
must be safe to call anyway**. Return `[]`, return `{ok: false, error}`, resolve silently. Never
throw because the runtime is absent.

### `scanSessions()`

Every session on disk, newest first. Both options are optional at runtime — `scanSessions()` with
no argument is legal and the type gate enforces the `= {}` default.

- **Bounded reads only.** Never read a whole transcript. The Claude Code, Codex and Gemini CLI
  adapters read a 256 KB head (title, metadata) and a 2 MB tail (recent state, usage) and nothing
  in between. A multi-gigabyte session must cost the same as a small one.
- **A parse failure on one session never fails the scan.** Log it, skip it, continue.
- **`cwd` is what puts a session in a room.** Get it right or return `'unknown'`; never guess.
  Guessing puts an agent in somebody else's project.
- **Never fabricate a number.** If the runtime does not report tokens, report `0` and say so in the
  changelog as a known gap. `costEstimate` comes from `estimateCost()`, which returns `null` — not
  `$0.00` — when the rate card has no row for the model.

### `conversation()`

Text only, most recent last. **No tool calls, no reasoning, no UI notices.** The panel is a review
surface for a conversation, not a trace: a `[tool: write_file]` artefact in it is a bug. Every
adapter here has a test asserting that tool payloads do not reach the messages.

### `send()` and the terminal methods

Build the argv as a **pure exported function** so the test suite can assert the exact array:

```js
export function fooResumeCommand(sessionId) {
  return ['foo', '--resume', String(sessionId)];
}
```

A session id and a prompt arrive from an HTTP request body ([`DEVIATIONS.md` §28](DEVIATIONS.md)).
Each must be **one element** of the array and never concatenated into a longer one, so the only
thing that ever parses them is the runtime's own argument parser. Test it with a hostile id:

```js
const nasty = "x'; rm -rf ~ #";
assert.deepEqual(fooResumeCommand(nasty), ['foo', '--resume', nasty]);
```

Then hand the array to `launchTerminal()` from `src/core/terminals.mjs`, which owns emulator
detection and the per-emulator argv on all three platforms. **Do not build a terminal command
yourself.** `openInTerminal` swallows launch failures (there is no result channel); `openNewSession`
lets them through (the route reports them).

### `hooks`

Return `supported: false` unless the runtime has a **documented, settings-driven, shell-command**
hook mechanism *and* you can test writing to it. See [§5](#5-hooks-and-the-line-you-do-not-cross).

---

## 3. Stability rules

These are the rules that survive contact with a runtime changing its format under you.

1. **All parsing lives in `parse.mjs`.** Nothing outside `src/adapters/<id>/` may read a transcript
   or shell out to a runtime CLI ([`08` §1.1 rule 8](plan/08-PLAN-V2-100X.md)). If a route needs to
   know what a payload means, it asks the adapter — that is why `hooks.toolSummary` and
   `hooks.permissionRequest` exist on the Claude Code adapter.
2. **Head the file with the shapes you handle**, as a numbered list, and update that list *before*
   you change the code. Every `parse.mjs` here does this. It is the fastest way for the next person
   to see whether a new format version is covered.
3. **Prefer a supported surface over file parsing wherever both exist** (§2.1). `claude agents
   --json` beats guessing at liveness. `opencode db … --format json` beats parsing SQLite pages.
4. **Never throw on bad input.** A corrupt line yields `null` and the caller skips it. A missing
   directory reads as empty. Assume the file is being appended to *while you read it* — a head read
   can cut the last line mid-object and a tail read can cut the first, which is what
   `linesFromChunk(text, {dropFirstPartial, dropLastPartial})` is for.
5. **Cache anything that costs a process.** If a read spawns the runtime's CLI, put a TTL on it.
   [`DEVIATIONS.md` §77](DEVIATIONS.md) is the case that made this a rule: `claude agents --json`
   on every 5 s poll cost ~12% of a core at idle, and a 60 s TTL removed it. The OpenCode adapter
   caches its roster for 60 s for exactly this reason.
6. **Duplicate the byte-window helpers rather than sharing them.** `readHead`, `readTail`,
   `linesFromChunk` and `parseLine` are copied into each JSONL adapter's `parse.mjs`. That is
   deliberate: rule 1's promise — a format break is a *single-file* fix — is worth more than sixty
   duplicated lines, and it means you can copy one file and own all of it without any chance of
   breaking another runtime.
7. **`archived` is answered fresh on every scan, never cached.** An absent flag means "this runtime
   cannot report it" and must never be read as "not archived" ([`DEVIATIONS.md` §46](DEVIATIONS.md)).

---

## 4. A worked example

Adding a runtime called **Foo CLI**, which stores JSONL sessions at `~/.foo/sessions/*.jsonl`.

### Step 1 — `src/adapters/foo/parse.mjs`

Start with the header. Provenance first, then the shapes:

```js
/**
 * Foo CLI session parsing.
 *
 * PROVENANCE: read from github.com/foo/foo-cli `main` on <date>, files
 * `src/session/record.ts` and `src/storage.ts`. Verified against a real
 * profile on <date> / NOT verified — see the honesty rule in docs/ADAPTERS.md.
 *
 * SHAPES THIS FILE HANDLES (update this list first when the format changes):
 *   1. Meta line:    { v: 1, id, cwd, started_at }
 *   2. Message line: { at, who: 'human'|'bot', body }
 *   3. Tool line:    { at, tool: {...} }  — skipped, never conversation
 */
```

Then pure functions, no I/O beyond the byte-window readers. Copy `readHead`, `readTail`,
`linesFromChunk` and `parseLine` from `src/adapters/codex/parse.mjs` (see rule 6), then write:

```js
export function extractSessionMeta(rec) {
  if (!rec || typeof rec !== 'object' || rec.v === undefined) return null;
  return { id: firstString(rec.id), cwd: firstString(rec.cwd) };
}

export function extractMessage(rec) {
  if (!rec || typeof rec !== 'object') return null;
  const role = rec.who === 'human' ? 'user' : rec.who === 'bot' ? 'assistant' : null;
  if (!role) return null;                        // a tool line is not a message
  const text = typeof rec.body === 'string' ? rec.body : '';
  if (!text) return null;
  return { role, text, at: Date.parse(rec.at) || null };
}
```

### Step 2 — `src/adapters/foo/hooks.mjs`

Foo CLI has no hooks, so:

```js
function describe() {
  return {
    file: '(none — Foo CLI has no hook mechanism)',
    json: '',
    events: [],
    note:
      'Foo CLI does not provide a way for DeckHQ to be notified when something happens in a ' +
      'session, so DeckHQ periodically re-reads each transcript to follow its state. It cannot ' +
      'tell a session waiting on your permission ("needs input") from one that has simply ' +
      'stopped ("stalled"). Claude Code sessions are not affected.',
  };
}
export const hooks = {
  supported: false,
  describe,
  install: async () => { throw new Error('Foo CLI has no hook mechanism.'); },
  remove: async () => { throw new Error('Nothing to remove.'); },
  installed: async () => false,
};
```

The `note` is shown to a human on the hooks status screen. Say what is lost and what is not.

### Step 3 — `src/adapters/foo/adapter.mjs`

Copy the skeleton from `src/adapters/codex/adapter.mjs` — it is the smallest complete one — and
replace the format calls. Then:

```js
export const adapter = {
  id: 'foo',
  label: 'Foo CLI',
  available, liveSessions, scanSessions, conversation,
  send, openInTerminal, openNewSession, hooks,
};
export default adapter;
```

### Step 4 — register it

`src/core/model.mjs`:

```diff
-@typedef {'claude-code'|'codex'|'gemini-cli'|'opencode'} RuntimeId
+@typedef {'claude-code'|'codex'|'gemini-cli'|'opencode'|'foo'} RuntimeId
```

`src/adapters/index.mjs`:

```diff
+import fooAdapter from './foo/adapter.mjs';
-const REGISTRY = [claudeCodeAdapter, codexAdapter, geminiCliAdapter, opencodeAdapter];
+const REGISTRY = [claudeCodeAdapter, codexAdapter, geminiCliAdapter, opencodeAdapter, fooAdapter];
```

**That is the last file outside your directory you touch.** Run `npx deckhq doctor` — there is now
a `foo cli` row.

### Step 5 — fixture and tests

See [§7](#7-the-fixture-convention). Then:

```
npm run lint && npm run format:check && npm run typecheck && npm test
```

---

## 5. Hooks, and the line you do not cross

Hooks are how DeckHQ learns that a turn ended without polling for it, and they are the difference
between `needs_input` and `stalled` being distinguishable. They are also the only thing in this
codebase that **writes into a file another product owns**.

So the bar is high, and it is not "the runtime has hooks":

- **`supported: true` means DeckHQ writes a settings file and can prove the runtime read it.**
  Claude Code is the only adapter here that qualifies.
- **A documented hook mechanism you have never tested is still `supported: false`.** Gemini CLI has
  a real hooks system — `BeforeTool`, `AfterTool`, `SessionStart` and the rest, in
  `~/.gemini/settings.json` — and this repository still reports `supported: false` for it, because
  nobody here has an install to write to and check. Shipping a settings block on the strength of a
  documentation page can break somebody's working install of another product, silently.
- **`describe()` must be honest about which of those two it is.** Codex genuinely has no mechanism
  and says so. Gemini CLI's note says *"Gemini CLI does have a hooks mechanism … but DeckHQ does not
  install or read it yet"*, and there is a test asserting it does **not** claim otherwise. Reusing
  Codex's sentence would be a false statement about somebody else's product, which
  [`08` §1.1 rule 11](plan/08-PLAN-V2-100X.md) forbids as firmly as a false statement about ours.
- **A plugin API is not this interface.** OpenCode's plugins are JavaScript modules loaded into the
  agent. Installing one is a different consent conversation from "here is the JSON we will add",
  and it deserves a package that designs it rather than a paragraph that assumes it.

`supported: false` costs the needs-input/stalled distinction and nothing else. Every other feature
works.

---

## 6. The honesty rule

**An adapter is UNVERIFIED until it has been run against real data from a real install, and it must
say so — in its own header, in `DEVIATIONS.md`, and in the README's Honest limits.**

This is the rule that matters most in this document, and it comes from
[`08` §1.1 rule 11](plan/08-PLAN-V2-100X.md): *a claim in anyone's documentation is a hypothesis
until measured on a machine*. A runtime's own docs can be out of date, can describe a version you
do not have, or can disagree with its source. Two examples from this repository, both found while
writing the adapters that ship here:

- Gemini CLI's documentation describes the per-project directory as a `<project_hash>`. Its source
  has replaced the hash with a slug, and the difference is load-bearing — a slug can be resolved to
  a real path through `~/.gemini/projects.json` and a hash cannot be reversed at all. An adapter
  that trusted the docs would report `cwd: 'unknown'` for every session.
- OpenCode moved from flat JSON files to SQLite in v1.2.0 and **did not delete the old files**. An
  adapter that read them unconditionally would put every migrated session on the floor twice.

So:

1. Say it in the `parse.mjs` header: what was read, from which repository and file, on what date,
   and whether it was checked against a real profile.
2. Say it in `DEVIATIONS.md` with a number.
3. Say it in the README's **Honest limits**, in a sentence a user will understand — the model is
   [`DEVIATIONS.md` §8](DEVIATIONS.md), which has said Codex is unverified since the day it was
   written.
4. When somebody does run it against real data: fix what breaks, then **delete the warnings in the
   same commit**. A stale "unverified" is its own kind of dishonesty.

We would rather ship four runtimes with two of them labelled unverified than ship two and let
people find out.

---

## 7. The fixture convention

Every adapter has a synthetic fixture in `test/fixtures/` and a test file
`test/unit/<id>-parse.test.mjs`. The existing ones are the pattern:

| Adapter | Fixture | Test |
|---|---|---|
| Claude Code | `claude-sample.jsonl` | `claude-parse.test.mjs` |
| Codex | `codex-sample.jsonl` | `codex-parse.test.mjs` |
| Gemini CLI | `gemini-sample.jsonl` | `gemini-parse.test.mjs` |
| OpenCode | `opencode-db-sessions.json`, `opencode-db-messages.json`, `opencode-export.json` | `opencode-parse.test.mjs` |

**Rules for a fixture:**

- **Synthetic, never a real transcript.** No real paths, no real project names, no real prompts.
  Nobody's work goes in this repository.
- **It mimics one artifact exactly.** A JSONL runtime gets a `.jsonl` file. A runtime you read
  through a CLI gets one file per command's output, named after the command.
- **Include the awkward cases**, because they are the ones that break:
  - a deliberately corrupt line, which must be skipped rather than thrown on;
  - a tool call and a reasoning/thought record, which must not reach the conversation;
  - a record with no text at all;
  - two usage records, so the test proves whether they are summed or last-wins;
  - a metadata update that arrives *after* the first line, if the format has them.
- **Document the shape in `parse.mjs`, not in the fixture.** JSON has no comments and the header
  list is the thing people actually read.

**Rules for the test:** it does two jobs, and both are required.

```js
// 1. Pin the format.
test('fixture: tokens and turn-ended', async () => { … });

// 2. Prove it degrades on a machine without the runtime.
test('adapter: every read degrades to empty on a Foo-free machine', async (t) => {
  if (await adapter.available()) {
    t.skip('Foo CLI is present on this machine — the degradation path is not reachable');
    return;
  }
  assert.deepEqual(await adapter.scanSessions({ maxAgeDays: 30, limit: 10 }), []);
  assert.deepEqual(await adapter.scanSessions(), []);   // a bare call is legal
  assert.deepEqual(await adapter.liveSessions(), []);
  assert.deepEqual(await adapter.conversation('foo:abc'), []);
});
```

The `t.skip` guard matters: these tests must pass both on a machine with the runtime and on one
without, because CI has neither.

Cover, at minimum: **title**, **cwd**, **last activity**, **tokens** (if the format carries them),
**turn-ended detection**, the **exact argv arrays** including a hostile session id, and the
**hooks** object.

---

## 8. Checklist

- [ ] `src/adapters/<id>/{adapter.mjs,parse.mjs,hooks.mjs}`
- [ ] `parse.mjs` header: provenance with dates and URLs, and the numbered shape list
- [ ] Every method safe to call when `available()` is false — no throws
- [ ] Bounded reads; a parse failure skips one session and no more
- [ ] Argv arrays from pure exported functions; no shell anywhere
- [ ] A TTL on anything that spawns a process
- [ ] `hooks.supported: false` unless you can test the install
- [ ] Synthetic fixture with the awkward cases
- [ ] `test/unit/<id>-parse.test.mjs` — format pinned, degradation proved
- [ ] One line in `src/adapters/index.mjs`, one union member in `RuntimeId`
- [ ] `DEVIATIONS.md` entry, README Honest limits line if unverified
- [ ] `npm run lint && npm run format:check && npm run typecheck && npm test`

Open a pull request. If `ADAPTERS.md` did not tell you something you needed, say so in it — that is
a defect in this document and we would rather fix it than answer the question twice.

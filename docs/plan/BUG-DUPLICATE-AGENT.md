# Bug — one conversation, several agents, several names, several zones

**Reported** 14 September 2026 by the owner, verbatim:

> _"I see 'southeast asia trip planning' agent named Greta 2 in the room, and for the same session an
> agent named Sena 3 chilling in the lounge."_

**Status:** reproduced on the owner's own machine, root cause proved, fixed (`docs/DEVIATIONS.md`
§155).

---

## 1. Reproduction, read-only, on the owner's real data

The daemon was already running on the port `~/.deckhq/daemon.json` names (4317, pid 77624). Nothing
was started, nothing was killed, and nothing under `~/.claude`, `~/.codex` or `~/.deckhq` was
written. `GET http://127.0.0.1:4317/api/state` was read once; the transcripts under
`~/.claude/projects/` were opened read-only.

### 1.1 Both agents are in the snapshot, exactly as described

| field | one | the other |
| --- | --- | --- |
| `id` | `claude-code:5a03e0ea-877e-46f5-bffa-01e258b6a6a9` | `claude-code:155a04b4-7fea-42e4-8ca2-3587c7b32543` |
| `title` | `Southeast Asia trip planning` | `Southeast Asia trip planning` |
| `givenName` | `Greta 2` | `Sena 3` |
| `mk` | `MK2.10` | `MK2.11` |
| `projectId` | `c-dk-projects-1-1percent-better` | `c-dk-projects-1-1percent-better` |
| `activityState` | `stalled` | `ended` |
| `ackState` | `active` | `active` |
| `live` | `true` | `false` |
| `subagent` | `false` | `false` |
| `lastActivityAt` | 2026-09-14T10:18:27.923Z | 2026-09-14T03:56:56.164Z |

`placement()` (`public/floor-rule.js`) puts the first at a **desk** (`stalled` ∈ `AT_DESK_STATES`)
and the second in the **lounge** (`ended`, not benched). That is the picture the owner sent: one in
the room, one on the sofa.

### 1.2 The project's transcripts

`~/.claude/projects/C--Dk-Projects-1-1percent-better/` — ten top-level `.jsonl` files, ten registry
records, all `projectId` `c-dk-projects-1-1percent-better`, all `cwd` `C:\Dk\Projects\1_1percent_better`.

| session id | size | mtime | title | registry name | state / ack |
| --- | ---: | --- | --- | --- | --- |
| `5a03e0ea-…` | 7,860,580 | 14 Sep 18:19 | Southeast Asia trip planning | `Greta 2` MK2.10 | `stalled` / `active` |
| `155a04b4-…` | 5,635,608 | 14 Sep 11:56 | Southeast Asia trip planning | `Sena 3` MK2.11 | `ended` / `active` |
| `c3a9e7ba-…` | 11,550,119 | 10 Sep 11:12 | Southeast Asia trip planning | `Tai` MK2.2 | `for_review` / `benched` |
| `92e69cc5-…` | 3,752,564 | 7 Sep 20:28 | (other) | `Nova` MK2.1 | `for_review` / `benched` |
| `7dada227-…` | 1,868,820 | 8 Sep 22:47 | (other) | `Isla 2` MK2.6 | `ended` / `benched` |
| `618d825b-…` | 6,396,169 | 28 Aug 15:13 | Southeast Asia trip planning | `Petra` MK2.3 | `ended` / `benched` |
| `cacc0dd3-…` | 6,234,696 | 22 Aug 02:47 | Southeast Asia trip planning | `Kobe` MK2.4 | `ended` / `benched` |
| `c8ead7c8-…` | 316,864 | 31 Aug 22:42 | Southeast Asia trip planning | `Otto` MK2.5 | `ended` / `benched` |
| `d755ac8a-…` | 1,238,223 | 4 Sep 22:23 | (other) | `Livia 2` MK2.7 | `ended` / `let_go` |
| `9374ff30-…` | 274,250 | 8 Sep 20:33 | (other) | `Tomas 3` MK2.8 | `ended` / `benched` |

Each file's own `sessionId` field equals its filename in every record; there is no id mismatch
anywhere. The registry keyed each file as `claude-code:<filename>`, one agent per file
(`_computeAgents` in `src/core/state-machine-compute.mjs`).

`subagents/` directories exist for `92e69cc5`, `9374ff30`, `c3a9e7ba` and `c8ead7c8`; none of them
holds either of the two agents in the report, and both carry `subagent: false`.

---

## 2. Root cause

**`5a03e0ea` is `155a04b4` resumed. They are one conversation, and DeckHQ registered them as two
sessions because Claude Code gives a resumed conversation a brand-new session id and a brand-new
transcript file.**

### 2.1 The proof

Message-record `uuid`s are per-record and random; a shared one means the record was copied, which
only happens when a transcript is replayed into a new file.

| pair | shared message uuids |
| --- | ---: |
| `155a04b4` ∩ `5a03e0ea` | **1300** of `155a04b4`'s 1303 |
| `155a04b4` ∩ `c3a9e7ba` | 1070 |
| `5a03e0ea` ∩ `c3a9e7ba` | 1070 |
| either ∩ `7dada227` (an unrelated session) | **0** |

Both files' first non-sidechain message record is byte-identical:

```
uuid 3625bd2e-ade5-49dd-96c1-18203ebeab0c  parent 9676a9f4-…  2026-08-29T05:10:45.063Z
type user  isCompactSummary true  isSidechain false
```

and `618d825b`, `c3a9e7ba`, `c8ead7c8` and `cacc0dd3` all share a different one
(`1a0c9e2d-6b47-4ef4-adde-09134fe0e3d9`, 2026-08-19T17:17:02.899Z) — a second resume chain, four
files long, in the same room.

### 2.2 Over the whole machine

Of the **101** top-level Claude Code transcripts the registry holds records for, grouping by
(project directory, first message-record uuid) yields **92** conversations and **9 redundant agent
records**:

```
C--Dk-Projects-1-1percent-better         3625bd2e => 155a04b4 5a03e0ea
C--Dk-Projects-1-1percent-better         1a0c9e2d => 618d825b c3a9e7ba c8ead7c8 cacc0dd3
C--Dk-Projects-1-Project-CareerOps…      4815f7f3 => 0821ede2 e882211e
C--Dk-Projects-1-Project-CareerOps…      ce683828 => 40f0c5c0 7a2a98e6 d74ca75d
C--Dk-Projects-1-Project-CareerOps…      86e22dab => bcc6ac06 ff7a3e82
C--Dk-Projects-1-Project-DeckHQ          01c67e56 => 49891f57 d9d7c84b
```

Nine percent of the floor is the same conversation drawn more than once.

### 2.3 DeckHQ manufactures them itself

`src/adapters/claude-code/adapter-open.mjs:32` spawns `claude --resume <sessionId>` and
`adapter-send.mjs:105` sends with `--resume`. Every "open in terminal" on a finished session
therefore mints a new session id, a new transcript, a new MK number and a new first name — and
leaves the old record on the floor beside it. The bug grows every time the product is used as
designed.

### 2.4 What the runtime tells us, and what we infer

Stated for the honesty rule in `docs/ADAPTERS.md`:

- **Told.** Every record carries `sessionId`, `uuid`, `parentUuid` and `timestamp`. A resumed
  transcript replays the prior conversation and rewrites `sessionId` on every replayed record.
- **Told.** `bridge-session` records carry a `bridgeSessionId`; the two files in the report carry
  *different* ones (`cse_011Fqj7NJicRYkYLbCGMQWg4` vs `cse_01UfunEQ83qsdNmL8cw7Xx8k`), so that field
  is not the link.
- **Not told.** There is no `resumedFrom`, no parent-session field, nothing naming the predecessor.
  Every occurrence of an older session id inside a newer transcript is incidental — a scratchpad
  path, a shell command, a file attachment.
- **Inferred.** Two transcripts in the same project directory whose first non-sidechain message
  record has the same `uuid` are the same conversation. This is stated as an inference in
  `README.md` (Honest limits) and in `docs/DEVIATIONS.md` §155.

### 2.5 The " 2" / " 3" suffixes are not a second assignment

`Identity.givenName` (`src/core/identity.mjs`) walks `SHORT_NAMES` forward from a hash of the agent
id and takes the first unused name; only when **every** name is taken does it fall back to
`"<base> N"`. `public/names.js` holds **60** names; the registry holds **108** agents and
`takenNames` is **110**. The pool has been exhausted for a long time, so every new agent gets a
suffix. `Greta 2` and `Sena 3` are correct output of a correct rule on an over-subscribed pool —
`Greta` is MK3.27 in `career-ops`, `Sena` is MK3.11 there and `Sena 2` is MK14.1 in a worktree.

The suffixes are a *symptom*: 9 of the 110 names were spent on duplicate records. Collapsing the
chains removes that demand; it does not remove the underlying shortage. See §4.

---

## 3. Candidates ruled out, and how

| candidate | verdict | evidence |
| --- | --- | --- |
| (a) a resumed/continued session becomes a second record | **this is it** | §2.1, §2.2 |
| (b) a subagent registered as a peer rather than a junior | ruled out | both records are `subagent: false`, both files are top-level in the project directory, neither is under a `subagents/` directory, and `listSessionFiles` is deliberately non-recursive |
| (c) hook id vs transcript id differ | ruled out | every record in both files carries a `sessionId` equal to its filename; every one of the 108 registry agents resolves to a real transcript except 2 juniors and 5 Codex sessions, so no record was created by a hook alone; `projectId` and `cwd` are identical for both |
| (d) placement reads one list for desks and another for the lounge | ruled out | `placement()` in `public/floor-rule.js` is one function over one list and is the only copy either side of the static-file boundary (WP-22); the two bodies on screen are two different `id`s, not one id in two zones. Now held by a test anyway — see §5 |
| (e) identity keyed on something unstable | ruled out as a cause, true as a consequence | `Identity` is keyed on the agent id, which is `runtime:sessionId` and never a file path. Two ids is why there are two names; it is not why there are two ids |

---

## 4. Siblings found in the sweep

Every list of sessions in the tree was checked against the rule that it must derive from the one
registry.

**Clean — they read `registry.snapshot().agents` or a snapshot handed to them:** `src/http/routes/*`
(`/api/state`, `/api/agents/*`), `public/deck*.js`, `public/render/plan*.js` and `agents*.js`,
`public/minifloor.js`, `src/core/ledger-*.mjs`, `src/core/state-machine-snapshot.mjs`.

**Fixed here:**

- `src/core/state-machine-compute.mjs` — the merge itself; one agent per transcript file. §2.
- `src/core/state-machine-scan.mjs:_syncArchived` — walked every summary including superseded ones,
  so archiving an ancestor in the Claude Code app moved `ackState` on a record that is no longer a
  session. Now walks the collapsed list.

**Listed, not fixed — none can double-count a session, all are keyed by the one agent id:**

- `src/core/state-machine-base.mjs:38` `_pendingPermissions` — `Map<agentId, …>`, written by
  `setPendingPermission` and read in `_computeAgents`. A permission prompt that arrives for a
  superseded id is now dropped with its agent; harmless, but it means a prompt raised against a
  session in the same second it was resumed is not shown. No occurrence in the owner's data.
- `src/core/state-machine-base.mjs:44` `_stoppedJuniors` — pruned against the scan every rebuild.
- `src/adapters/claude-code/adapter-scan.mjs:127` the junior index — keyed by junior id, rebuilt per
  scan.
- `src/adapters/claude-code/stream.mjs` — one stream per agent id, opened from the panel.
- `src/core/summary-cache.mjs` — keyed by file path + mtime + size, which is correct for a cache of
  file reads and is not a session list.
- `src/http/routes/actions.mjs:421` — the pending-identity match filters on `!a.displayName` over
  `registry.agents`, and `registry.agents` is `_agents`, which never carries `displayName`: identity
  is applied in `snapshot()`. The clause is therefore always true, so a name queued by "start a
  session here" attaches to the newest session in that cwd even if that session already has a name
  the user chose. Real, small, and a different package's — fixing it means deciding what the `+`
  button should do when its session never arrives, which is not this bug.
- `public/names.js` holds 60 names against 92 conversations, so the suffix fallback in
  `src/core/identity.mjs:157` is permanently engaged on this machine. Not a defect, but the pool
  should grow; left for a package that can regenerate the goldens that paint names.

---

## 5. The fix, in one paragraph

`parse.mjs` now reports `originUuid` — the `uuid` of the first non-sidechain message record, read
from the head window it already reads. `src/core/resume-chain.mjs` groups summaries by
(runtime, project directory, `originUuid`); the member with the newest activity survives and the
rest are superseded and never become agents. The survivor wears the **earliest** member's identity,
so the MK number and the first name the user learned stay put and nothing is ever reassigned.
`ackState` is untouched: the survivor keeps its own record, superseded records keep theirs in the
store for the day they are seen alone again. Invariants held by tests: one agent per conversation,
every agent in exactly one placement zone, no two drawn agents sharing a name, and a suffix only
where the base name is genuinely taken.

## 6. Verified, on the machine it was reported from

A registry built over the owner's real transcripts with `DECKHQ_STATE_DIR` pointed at a copy of
`~/.deckhq`, reading `~/.claude` and writing nothing there:

| | before | after |
| --- | ---: | ---: |
| Claude Code agents | 103 | **94** |
| chains collapsed | — | **6** |
| sessions titled "Southeast Asia trip planning" | 6 | **2** — the two genuinely different conversations that share that custom title |
| duplicate names among drawn agents | — | **0** |
| agents in more than one zone | — | **0** |

`5a03e0ea` and `155a04b4` are one agent, in one zone, under one name.

**One consequence, stated.** On a chain that already existed, the survivor wears the identity of the
chain's OLDEST TRANSCRIPT, which is not always the one DeckHQ numbered first — the four-deep chain
survives as `c3a9e7ba` (known as `Tai`, MK2.2) wearing `Otto`, MK2.5, because `c8ead7c8` is the
original and `Tai` was a resume of it that the first scan happened to see first. A one-time
renumbering on backfill; for every chain formed from now on the two orders agree.
`docs/DEVIATIONS.md` §155.5.

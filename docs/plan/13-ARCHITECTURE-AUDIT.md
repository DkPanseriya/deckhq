# 13 — Architecture audit

**Date:** 16 September 2026 · **Package:** WP-91 · **Status:** read-only. Nothing in `src/`,
`public/`, `test/` or `scripts/` was changed to write this. · **Machine-readable companion:**
[`13-audit-map.json`](13-audit-map.json) — every module with its size, its imports, its importers,
its layer, the invariants it enforces and the tests that reach it.

The owner asked for an architecture that is clean, extendable and modular, and said in the same
breath that the product finally works and must not be overhauled. This document takes both halves
seriously. It measures what is there, names what is wrong with evidence, and proposes only moves
that can be proved not to change a pixel or a byte of `/api/state`.

**Method.** Every `import`, `export … from`, dynamic `import()` and `require()` in `src/`,
`public/`, `bin/`, `scripts/`, `test/`, `site/`, `vscode/` and `plugin/` was extracted after
stripping comments, so a JSDoc `import('./x.js')` type reference is not counted as an edge. The
result is 282 non-test modules, 143 test files and **731 value edges**. The test suite was run
once: **2,437 tests, 2,436 passing, one platform skip, 14.8 s.** Nothing else was executed.

---

## 1. The map

### 1.1 The layers, as they actually are

| Layer | Modules | Lines | What it owns |
|---|---:|---:|---|
| `adapters` | 27 | 10,137 | All runtime-format knowledge. Four runtimes behind one interface. |
| `state-machine` | 7 | 2,162 | The merge: scan + liveness + hooks + ack → `Agent[]`. |
| `core` | 36 | 10,398 | Store, paths, clock, model, terminals, packs, launcher, permissions, sends. |
| `identity` | 5 | 1,053 | Names, MK numbers, faces, traits, the 243-name pool. |
| `ledger` | 7 | 1,716 | The append-only measurement sink. Write-only from the registry's side. |
| `studio` | 6 | 1,794 | Idea → brief → roster → board, and the consent that lets it write. |
| `http` | 18 | 4,024 | 50 routes plus the SSE channel. No domain logic. |
| `daemon` | 1 | 604 | Port adoption, wiring, CSRF, shutdown. |
| `cli` | 17 | 6,624 | `app`, `doctor`, `stats`, `look`, `studio`, `shortcut`, `statusline`, … |
| `public-app` | 60 | 18,603 | The shell: bootstrap, SSE, panel, deck, palette, settings, cards. |
| `public-look` | 4 | 1,321 | The Look control centre's UI. |
| `public-render` | 58 | 26,988 | Plan, backdrop, rig, clips, scene, agents, crew, themes. |

The layering the blueprint describes — adapters → registry → snapshot → http → render — is the
layering the code has. The graph is acyclic across every one of those boundaries: no `http/` module
imports another's internals, no `adapters/` module imports `core/state-machine*`, and the registry
reaches an adapter only through the four methods `02-ARCHITECTURE.md` §2 names. Fan-in is the shape
it should be: `clock.mjs` (27 importers, 131 lines), `model.mjs` (26), `paths.mjs` (20),
`http/server.mjs` (18) are what everything leans on, and all four are small and pure.

### 1.2 Cycles: three, all small, none across a layer

1. **`src/cli/app.mjs` → `pin.mjs` → `shortcut.mjs` → `app.mjs`.** Three CLI commands that each
   offer the next one ("app mode installed — pin it?"). Real, and benign because every edge is
   used inside a function body rather than at module scope.
2. **`public/settings-ui.js` ↔ `settings-ui-rates.js`.** §131's shape-3 split: the part calls back
   into the closure through a `wire()`. Documented and intentional.
3. **`public/deck.js` ↔ `public/usage.js`.** The same pattern, undocumented.

None of these can deadlock — ES module cycles resolve as long as nothing in the cycle reads an
imported binding at module-evaluation time, and none of these does. They are readability debt, not
defects. The thirteen-module "cycle" through `plan*.js` that a naive scan reports is an artefact of
JSDoc `import()` annotations and is not real.

### 1.3 The static-file boundary

**Zero `public/` → `src/` imports.** The rule `docs/DEVIATIONS.md` §122 states is held absolutely,
and it is held by physics as well as by review: `serveStatic` confines every path to `publicDir`,
so a browser could not resolve `src/` even if a module asked.

The other direction is deliberate and there are **fourteen edges**: `model.mjs` and
`state-machine-snapshot.mjs` → `floor-rule.js`; `themes.mjs`, `packs.mjs`, `packs-validate.mjs` and
`look.mjs` → `render/themes.js` and friends; `identity.mjs` and `doctor-collect.mjs` → `names.js`;
`avatars.mjs` → `render/palette.js`; `mcp-tool-name.mjs` → `mcp-tool-name.js`. Each is the same
decision — the rule is drawn in the browser, so the one copy lives where both sides can reach it —
and each is documented in its own file header, with the cost stated: those modules stay pure, and
they ship in both halves.

One of the fourteen has no consumer. `src/core/mcp-tool-name.mjs` re-exports eight names from
`public/mcp-tool-name.js` and **nothing in `src/` imports it**; only its own test does. It is a
shim for a Node-side caller that never landed, and the test is what makes it invisible.

### 1.4 The 900-line rule, and the gate that cannot see it

`test/unit/model.test.mjs:300` is the cap. It walks **eighteen prefix groups** — `public/render/plan*`,
`public/app*`, `public/panel*`, `src/core/state-machine*`, and so on — and checks 129 files against
900 lines. Every one passes; `public/app.js`, `plan.js` and `scene-draw.js` sit at 898.

Eight non-test files are over the cap. **None of them is in a group, so the gate has never looked
at one:**

| File | Lines | Gate sees it |
|---|---:|---|
| `public/render/themes.js` | 1,430 | no |
| `site/build.mjs` | 1,324 | no |
| `src/core/store.mjs` | 1,230 | no |
| `public/deck.js` | 1,113 | no |
| `scripts/goldens.mjs` | 1,054 | no |
| `src/adapters/claude-code/parse.mjs` | 978 | no |
| `src/adapters/codex/adapter.mjs` | 939 | no |
| `public/render/clips.js` | 903 | no |

There is no exemption table anywhere in the repository. `themes.js` is not "exempt at 1,429"; it
was simply never in a glob. So the honest statement is: **the ceiling is enforced over the files
that have already been split, and over nothing else.** Whether each of the eight *deserves* an
exemption is a separate question, and the answers differ. `themes.js` is three theme tables plus
one derivation plus `assertThemeContrast`; §160 made the derivation the single source of the shipped
floor, and splitting the tables from the derivation is the natural seam. `store.mjs` is
persistence plus twenty sanitisers plus the settings schema — two things. `parse.mjs` is one thing
(§2's stability rule says all parsing lives in one file per adapter) and is the one file on this
list with a documented reason to be large. `site/build.mjs`, `scripts/goldens.mjs` and
`clips.js` are each one coherent thing. `deck.js` is a table renderer plus a keyboard map plus
usage, and it is half of cycle 3.

### 1.5 Where one concept has two definitions

- **The state palette, four times.** `public/render/palette-colors.js:74` is canonical;
  `public/style.css:72` restates it as `--state-*` and `state-visuals.test.mjs` holds the two
  together; `public/app-state.js:45` carries a fallback for the case where `render/palette.js` has
  not loaded; and `public/panel-header.js:30` carries a **second, private, identical copy named by
  no test.** Three of the four are held; the fourth can drift alone. A-04.
- **`HookEvent` and `RuntimeAdapter`, six times each** — copy-pasted verbatim into all six
  `state-machine-*.mjs` modules, where `tsc` checks each against itself and drift is invisible.
  A-06.
- **The fallback comments are stale.** `app-state.js`'s header still says `render/palette.js` "is
  owned by a different engineer and may not have landed it yet".

---

## 2. Invariants

The register below is every product invariant this codebase asserts, where it is enforced, and how.
"Convention" in the last column is a finding.

| id | Invariant | Enforced in | Held by |
|---|---|---|---|
| I-01 | **Ack ownership.** No observed event clears `reviewSince`, `needsInputSince` or moves `ackState`. | `state-machine.mjs` `act()` is the only writer; `_markForReview`/`_markNeedsInput` are set-only-if-unset | **54 named `INVARIANT:` tests across 28 files** |
| I-02 | One conversation is one agent. | `resume-chain.mjs`, applied in `_doRefresh` before seed/archive/merge | `resume-chain.test.mjs` |
| I-03 | One agent stands in exactly one zone. | `public/floor-rule.js` — the only copy of `placement()` | `resume-chain.test.mjs`, `model.test.mjs`, `occupancy.test.mjs` |
| I-04 | `/api/ack` is reached from one place in the client. | `panel-actions.js` `performAction()` | `panel-invariant.test.mjs` (reads the 14 panel parts as text) |
| I-05 | A card's column moves on a user act or `blockForBudget()` and nothing else. | `studio/store.mjs`, `studio/budget.mjs` | `studio-invariant.test.mjs` |
| I-06 | Consent before any write outside `~/.deckhq/`. | `launcher.mjs`, `launcher-apply.mjs`, `studio/consent.mjs`, `claude-code/hooks.mjs` | `launcher.test.mjs`, `studio-store.test.mjs`, `hooks.test.mjs` |
| I-07 | argv arrays, never shell strings. | `cmdline.mjs` is the one quoter; `terminals.mjs`, `editor.mjs`, `adapter-send/open` | `terminals.test.mjs`, `launcher.test.mjs` |
| I-08 | No `Date.now()` / `Math.random()` under a draw path. | `scene-agent.js` splits `animMs()` (injected) from `frameMs()` (pacing) | `character-life.test.mjs` — **six named files of 58** |
| I-09 | Observe, never simulate. | adapters; `crew.js`'s seven-field member; `demo-fixture.mjs` | `subagents.test.mjs`, `crew.test.mjs`, `demo-fixture.test.mjs` |
| I-10 | The plan is deterministic; selection is an argument, not a field. | `assignSeats(plan, agents, {selectedId})` | `occupancy.test.mjs`, 16 goldens |
| I-11 | 900-line cap. | — | `model.test.mjs`, over 129 of 282 files — **see §1.4** |
| I-12 | No raw colour outside the derivation. | `themes.js` allowlist; `look-guards.js`; `assertThemeContrast` | `interior.test.mjs`, `look-guards.test.mjs`, `themes.test.mjs` |
| I-13 | Every constant is `body` or `building`; every prop tall or short. | `plan-scale.js`'s classification table | `agent-size.test.mjs` — **fails on a constant in neither list** |
| I-14 | Loopback only, zero egress. | `daemon.mjs` binds `127.0.0.1`; CSP `connect-src 'self'` | `http-server.test.mjs`, `daemon.test.mjs` |
| I-15 | All runtime parsing inside its adapter. | `adapters/index.mjs` is the only registry | convention — see §7 A-08 |
| I-16 | A broken ledger changes no agent and no ack byte. | `_noteLedger` runs last, on values, inside `try` | `ledger-invariant.test.mjs` (two registries, deep-diffed) |
| I-17 | Never score the human. | `wrapped.js`, `records.js`, `ledger-stats.mjs` | `wrapped.test.mjs` — no generated line addresses the reader |
| I-18 | Cost is an estimate, never a bill; tokens are the default. | `rates.mjs`, `usage.js` | `rates.test.mjs`, `wrapped.test.mjs` |

**I-13 is the model the rest should copy.** `agent-size.test.mjs` enumerates every number the seven
dimension modules export and fails on one that is in neither list, so a package that adds a
dimension *cannot ship* without deciding which side of the law it is on. I-08 and I-11 are the same
kind of law expressed as a hand-maintained file list, and both lists have fallen behind the tree:
I-08 names six of 58 render modules, I-11 names 129 of 282. Neither is breached today — every render
module was scanned for this audit and only `scene-agent.js`'s legitimate `frameMs()` fallback
appears — but neither would notice if it were.

---

## 3. Data flow and state

### 3.1 One hook event, disk to pixel

`claude` fires `Stop` → the installed hook `POST`s to `http://127.0.0.1:<port>/api/hook` with the
port recorded at install time → `routes/hooks.mjs` answers immediately and hands the payload to the
runtime's own adapter, which is the only code allowed to read it → `Registry.applyHook()` sets
`obs.activityState = 'for_review'`, clears `currentTool`, sets `closedCleanly`, and calls
`_markForReview(id, now)`, which writes `reviewSince` **only if it is unset** → `_rebuild()`
recomputes the whole `Agent[]` and compares → `_emitIfChanged()` builds one snapshot and pushes it
to every SSE subscriber → `app.js:handleSnapshot` adopts the clock, stamps drafts, applies look,
theme and avatar settings, then `scene.setState(snapshot)` → `planSignature` changed, so
`_rebuildPlan` runs, the runtime is synced twice (see §3.4), the backdrop is re-baked and the agent
walks from its desk to the office.

Nine layers, one direction, and the only user-owned write in the whole path is guarded by an
if-unset. The path is correct.

### 3.2 One transcript growing

The 5 s poll calls `adapter.scanSessions()` → `summary-cache.mjs` keyed on path + mtime + size
returns a **copy**, never the cached object → `collapseResumed()` folds resume chains and drops the
superseded ids from `_observed` and from the liveness roster → `seedIfNeeded` (once, ever) →
`_syncArchived` over the collapsed list, the one place on the scan path that writes → `_rebuild()` →
`_refreshDashboards()` (one `discoverActions` per project, filesystem, once per scan) →
`_emitIfChanged()`.

### 3.3 The snapshot's contract

`_realSnapshot()` returns `{agents, projects, crews, counts, settings, takenNames, hooks, degraded,
writeError, rateCardVersion, scannedAt, now, nowFixed}`. Three things about it are worth naming.

First, **identity is applied in `snapshot()`, not in `_agents`.** The registry's own list carries no
`displayName`, no `givenName` and no MK tag; those are stamped on during serialisation. This is
load-bearing (§155.6's always-true clause was a consequence of forgetting it) and it is stated in
`pending-identity.mjs`'s header but nowhere in `02-ARCHITECTURE.md`.

Second, **the demo substitution happens at the one place a snapshot is produced**, which is why the
actors cannot leak into `act()`, the store or the ledger. But `buildDemoSnapshot` is not
shape-parallel with `_realSnapshot`: it carries no `crews` and no `rateCardVersion`. The client
survives — `Scene.setState` recomputes crews when the field is absent — but "the demo snapshot is
the real snapshot's shape" is a property nothing checks.

Third, **`crews` is computed on the server and again on the client.** `crewsFrom()` runs in
`_realSnapshot` and again in `Scene.setState` whenever `snapshot.crews` is absent *or empty*. An
ordinary floor with no crew therefore runs the derivation twice on every single snapshot.

### 3.4 Where state is duplicated or re-derived

- `_observed` (registry) and `store.ack` are the two halves of the model and are correctly
  separated: observation in memory, user ownership on disk.
- `_lastSummaries`, `_lastLive`, `_identityOf`, `_absorbed` are per-scan derivations held on the
  instance so `_rebuild` can run without a scan. Correct, and `state-machine-base.mjs` is the only
  written-down list of what a `Registry` holds.
- **`_rebuild()` detects change with `JSON.stringify(agents)`** (`state-machine-compute.mjs:116`),
  and `_emitIfChanged()` then builds the snapshot again even when `_subscribers` is empty — the
  normal state of a daemon whose tab is closed. Two full passes over the model per change, one of
  them for nobody. A-05.
- The client's own state is `public/app-state.js`: `latestSnapshot`, `scene`, `panel`, `deckUI`,
  `palette`, `themes`, `selectedId`, `projectFilter`, `sessionTheme`, `sounds` — live bindings with
  a setter each, and `app.js` is the only file that calls a setter. It caches nothing derived; the
  one derived cache is `Scene._agentsById` and `Scene._crewCounts`, rebuilt per `setState`. Drafts
  are client-only and are stamped onto the snapshot's agents in `handleSnapshot` — **a mutation of
  the object the client was just handed** (`app.js:212`), as is `latestSnapshot.settings.onboarded =
  true` at `app.js:388`. Harmless today because every snapshot is freshly parsed from the wire, and
  a latent trap for any future path that re-feeds a snapshot object.

### 3.5 Ordering assumptions, and whether §172's sibling exists

§172.6 found `Scene#setState` syncing the runtime twice on a plan-signature change, and a
"has this synced before" flag set by the call rather than by the population. §169.3 found a
circularity in `buildOffice` that converges in one pass because growth only ever lengthens a run.
Both are still there and both are correct as written.

The sweep for siblings found **one more of the same family and no third**: `setState` computes
`assignSeats` twice on a signature change — once for `previousAgents` to bridge the re-plan, once
for `agents` — which is by design, and the bridge is skipped when `this._plan` is null on the first
snapshot, which is why §172.6's flag had to move. The remaining ordering assumptions are all stated
in place: packs load before the store (so a pack theme is not sanitised away), the ledger opens
before the registry (so the first rebuild is already recorded), `collapseResumed` runs before the
seed and the archive sync (so all three agree about who exists), and `plan-scale.js` sets the body
scale at the top of `buildPlan` before any geometry (so the plan and the figures can never be at two
sizes). Each of those is a comment; none is a test.

---

## 4. Error handling and resilience

**Corrupt files.** `Store.load()` backs a corrupt `state.json` up to `state.json.corrupt-<ts>` and
starts from defaults; a failed backup is one warning. Migrations are versioned, idempotent, recorded
under `migrations`, and never run on a fresh file (`STATE_VERSION` is 2). A pack that will not load
is one line in the log. A malformed settings file aborts a hook install and changes nothing.

**Missing CLIs.** `available()` is cached for the process lifetime and one that throws reads as
unavailable rather than failing the call. `scanSessions`, `liveSessions` and the optional
`describeReadLimits()` each fail independently, per adapter, per refresh, warning and continuing. A
parse failure on one session skips that session.

**Permission failures.** A store write that fails lands in `snapshot().writeError` and the header
says so, because an acknowledgement that did not reach disk is one that will be gone at the next
restart. It is the only failure in the system given a user-visible surface.

**SSE lifecycle.** The one genuinely hard piece, and it is correct. Every stream registers a `bye`
closure in a module-level set; `close()` sends `event: bye`, tears down and `res.end()`s each one
*before* asking the server to close, then arms a 500 ms grace and calls `closeIdleConnections()`
inside the wait rather than after it. §121, §126.3 and §128 are the three bugs that shaped it. The
client reconnects with exponential backoff to 30 s.

**Daemon restart.** `adoptHooksPort` prefers the port the installed hooks post to, refuses to start
beside a DeckHQ that already holds it, and falls back with a warning when something else does.
`for_review` survives through `_ensureObserved`'s bootstrap from a persisted `reviewSince` —
restored, never invented.

**What is swallowed.** Every ledger call, `_refreshDashboards`'s per-project probe, the daemon-file
write, SSE writes, the notifier, and `await ledger.close().catch(() => {})` on shutdown. Each is
justified in place and each is the right choice. The one gap is that **nothing aggregates them**:
there is no counter, no "n errors since start" on any surface, and `deckhq doctor` reports
configuration rather than runtime health. A daemon whose scans have been failing for an hour looks
exactly like one that has nothing to report.

---

## 5. Test architecture

**2,437 tests, 2,436 passing, one platform skip (no POSIX uid on win32), 14.8 s.** 143 test files.
Node 18/20/22 × ubuntu/macos/windows for the suite; ubuntu-only for typecheck and goldens.

**Coverage, measured as transitive reachability from a test file's imports:**

| Layer | Modules reached | Lines reached |
|---|---|---|
| `core`, `adapters`, `cli`, `http`, `state-machine`, `studio`, `ledger`, `identity`, `daemon` | all | **100%** |
| `public-render` | 57/58 | 99% (the one is `plan-shapes.js`, which is `export {}` — types only) |
| `public-look` | 2/4 | 71% |
| `public-app` | 44/60 | 77% |

Every line of the Node side is reachable from a test. The hole is the application shell:
**eighteen `public/app*.js` and `look-ui*.js` modules, about 4,500 lines, are imported by no test**
because they touch `document` at module scope. Twelve of them are at least read as *text* by a
static gate (`app.js` by twelve different test files). **Seven are neither executed nor read by
anything**: `app-dialogs.js` (347), `app-cards.js` (317), `app-launchers.js` (229),
`app-look.js` (220), `app-snapshot.js` (213), `app-floor.js` (212), `look-ui-pictures.js` (166).
§143's bug — a `close()` that resolved to `window.close` and killed the tab — lived in exactly this
region, and the entry says so: nothing in the toolchain could have caught it.

**The static gates.** Sixty test files read source as text rather than importing it — the project's
signature technique, and the right one for a repository with no runtime dependencies and hard rules
about what may not appear in a file. The notable ones: `panel-invariant.test.mjs` (concatenates the
fourteen panel parts and proves `/api/ack` has one caller), `model.test.mjs` (the 900-line cap),
`character-life.test.mjs` (no `Date.now()`/`Math.random()` on a draw path), `agent-size.test.mjs`
(every exported dimension is `body` or `building`), `lighting.test.mjs` and `interior.test.mjs`
(the carpet is a weave and not six thousand one-pixel fills), `studio-invariant.test.mjs`,
`fire-vocabulary.test.mjs`, `wrapped.test.mjs`, `site.test.mjs`, `readme.test.mjs`. **Their common
weakness is that each carries its own file list.**

**Goldens.** Sixteen captures on win32: six populations, `wide`, `three@selected`, `three@large`,
`demo@small`, `look`, `demo@motion`, `crew`, `crew@reduced` and two theme captures. A channel
tolerance of 8 against a 0.01 % budget, and every run reports "px moved at all" beside the verdict,
so a package can claim 0 px and mean it. Reduced motion is emulated per capture rather than per run
since §172, and `?phase=` pins an animation without disabling it.

**Linux holds six of those sixteen.** `crew`, `crew@reduced`, `demo@motion`, `demo@small`, `look`,
`pinned`, `three`, `three@large`, `three@selected` and `wide` have no Linux golden. Because
`test/goldens/linux/` *exists*, `scripts/goldens.mjs:733` treats each missing capture as "a hole in
an existing set" and returns `ok: false` — ten failures, `process.exit(1)`. **The `goldens` job in
CI has therefore been red on every push to `main` since the set went from empty to partial**, for a
reason that has nothing to do with any pixel. §87's own argument against failing on a missing
browser — "a red build on a missing browser teaches people to ignore the gate" — applies here
exactly, and the log already knows: §178's last line says the Linux set still owes the rebakes.

**Isolation.** `scripts/test.mjs` plants a canary home — an empty temp directory holding one
transcript titled `DECKHQ-CANARY-HOME-DO-NOT-READ` — and preloads `test/helpers/canary.cjs` into
every process, so any read outside the temp roots fails naming the function, the path and the frame.
`test/integration/isolation-guard.test.mjs` asserts the sentinel reaches no floor, snapshot or
status line. This is the strongest single piece of test infrastructure in the repository
(§121.4, §124).

**Flakiness history, from the log.** §51/§80 (a debounce measured on an injected clock rather than a
widened window), §121 (Node 18's `close()` waiting on its own keep-alive sockets), §126 (a fake CLI
that exited out from under its own pipe; a gate that deadlocked on its own screenshot), §130 (four
tests computing a repo root with an API Node 18 does not have), §132 (three timing tests measuring
the machine). Every one was closed by removing the dependency on real time or a real machine rather
than by widening a tolerance. There is no open flake.

---

## 6. Extension points

| To add … | Files to touch today | What it should be |
|---|---:|---|
| **A runtime** | **2** outside its own directory: `adapters/index.mjs` (one line) and `model.mjs`'s `RuntimeId` union | 2. This is right, and verified: `opencode` appears outside `src/adapters/` in exactly two places, both in `model.mjs`. `ADAPTERS.md` §8 is an honest checklist. |
| **A surface** (CLI verb, route, panel tab) | 2–4: the module, its registration, a test, sometimes `bin/deckhq.mjs` | 2–4. The `Router` and the `register(router, ctx)` convention are as thin as they can be. |
| **A Look option** | 2: `render/look-options.js` (the table) and `look-derive.js`/`look-materials.js` if it paints something new. `LOOK_OPTION_COUNT` is computed from the tables; `src/core/look.mjs` re-exports; the sanitiser and the schema follow | 2. Already excellent. The option tables *are* the allowlist. |
| **An activity state** | **47 files name `for_review`** | Far fewer. There is no single enumeration of the six states with their colour, clip, icon, placement, label, sound and sort rank; there are seven parallel tables in seven modules, each correct, each independently editable. |
| **A Studio step** | 4–6: `schema.mjs`, `store.mjs`, `brief.mjs`, `routes/studio.mjs`, `panel-studio.js` | 4–6. Reasonable for an eleven-step loop. |
| **A dimension constant** | 1, plus a decision: `plan-scale.js`'s table refuses a constant that is in neither list | 1. The best extension point in the codebase. |

The adapter contract and the Look catalogue are genuinely, measurably extensible. The state model is
the opposite, and it is the one thing in the product that will never change, which is why it has
been survivable.

---

## 7. Findings, ranked

Defects first. Every entry names what it must not change.

### A-01 · The Linux goldens gate has been failing for a reason that is not a pixel · **defect** · S

> **RESOLVED** by WP-92a, commit `049f7b1` (`docs/DEVIATIONS.md` §180.1). A missing golden is a
> third outcome — NOT YET BAKED, named, exit 0 — and `--strict` exits 2 when a platform's set is
> meant to be complete. The verdict moved to `scripts/lib/goldens-gate.mjs` so a test can reach it.
> The ten Linux goldens are still owed; baking them and turning `--strict` on is its own package.

**Evidence.** `test/goldens/linux/` holds 6 PNGs; `CAPTURES` in `scripts/goldens.mjs` defines 16.
`scripts/goldens.mjs:733-745` returns `ok: false` for a missing golden whenever the platform
directory exists, and `failures.length` exits 1. The CI `goldens` job runs `npm run goldens:check`
on `ubuntu-latest` on every push to `main` and every pull request. `docs/DEVIATIONS.md` §178's last
line records the debt and nothing tracks it.
**Move.** Give `check()` a third outcome between "skip the whole platform" and "fail": a capture
with no golden on this platform is reported as **not yet baked**, named in the summary, and exits
non-zero only when a `--strict` flag (or the presence of every name in a committed per-platform
manifest) says the set is meant to be complete. The captures are already uploaded as artifacts, so
baking the missing ten stays one download away.
**Blast radius.** `scripts/goldens.mjs` only. No product code, no golden.
**Proof.** `npm run goldens:check` on win32 still prints `all 16 match`; the same command over a
directory with a deliberately removed golden prints `NOT YET BAKED` and exits 0; with `--strict` it
exits 1. Then bake and commit the ten Linux goldens in a separate package and turn strict on.
**Must not change.** A golden that exists and differs stays red. A size mismatch stays red.

### A-02 · The 900-line cap is enforced only over files that have already been split · **defect** · S

> **RESOLVED** by WP-92b, commit `eabedb2` (`docs/DEVIATIONS.md` §180.2). `test/unit/line-ceiling.test.mjs`
> walks every non-test file under `src/`, `public/`, `scripts/` and `site/` against a dated exemption
> table; an exemption whose file has dropped under the cap fails. Three of the eight are booked to
> WP-92l, 92m and 92n; the other five are marked permanent with a reason each.

**Evidence.** `test/unit/model.test.mjs:300-346` enumerates eighteen prefix groups, 129 files. Eight
non-test files exceed 900 lines and none is in a group (§1.4's table). No exemption table exists.
**Move.** Replace the group list with a walk of `src/**` and `public/**`, plus an explicit
`EXEMPT` map of `path → {lines, reason, dated}` that the test also asserts is not stale (an exempt
file that has since dropped under the cap fails, so the table cannot rot). Keep the per-group
module-count assertions: they check that a split *happened*, which the walk cannot.
**Blast radius.** One test file. Making it pass needs the eight either split or exempted, which is
A-12 and the WP-92 tail.
**Proof.** The new test fails on `themes.js` before the exemption is written and passes after; it
fails when an exempt file is shrunk below the cap; `npm test` otherwise unchanged at 2,437.
**Must not change.** The ceiling is 900. It does not move.

### A-03 · The draw-path clock guard names six of fifty-eight render modules · **risk** · S

> **RESOLVED** by WP-92c, commit `3e9e866` (`docs/DEVIATIONS.md` §180.3). The guard walks every
> module under `public/render/` plus any `life`/`scene`/`rig`/`crew` module beside it, with the body
> of `frameMs()` cut out by shape as the one exception. Proved failing against a temp copy.

**Evidence.** `test/unit/character-life.test.mjs:188-196`. `rig.js` is a 448-line re-export shell
since §131; the bodies live in `rig-pose.js`, `rig-metrics.js`, `rig-bubble.js` and `rig-traits.js`,
of which none is checked. `crew.js`, `crew-draw.js`, `agents-core.js`, `agents-activity.js`,
`agents-seats.js`, `scene-draw.js` and the four `backdrop-*` modules are not checked.
**Verified not breached:** every `public/render/*.js` was scanned for this audit and the only hit is
`scene-agent.js:47`, which is `frameMs()`'s documented fallback.
**Move.** Walk `public/render/*.js`, allow `performance.now()` only inside `frameMs`, and allow
`Date.now()` only as `frameMs`'s fallback — one named exception instead of one named file list.
**Blast radius.** One test. Size S. **Proof.** The new test passes on `main`; it fails when
`Date.now()` is temporarily inserted into `rig-pose.js`. **Must not change.** `animMs()` stays the
injected clock; `?phase=` keeps working; `demo@motion` and `crew` stay 0 px.

### A-04 · A second, private, untested copy of the state palette · **risk** · S

> **RESOLVED** by WP-92d, commit `378e077` (`docs/DEVIATIONS.md` §181.1). The literal lives once, in
> a new pure `public/state-palette.js`, and `app.js` and `panel-header.js` both import it.
> `state-visuals.test.mjs` asserts exactly one such literal exists under `public/` and that it equals
> `STATE_COLORS` key for key. Not as written here: the panel does **not** import from `app-state.js`,
> and `app-state.js` is DOM refs and a `createSounds()` at module scope, so the fallback went into a
> module with no imports and no side effects instead. The private copy also had six rows, not seven
> — no `ended` — so the fallback for that one state moved from `#888888` to the spec's `#6E6A63`.

**Evidence.** `public/panel-header.js:30` declares `FALLBACK_STATE_COLORS` privately, duplicating
`public/app-state.js:45`, which duplicates `public/render/palette-colors.js:74`, which
`style.css:72` restates and `state-visuals.test.mjs` holds. Nothing names the panel's copy.
**Move.** `panel-header.js` imports the fallback from `app-state.js` (which it already imports from),
deleting seven lines. Optionally extend `state-visuals.test.mjs` to assert that exactly one
`FALLBACK_STATE_COLORS` literal exists in `public/`.
**Blast radius.** One import. **Proof.** `panel-invariant.test.mjs` and `state-visuals.test.mjs`
unchanged and green; goldens untouched (the panel is not in a golden — which is why this is a risk
rather than a defect). **Must not change.** The fallback path must still work with
`render/palette.js` absent.

### A-05 · The registry does two full passes over the model per change, one of them for nobody · **debt** · M

> **RESOLVED** by WP-92h, commit `8ea13eb` (`docs/DEVIATIONS.md` §182.1). Both halves landed: the
> guard, and — measured first, as this finding required — the change key, at **0.199 ms → 0.034 ms
> per change on the `demo` floor, 5.8×**. The array-join form this finding implied was measured at
> 1.40× and was not taken; string concatenation was. `state-machine-key.test.mjs` walks a real
> agent and fails naming any `Agent` field the key does not read, which is the one way a named-field
> key can be wrong.
>
> **One claim here is not true of the daemon as wired.** "Zero subscribers is the normal steady
> state" is false while `notify-watch.mjs` and `actions.mjs`'s pending-identity settler both
> subscribe at startup and never leave, so `_subscribers.size` is never zero in a running daemon.
> The guard is live for embedders, the CLI's one-shot reads and the suite, and inert for the product
> until those two move off the snapshot channel — the settler ignores its argument entirely, and the
> notifier needs three fields plus a label only when it fires. That is a package of its own.

**Evidence.** `state-machine-compute.mjs:116` — `const key = JSON.stringify(agents)` on every
`_rebuild()`. `state-machine-snapshot.mjs:452` — `_emitIfChanged()` calls `this.snapshot()` before
checking whether `_subscribers` is non-empty, and `snapshot()` runs `identity.describe` per agent,
a second pass for juniors, `orderRooms`, `projectsOf`, `counts` and `crewsFrom`. The daemon is
designed to outlive the tab, so zero subscribers is the normal steady state.
**Move.** Two independent one-line changes: `if (!this._subscribers.size) return;` after the
`_changed` reset in `_emitIfChanged`, and a cheap structural key (a joined digest of the fields that
actually decide "changed") in place of the full stringify. Take the first alone in WP-92; the second
needs a measurement first.
**Blast radius.** `_emitIfChanged` is called from twelve places. The guard changes nothing
observable because a snapshot handed to nobody is discarded — but it must still reset `_changed`,
or the next real subscriber would miss the edge.
**Proof.** `/api/state` byte-identical over the `demo`, `three` and `crew` fixtures; every
`INVARIANT:` test green; `daemon.test.mjs` and `snapshot-route.test.mjs` green; a new test asserting
a subscriber added after a silent change still receives the next snapshot.
**Must not change.** `_changed` semantics. `emitNow()`. The SSE first-push on connect.

### A-06 · `HookEvent` and `RuntimeAdapter` are defined six times each · **debt** · S

> **RESOLVED** by WP-92e, commit `1f29b16` (`docs/DEVIATIONS.md` §181.2). Both are declared once in
> `state-machine-rules.mjs`; the other five write `import('./state-machine-rules.mjs').HookEvent`.
> 125 lines removed, 26 added, and the "no executable line" claim is asserted by a filter over
> `git diff -U0` rather than by reading it. Zero `@ts-ignore` stays zero.

**Evidence.** Identical `@typedef` blocks in all six `src/core/state-machine-*.mjs`. `tsc` checks
each against itself, so drift is invisible.
**Move.** Declare both once — `state-machine-rules.mjs` is the pure, dependency-free end of the
chain — and let the other five write `import('./state-machine-rules.mjs').HookEvent`, which is the
device §131 already used for `doctor-report.mjs`.
**Blast radius.** Comments only; no runtime code. **Proof.** `npm run typecheck` green on both
projects; `npm test` unchanged; `git diff` touches no executable line.
**Must not change.** Zero `@ts-ignore` stays zero.

### A-07 · Three import cycles · **debt** · S

> **PARTLY RESOLVED** by WP-92i, commit `a55fcf5` (`docs/DEVIATIONS.md` §182.2). The CLI cycle is
> closed: `src/cli/offers.mjs` holds what `app`, `pin` and `shortcut` share and imports none of
> them. **`BIN` moved with the offer text** — this finding names only the offers, and `BIN` was the
> one STATIC edge of the three, so lifting the text alone would have left the cycle exactly where it
> was. `cli-graph.test.mjs` asserts the graph and proves its own detector. The `deck ↔ usage` pair
> is WP-92m's; the settings pair stays, as this finding says.

**Evidence.** §1.2. `src/cli/app.mjs ↔ pin.mjs ↔ shortcut.mjs`; `public/deck.js ↔ usage.js`;
`public/settings-ui.js ↔ settings-ui-rates.js` (documented).
**Move.** For the CLI, lift the three cross-offers into one `src/cli/offers.mjs` that all three
import. For `deck ↔ usage`, apply §122 rule 3 — `usage.js` receives what it needs through a `wire()`
rather than importing the deck. Leave the settings pair; it is the documented shape-3 pattern.
**Blast radius.** CLI command wiring; the deck's usage row. **Proof.** `deck.test.mjs`,
`deck-view.test.mjs`, `deck-keys.test.mjs`, `usage.test.mjs`, `pin-offer.test.mjs`,
`install-scripts.test.mjs` green; a new assertion that the graph has no cycle in `src/cli/`.
**Must not change.** Every offer the CLI makes today, in the same words.

### A-08 · `'claude-code'` is the implicit default runtime in five route handlers · **risk** · M

> **RESOLVED** by WP-92j, commit `f9a8295` (`docs/DEVIATIONS.md` §182.3). Four of the five refuse
> with `400 { error, field: 'runtime' }` through one shared `runtime-required.mjs`;
> `/api/resume-targets` also accepts `?runtime=`. The fifth, `POST /api/permission`, stays a choice
> and is documented as one at its site: Claude Code posts its own payload to a URL the Claude Code
> adapter wrote, that payload names no runtime, and a 400 from that handler would read as a
> decision rather than as a refusal.
>
> **This finding's blast-radius claim was wrong.** "The panel always sends one, and the audit found
> no caller that does not" — three of the four callers in `public/` did not: `app-dialogs.js` on
> both `/api/new-project` and `/api/agent`, and `panel-permission.js` on every permission answer.
> Landing the refusal alone would have broken two dialogs and every permission answer on every
> machine. All three send one now, and `runtime-required.test.mjs` greps `public/` so the next
> caller cannot be added without one.

**Evidence.** `routes/permission.mjs:100,159`; `routes/actions.mjs:297,408,639`
(`String(body.runtime || 'claude-code')`). `routes/studio.mjs:89` `PLANNER_RUNTIME = 'claude-code'`.
A request that omits `runtime` is silently answered as Claude Code.
**Move.** Where an agent id is in hand, derive the runtime from it (`splitAgentId`) and refuse the
request when there is neither. Studio's planner runtime is a deliberate choice and should stay, with
its constant given a sentence saying it is a choice rather than a default.
**Blast radius.** Five handlers. Any client that relies on the default breaks — the panel always
sends one, and the audit found no caller that does not.
**Proof.** `permission-route.test.mjs`, `send-route.test.mjs`, `hook-route.test.mjs`,
`actions.test.mjs` green plus new cases for the refusal; `studio-route.test.mjs` unchanged.
**Must not change.** `POST /api/hook`'s own runtime resolution, which already comes from the URL.

### A-09 · `src/http/routes/settings.mjs` reaches into the Claude Code adapter for a runtime-neutral list · **style** · S

> **RESOLVED** by WP-92f, commit `459b1b8` (`docs/DEVIATIONS.md` §181.3). The route imports from
> `src/core/terminals.mjs`. The adapter-side re-export was **not** deleted: `src/cli/doctor-collect.mjs`
> still points at it, and repointing that too was outside this package's stated proof. Its header
> now names the one caller it has left.

**Evidence.** `settings.mjs:20` imports `terminalIds` from `../../adapters/claude-code/terminals.mjs`,
which §95 left as a re-export of `src/core/terminals.mjs`. The terminal catalogue is not
Claude-Code-specific.
**Move.** Import from `src/core/terminals.mjs`. Consider deleting the adapter-side re-export once
nothing points at it. **Blast radius.** One line. **Proof.** `settings-keys.test.mjs` and
`terminals.test.mjs` green. **Must not change.** The terminal id list, in order.

### A-10 · The demo snapshot is not the real snapshot's shape · **risk** · S

> **RESOLVED** by WP-92g, commit `a0cc9f7` (`docs/DEVIATIONS.md` §181.4). `buildDemoSnapshot` carries
> both fields, `crews` derived by the same `crewsFrom` the daemon uses, and `Scene.setState` falls
> back on absence alone — so an ordinary floor, which publishes `crews: []`, no longer re-derives the
> rule in the browser on every snapshot. One correction to the move as written:
> `rateCardVersion` is **passed in** by the registry rather than read in the fixture, because
> `loadRateCard()` stats a file under the user's home and the fixture promises a pure function of
> `now` — reading it there tripped the §124 isolation canary on the first run.
> `test/unit/snapshot-shape.test.mjs` compares the key sets against a **real** `Registry.snapshot()`
> rather than a list. All sixteen goldens 0 px, `empty` included.

**Evidence.** `demo-fixture.mjs`'s return carries no `crews` and no `rateCardVersion`;
`_realSnapshot` carries both. `Scene.setState` recomputes crews when the field is absent *or empty*,
so an ordinary floor derives crews twice on every snapshot.
**Move.** Add both fields to `buildDemoSnapshot`, and make the client's fallback trigger on absence
only (`Array.isArray(crews)` rather than `crews.length`). Add a test asserting the two snapshot
shapes have the same key set.
**Blast radius.** The actor floor and one client branch. **Proof.** `demo-fixture.test.mjs`,
`snapshot.test.mjs`, `crew.test.mjs` green; the `empty` golden stays 0 px (it is the actor floor).
**Must not change.** `demo: true`, `demoNote`, and the rule that an actor is not addressable.

### A-11 · `src/core/mcp-tool-name.mjs` has no consumer · **debt** · S

> **RESOLVED** by WP-92f, commit `459b1b8` (`docs/DEVIATIONS.md` §181.3). Deleted; the test points at
> `public/mcp-tool-name.js`. `typecheck` green on both projects, the module having left the Node
> project's reachable set. The parsing rule did not move.

**Evidence.** Zero importers in `src/`, `public/` or `scripts/`; only `test/unit/mcp-tool-name.test.mjs`.
**Move.** Delete it and point the test at `public/mcp-tool-name.js`, or find the Node-side caller
WP-64 intended and wire it. Deleting is the honest default.
**Blast radius.** One file, one test import. **Proof.** `npm test` at 2,437; `npm run typecheck`
green (the module is in the Node project's reachable set today and stops being so).
**Must not change.** The parsing rule itself, which stays in `public/`.

### A-12 · Two files over the cap are two things wearing one name · **debt** · M each

**Evidence.** `src/core/store.mjs` (1,230) is atomic persistence *and* a twenty-function settings
sanitiser *and* the settings schema. `public/deck.js` (1,113) is a table renderer *and* a keyboard
map *and* the usage row, and is half of cycle 3. `public/render/themes.js` (1,430) is three theme
tables *and* the derivation *and* `assertThemeContrast`.
**Move.** §131's shape 1 in all three: whole declarations move, doc comments with them, the only
edit inside one is `export` on its first line. `store-settings.mjs`, `deck-usage.js` /
`deck-keys.js`, `themes-tables.js` / `themes-derive.js`.
**Blast radius.** Large import surface, zero behaviour. **Proof.** §131's three checks, rerun: every
top-level declaration appears character for character in exactly one new module; every distinct
source line still exists the same number of times; goldens 0 px after every commit; `/api/state`
byte-identical on the `demo`, `three` and `crew` fixtures.
**Must not change.** Anything. Not one bug fixed in passing, not one dead branch deleted.

### A-13 · Seven client modules are neither executed nor read by any test · **risk** · M

> **FIRST HALF RESOLVED** by WP-92k, commit `8576ea8` (`docs/DEVIATIONS.md` §182.4).
> `test/unit/client-shell-gates.test.mjs`, and it does more than this finding asked: all seven are
> also **imported**, under a DOM stub whose `getElementById` mints a node per id — which is the one
> thing that makes the shell loadable outside a browser, and which this finding assumed would need
> the second package's builder refactor first. Three static rules, not one: §143's shape, every
> `fetch` a literal same-origin path, and no `Date.now()`/`Math.random()`/`performance.now()`. The
> gate is proved by planting §143's line into a temp copy. No source file changed.
>
> **The second half stands**: nothing here drives these modules, so what they DO under a browser is
> still unmeasured. The seven are a list rather than a walk so that debt cannot go quiet.

**Evidence.** §5. `app-dialogs.js`, `app-cards.js`, `app-launchers.js`, `app-look.js`,
`app-snapshot.js`, `app-floor.js`, `look-ui-pictures.js` — about 1,700 lines. §143's tab-closing
bug lived in this region and nothing in the toolchain could see it.
**Move.** Not a rewrite. Extend `panel-invariant.test.mjs`'s technique: one static gate per module
asserting the handful of properties that matter (no bare global call that is also a `window` method;
every `fetch` is to a path this daemon serves; every listener registered here is torn down). Then
a second package for the modules that *can* be imported headlessly once their DOM reads move into a
builder, as §131 did for the panel.
**Blast radius.** Tests only in the first half. **Proof.** The new gate fails when
`closeBtn.addEventListener('click', () => close())` is reintroduced into `panel-dom.js`.
**Must not change.** No client behaviour, in either half.

### A-14 · Nothing aggregates what the daemon swallows · **debt** · M

**Evidence.** §4. Ledger writes, dashboard probes, daemon-file writes, SSE writes, scans and
`available()` all swallow. `writeError` is the only failure with a surface.
**Move.** One counter per swallow site, summed into `snapshot().health = {scanErrors, ledgerErrors,
lastErrorAt}` and read by `deckhq doctor`. No new logging, no new file, no egress.
**Blast radius.** The snapshot gains one optional object. **Proof.** `/api/state` byte-identical on
a clean fixture (the field is omitted when every counter is zero); `doctor.test.mjs` extended.
**Must not change.** No error may become fatal. `writeError` keeps its own field and its own banner.

---

## 8. Owner questions

1. **Does the Linux goldens gate get baked or get honest first?** *Default: honest first.* Land
   A-01 so the job stops being red for a non-pixel reason, then bake the ten Linux goldens as its own
   package. Baking first leaves the underlying rule — a partial set is ten hard failures — in place
   for the next capture anybody adds.
2. **Do the eight over-cap files get split, or an exemption table?** *Default: a table first, then
   split three.* Write the exemption table in A-02 with a dated reason per file, then split
   `store.mjs`, `deck.js` and `themes.js` (A-12) and take them off it. `parse.mjs` stays exempt
   permanently — `02-ARCHITECTURE.md` §2.1 requires one parsing file per adapter, and that outranks
   the ceiling. `site/build.mjs`, `goldens.mjs` and `clips.js` stay exempt as single coherent things.
3. **Is `snapshot()` allowed to be skipped when nobody is listening?** *Default: yes.* A-05's guard
   changes no observable behaviour, and the daemon-with-no-tab is the product's normal state. If the
   answer is no, say so and the finding becomes documentation instead.
4. **Should a route with no `runtime` be refused rather than assumed?** *Default: yes.* A-08. The
   risk is a caller this audit did not find; the mitigation is that every refusal returns a 400 with
   the field name, so it is one line to diagnose.
5. **Does the client shell get static gates now, or wait for a package that can import it?**
   *Default: static gates now.* A-13's first half is cheap, catches §143's shape, and does not block
   the larger move.
6. **Is a `health` block on the snapshot in scope for the free core?** *Default: yes.* It is local,
   it is three integers, it has no egress, and "the daemon has been failing quietly for an hour"
   is exactly the failure P-15 (capture beats features) cares about.

---

## 9. The WP-92 sequence

Ordered. Each row is one package, independently revertible, with its own proof. Nothing after
WP-92c changes behaviour at all.

| # | Package | From | Proof |
|---|---|---|---|
| WP-92a | The goldens gate stops being red for a reason that is not a pixel | A-01 | `goldens:check` on win32 prints `all 16 match`; with a golden removed it prints `NOT YET BAKED` and exits 0; `--strict` exits 1 |
| WP-92b | The 900-line ceiling is checked over every file, with a dated exemption table | A-02 | The test fails on `themes.js` before the table and passes after; fails when an exempt file drops under the cap; suite at 2,437 |
| WP-92c | The draw-path clock guard walks `public/render/` instead of naming six files | A-03 | Green on `main`; fails on a `Date.now()` planted in `rig-pose.js`; `demo@motion` and `crew` 0 px |
| WP-92d | One state palette in the client | A-04 | `state-visuals.test.mjs` extended; `panel-invariant.test.mjs` green; no golden moves |
| WP-92e | Two `@typedef` blocks instead of twelve | A-06 | `npm run typecheck` green on both projects; no executable line in the diff |
| WP-92f | `settings.mjs` reads the terminal catalogue from `core/`, and the orphan shim goes | A-09, A-11 | `settings-keys.test.mjs`, `terminals.test.mjs`, `mcp-tool-name.test.mjs` green |
| WP-92g | The demo snapshot is the real snapshot's shape | A-10 | New key-set test; `empty` golden 0 px; crews derived once |
| WP-92h | A snapshot is not built for nobody | A-05 | `/api/state` byte-identical on three fixtures; new late-subscriber test; every `INVARIANT:` green |
| WP-92i | The CLI's three offers stop importing each other | A-07 | Cycle assertion over `src/cli/`; every offer unchanged in wording |
| WP-92j | A route with no runtime is refused | A-08 | Four route tests extended with the refusal case |
| WP-92k | Static gates over the seven unguarded client modules | A-13 | The gate fails when §143's line is reintroduced |
| WP-92l | `store.mjs` → `store.mjs` + `store-settings.mjs` | A-12 | §131's three checks; `/api/state` byte-identical; goldens 0 px |
| WP-92m | `deck.js` → `deck.js` + `deck-usage.js`, cycle 3 closed | A-12, A-07 | §131's three checks; `deck*.test.mjs` green; cycle assertion |
| WP-92n | `themes.js` → tables + derivation | A-12 | §131's three checks; `interior.test.mjs`, `look-guards.test.mjs` green; all 16 goldens 0 px |
| WP-92o | `snapshot().health`, and `doctor` reads it | A-14 | `/api/state` byte-identical when every counter is zero |

**Explicitly out of scope.** No framework. No build step, no bundler, no transpiler — the product
ships the files it runs. No runtime dependency (P-05). No rewrite of the render pipeline: `plan.js`,
`scene.js`, `rig.js`, `backdrop.js` and `agents.js` keep their shapes and their seams, and WP-92n
moves tables out of one file without touching a single derivation. No change to the six-state model,
to `placement()`, to the snapshot's existing keys, or to any `INVARIANT:` test. No behaviour change
that is not named in §7 with an owner question in §8 behind it.

**What this audit did not do.** Nothing was profiled. A-05's claim is a claim about work done, not a
measured millisecond, and the WP-92h package must measure before it optimises anything beyond the
subscriber guard. Nothing was run against a machine with a hundred agents; §162.10's and §178's
admissions stand. The site, the VS Code extension and the plugin were mapped but not audited in
depth. And the seven unguarded client modules were read, not exercised — A-13 is the finding that
nobody can currently say what they do under a browser.

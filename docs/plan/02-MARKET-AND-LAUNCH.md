# 02 — Market, positioning and launch

**Owner:** Product Manager (with orchestrator sign-off on positioning) · **Depends on:** P0 complete
**Evidence:** competitive research, 2 Sep 2026, re-checked 3 Sep. Star counts as of 3 Sep.

> **Updated 3 September for plan v2.** The launch sequence (§4) is superseded by
> [`08`](08-PLAN-V2-100X.md) §4.3, which leads with `npx deckhq doctor` rather than the GIF.
> Four market facts changed; they are recorded in `08` §3.0 and reflected in §1 below.

---

## 1. The field, honestly

### 1.1 Orchestrators — they spawn the agents

| Tool | Stars | License | Model | Fatal flaw |
|---|---|---|---|---|
| vibe-kanban (Bloop) | 28.0k | Apache-2.0 | Cloud $30/seat, launched 3 Feb 2026 | **Shut down 10 Apr 2026.** 30k MAU, no business model |
| cmux (Manaflow, YC) | 26.6k | GPL-3.0 + commercial | Commercial licensing | macOS only; recurring lag complaints |
| Superset | 13.5k | Elastic 2.0 | Desktop free, cloud paid | No Windows, Linux experimental |
| Paseo | 15.8k | Apache-2.0 | None | Phone-first pitch draws hostility |
| Conductor | closed | closed | $50 Pro / $60 seat, $22M Series A | Mac only, closed, privacy pushback |
| Emdash (YC W26) | 5.5k | Apache-2.0 | — | No coordination between agents |
| Claude Squad | 8.4k | AGPL-3.0 | None | tmux dependency, no native Windows |
| Terragon | 259 | Apache snapshot | Cloud compute | **Shut down 9 Feb 2026** |
| **Munder Difflin** (added 3 Sep) | **6.2k** in 3 months | MIT + LimeZu assets | PRO $20/mo, Teams $39/seat | Electron orchestrator with a pixel *Office* floor. Spawns its own agents, cannot see any other; "blocked" is runtime-derived; one fixed 16-seat map; opt-out telemetry; GOD-agent token burn is the top complaint. HN 311 pts. See `08` §3.5. |

### 1.2 Visualisers — they make agents pretty

| Tool | Stars | Reach | Verdict |
|---|---|---|---|
| Pixel Agents | 9.2k | **~82k VS Code installs** | The breakout. Pure X virality. No actions. **Added Codex and Hermes providers 10 Aug 2026** — multi-runtime is no longer ours alone. |
| Happy | 23.6k | MIT, free | End-to-end encrypted phone client for Claude Code and Codex. Phone approval, free. |
| Paseo | 15.9k | Apache-2.0 | Phone pairing built in; Claude Code, Codex, Copilot, OpenCode, Pi. |
| Claw3D | 2.2k | — | Wrong runtime (OpenClaw). Hosted tier never shipped. |
| claude-office | 507 | — | Hooks-driven pixel office |
| agent-office / agent-virtual-office | 15 / 13 | — | The 13-star one has the feature the 9,000-star one lacks: **one-click shareable postcard** |

### 1.3 First-party, and exactly where it stops

| Ship date | What | Where it stops |
|---|---|---|
| 2 Feb 2026 | Codex app (1M Mac installs week one) | Per-project threads; merged into ChatGPT July to complaints |
| 25 Feb 2026 | Claude Code Remote Control | Phone as a viewport on **one local session** |
| 2 Apr 2026 | Cursor 3 Agents Window | 8 parallel agents, Cursor only |
| 14 Apr 2026 | Claude Code Desktop redesign | Sidebar shows **only sessions the app launched** |
| 11 May 2026 | `claude agents` agent view | Groups: Pinned, Ready for review, Needs input, Working, **Completed** (finished, failed and stopped sessions). Covers background sessions and sessions with PRs, not transcripts on disk. On the reference machine on 3 Sep it listed 7 of 69. **Measured, not quoted** — see `01-AUDIT.md` §6 C1 for the retracted version of this row. |
| May 2026 | `/usage` | Per-session and per-plan. **No cross-repo spend view exists.** |
| Jul 2026 | Remote Control (`/rc`, `--bg`) | Mirrors one local session to claude.ai and the mobile app; approve tool calls from the phone. **Free on all plans.** |
| 26 Aug 2026 | Codex `PermissionRequest` hook (0.150.0) | Allow or deny a tool call from a hook; silence falls through to the prompt. Same shape as Claude Code's. |

Anthropic closed the "tell me which session is blocked" request (#36885) as **not planned** on
26 May 2026.

### 1.4 The four gaps nobody occupies

> **Gap 1 corrected 2 Sep 2026, after measuring it.** It previously read "terminal-launched
> sessions are invisible to every first-party surface". `claude agents --json` on the reference
> machine returns every live interactive session, including ones started in other terminals in
> other repositories. Restated below to what measurement supports.

1. **Sessions that have already exited.** Every first-party surface and every orchestrator
   reports what is *running*. A session that finished its turn and exited leaves the list, taking
   with it any record that it wanted something. DeckHQ reads the disk, so it still has all of
   them — and it still knows which are owed an answer.
2. **An acknowledgement that survives reading.** Every queue in the category is derived from
   runtime state.
3. **Cross-repo cost.** ccusage earned 18.3k stars filling half of this; nothing shows spend
   per project on one screen.
4. **Windows, and cross-runtime.** The entire premium tier of this market is Mac-only.

## 2. Positioning

**Category:** not "agent orchestrator" (crowded, one leader already dead) and not "agent
visualiser" (commodity, twelve repos). The category is **the attention layer** — and we should
name it, because naming a category is free positioning.

**Headline:** *Every AI coding session on your machine, on one office floor.*
**Sub:** *Including the ones your terminal forgot. It remembers what's waiting on you even after
you've read it.*

**Against the first party:** "Claude Code's agent view shows the sessions it started. DeckHQ
shows all 51."
**Against orchestrators:** "You don't have to start your agents in DeckHQ. Start them anywhere.
They'll turn up."
**Against visualisers:** "You can close the tab. It will come and get you."
**Against everyone:** "No account, no telemetry, no network calls at all. Read the source in an
afternoon — there are no dependencies to read."

**What we never say:** that we orchestrate, that we make agents faster, that we are a terminal
replacement. We are the layer above whatever they already use, and that's why we're additive
rather than a migration.

## 3. The launch assets

Ranked by expected return. The Product Manager owns these; none of them ships before P0.

### A0 — `npx deckhq doctor --share` (highest value, added 3 Sep)

A one-line command that prints a personal, true, slightly alarming fact about the reader's own
machine, as text. It works where images do not — Hacker News, Reddit, Discord, Slack — and it is
the mechanic ccusage used to reach 18k stars. The launch headline is *"Run `npx deckhq doctor`.
Post your fourth line."* The floor is what they see when they run the command without `doctor`.
Wording is governed by the honesty tests in `docs/DEVIATIONS.md` §74. WP-44.

### A1 — The capture-proof screenshot

A single image, split down the middle. Left: `claude agents`, **5 running right now**. Right:
DeckHQ, **66 on the floor**. Caption: *"Same machine. Same moment."*

**The headline underneath is the debt, never the arithmetic:**

> 7 finished sessions are still waiting on you. The agent view lists none of them.

That distinction is not pedantry, it is the difference between an asset and a liability. The
raw 66 − 5 gap is mostly sessions that finished weeks ago; presenting it as *concealed work* is
an overclaim any reader disproves by running one command, and this project's entire credibility
rests on an honest-limits discipline. The debt number is unarguable, it is the actual product,
and it is the thing no competitor has.

Never write that the runtime *cannot see* those sessions. Write that it **no longer lists them**,
or that it **forgets them when the process exits**. Both are true and both are enough.

**Build the tooling for it in P0** (`deckhq doctor --capture-proof`, WP-05) so any user can
generate their own — a user-generated version of this image is worth ten of ours.

### A2 — The hero GIF, 6 seconds, above the fold in the README

Loop: an agent at a desk types → stands → walks down the corridor → through your office door →
stands in the waiting area → a crimson badge appears and starts counting. No text, no cursor,
no UI chrome.

That is the entire product in six seconds and it is the only asset that explains the metaphor
without words. Generate it from `scripts/demo-floor.mjs` so it is reproducible and contains no
real project names.

### A3 — The office snapshot (user-generated, the compounding one)

One key on the floor composites: the floor + a stat strip (hostname, N working, N hands up, N
benched, today's estimated spend) into a PNG on the clipboard.

Evidence this matters: every viral post in this category was a *screenshot someone had to crop
themselves*. The only repo that ships one-click sharing has 13 stars and the idea; the repo with
9,000 stars does not have the feature. We should ship it and make it beautiful. This is
[`04-ENGAGEMENT-AND-GAMIFICATION.md`](04-ENGAGEMENT-AND-GAMIFICATION.md) §3.2 and WP-14.

### A4 — Social preview card

Repo currently renders as a grey box everywhere it is linked. Set the social preview to a crop
of the floor with the tagline burned in. One afternoon; affects every share forever.

### A5 — The deviations log as a content series

`docs/DEVIATIONS.md` contains 65 numbered, measured engineering wrong turns — the rig drawn a
quarter-turn out of true and proved wrong geometrically; the sofa that rendered through a wall
and survived five review passes; the packer that grew the building 2.3× per iteration. This is a
year of build-in-public writing that already exists. Post one a week.

## 4. The launch sequence

> **Superseded 3 September by [`08`](08-PLAN-V2-100X.md) §4.3**, which adds a Wave 3 "inside the
> runtime" (Claude Code plugin, status line, VS Code) and leads Wave 1 with the doctor output.
> The reasoning below still holds and is kept for the evidence.

**Do not do a single big-bang launch.** Every tool in §1.1 that spiked and died did one launch
into one channel. Sequence instead, and let each wave feed the next.

### Wave 0 — Quiet (end of P0)

Publish to npm. Cut `v1.2.0` with a real GitHub Release. Set the social card. Land the README
rewrite (GIF first, prose later). Tell nobody. Fix what the first ten strangers hit.

Seed those ten strangers by hand: reply to the open Hacker News threads where people are
describing this exact problem in their own words (Ask HN "Claude multisession", 3 Aug 2026;
the Superset and Omnara threads). Reply with help, not a link — and mention the tool once, at
the end, if it actually answers them.

### Wave 1 — X, with the GIF (start of P2)

The channel that actually converts in this category. Pixel Agents reached 9k stars and 83k
installs from X while its Hacker News post scored **1 point**. Omnara scored **310 points on HN**
and has 2.8k stars. Draw the obvious conclusion.

Thread structure:
1. The A1 capture-proof image. *"Claude Code says I have 3 agents. I have 51."*
2. The A2 GIF. *"When one finishes, it walks into your office and waits. Reading the message
   doesn't clear it. Only you do."*
3. The problem stated in the reader's words: the 23-minute refocus cost, the ten terminals.
4. `npx deckhq`. Local, MIT, no account, no telemetry, Windows/macOS/Linux.

Send it to the people who have publicly described this problem, individually, before posting.

### Wave 2 — Show HN (P2, ~2 weeks after Wave 1)

Title: **Show HN: DeckHQ – every Claude Code session on your machine, on one office floor**

The two things that will decide the thread, based on what happened to everyone else:

- **Privacy is the top comment risk.** vibe-kanban's launch was dominated by default-on
  analytics; Conductor's by undisclosed data practices. Put it in the first line of the post:
  *no network calls of any kind, CSP-enforced, zero dependencies.* We are the only tool in the
  category that can say this, so say it first before anyone asks.
- **"Why do I need this?" is the second.** Answer with the capture proof, not with the metaphor.

Be in the thread for the full day. Ship fixes during it, publicly.

### Wave 3 — Per-runtime launches (P3)

Each new adapter is a new community with its own launch:
- **Codex** — verify against a real install first (blocking, per the tech lead's own ruling)
- **Gemini CLI**, **OpenCode** (203k stars, its own Discord), **Cursor CLI**, **Amp**, **Aider**

One post per community, in that community's channel, with a floor screenshot showing *their*
runtime beside Claude Code. "Your OpenCode and Claude sessions on one floor" is a different
headline for each audience and each one is fresh.

### Wave 4 — Wrapped (December 2026)

Spotify Wrapped reached 200M engaged users in 24 hours in 2025. Raycast Wrapped shipped as
`v1.88` with a "copy as image" button and developers blog their cards every year.

**DeckHQ Wrapped**: turns per project, tokens, longest wait, the room that never slept, the
agent you talked to most, estimated spend, and a roast. Generated locally from the ledger,
one click to PNG. Ship it 1 December.

## 5. Channels, ranked by evidence

| Channel | Why | Effort |
|---|---|---|
| **X/Twitter with a GIF** | The only channel with a proven 9k-star → 83k-install conversion in this exact category | Medium |
| **VS Code Marketplace** | Pixel Agents got **9× more installs than stars** from a Marketplace listing. A thin DeckHQ extension that launches the daemon and opens the floor in a panel is a distribution channel we do not have | Medium — WP-31 |
| **Show HN** | High-quality feedback, moderate conversion, real reputational value if the privacy story lands | Low |
| **Per-runtime communities** | Four fresh launches for one adapter's worth of work | Low each |
| **YouTube (dev-tool channels)** | Long-form suits the metaphor; send working builds to 5 channels, don't pay for placement | Low |
| **awesome-claude-code lists** | Free, permanent, high-intent traffic | Very low |
| **Product Hunt** | Weak for local dev tools | Skip unless bundled with the paid launch |
| **Reddit** | Real audience, but self-promotion rules bite. Participate for months first, or don't | Low value/effort ratio |

## 6. Named risks and the responses

| Risk | Likelihood | Response |
|---|---|---|
| Anthropic's agent view lists exited sessions | **Happening.** It has a Completed group for background sessions since v2.1.139; on 3 Sep it still listed 7 of 69 on the reference machine | The PM re-measures `doctor`'s fourth line on the newest build before every launch wave and rewords it the day it stops being true. The invariant (M2) and breadth of capture survive regardless. Diversify to 3+ runtimes in P3. |
| Anthropic restricts third-party tooling again | Medium | Jan 2026's block on subscription credentials **doubled OpenCode's stars**. DeckHQ reads local files and never proxies auth, so it is not in the blast radius — and the backlash is a tailwind. Say nothing; ship. |
| "Observational theater" review | **High** | The single most likely negative framing. Pre-empt it: never demo the floor without demoing the Deck and a one-keystroke discharge in the same clip. See [`08`](08-PLAN-V2-100X.md) §1.2. |
| Pixel Agents ships the same thing | Medium | They now have multiple providers (Codex, Hermes since 10 Aug). They still have no ack model, no daemon and heuristic state detection. Our answer is speed on the invariant and on presence, not on the pixels. |
| Phone approval is free elsewhere | **Certain** | Remote Control, Happy and Paseo already do it for free. Relay never sells "a phone window"; it sells every session on every machine with history. `08` §3.0.3. |
| Munder Difflin adds transcript discovery | Medium | It already tail-reads transcripts for cost. If it reads them for state, its floor sees unspawned sessions too. Our answer: the invariant, presence without a tab (status line, mini-floor), per-project dynamic rooms against its fixed map, zero telemetry, and speed. `08` §3.5. |
| "Another office floor" fatigue | Medium | It got there first with the joke. DeckHQ never leads with the floor: it leads with the number (`doctor`), and the floor is what you see when you run the command. |
| We spike and die like vibe-kanban | Medium | That is what [`03-BUSINESS-MODEL.md`](03-BUSINESS-MODEL.md) exists to prevent. Note the timing: they launched a paid tier on 3 Feb and shut down on 10 Apr — **two months of selling**. Start the relay in P4, not in month 11. |
| Windows-first reads as unserious to a Mac audience | Low | Invert it. "Built on Windows, tested on three." The Mac tools ignore half the market; we ignore nobody. Verify macOS in P0 so the claim is true. |

## 7. What the Product Manager must not do

- No paid ads before the paid tier exists.
- No "we're better than X" posts. Every competitor's users are our future users; four of them
  are now looking for a new tool because the product they used shut down.
- No inflated numbers. Our whole credibility is an honest-limits section that lists our own
  unverified paths. That is an asset — protect it.
- No launching a feature that is not in `main` and released.

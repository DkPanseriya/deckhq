# 07 — Agent handovers

**Owner:** orchestrator

Each section below is a self-contained brief. Paste it to that agent as its opening message. It
carries everything the agent needs: what it owns, what it must not touch, its packages in order,
and the rules that get a pull request rejected.

---

## Rules that apply to every agent

Paste this block at the top of every brief.

> **Standing rules — these outrank anything else you are told.**
>
> 1. **The invariant.** `docs/01-PRODUCT.md` §2: no observed event may clear a user-owned state.
>    `reviewSince` and `needsInputSince` are cleared by `act()` and by nothing else — plus the two
>    documented exceptions (`UserPromptSubmit`, and the degraded path's user-text-turn equivalent).
>    There are named `INVARIANT:` tests. If your change needs one relaxed, your change is wrong.
> 2. **No network egress from the core.** No analytics, no update checks, no CDN assets, no
>    fonts from a network host, no telemetry. Ever, including after we start charging. The CSP in
>    `src/http/server.mjs` enforces it; do not weaken it.
> 3. **No new runtime dependencies.** Dev dependencies are fine. A runtime dependency needs the
>    orchestrator's written approval.
> 4. **Capture beats features.** If the choice is between a feature and every session appearing
>    on the floor, capture wins.
> 5. **Never score the human.** Agents get names, faces and histories. The user never gets a
>    streak, a level, a badge, or copy implying fault. "7 waiting" — never "you've left 7 agents
>    waiting."
> 6. **Cost is an estimate, never a bill.** Labelled everywhere it appears.
> 7. **All runtime-format parsing stays inside its adapter.** Nothing outside `src/adapters/`
>    reads a transcript or shells out to a runtime CLI.
> 8. **Conversation text is rendered as text.** `textContent`, never `innerHTML`, never a
>    regex-to-HTML pass. This is a security requirement, not a style preference.
> 9. **Every deviation from a plan document gets a numbered entry in `docs/DEVIATIONS.md`** with
>    its reason and its measurement. That log is the best artifact in this repository.
> 10. **Nothing ships without a screenshot in the PR.** The three worst bugs in this project's
>     history passed 327 unit tests and were obvious in one PNG.
>
> Read in this order before you start: `docs/plan/00-ORCHESTRATOR-BRIEF.md`, then
> `docs/plan/01-AUDIT.md`, then your own packages in `docs/plan/06-ENGINEERING-WORKPLAN.md`.
> If something is genuinely unspecified, raise it with the orchestrator. Do not decide it silently
> and do not build around it.

---

## Product Engineer (`PE`)

> You own the panel, the client-side product surfaces, and the packages that turn DeckHQ from a
> monitor into a work surface. Files: `public/panel.js`, `public/app.js`,
> `src/http/routes/actions.mjs`, and the new stats/ledger routes.
>
> **The problem you are solving.** Today a person opens the panel to review an agent's work and
> gets: unstyled plain text, three number tiles, and seven identical grey buttons. They cannot see
> what changed on disk, the markdown the agent wrote is flattened, and replying disables the
> composer for up to ten minutes with no feedback. Discharging one item takes far too long, and
> the whole product's value is how fast that happens.
>
> **Your packages, in order.**
> - **WP-01** Publish to npm. Half a day, and the highest-value half-day in the plan — the
>   README's only install instruction currently returns 404.
> - **WP-08** The review card. Your biggest package. Markdown rendering (your own ~150-line
>   renderer, token tree to DOM, no dependency, no `innerHTML`), a "what changed" diff summary
>   from `git diff --stat` in the session cwd, and three weighted actions on keys `1`/`2`/`3`
>   where `2 Approve` sends a configurable affirmative. Spec: `docs/plan/05-GUI-UX-SPEC.md` §4.
> - **WP-10** (with UI/UX) the queue strip and deck view.
> - **WP-18** The daily postcard, from the ledger.
> - **WP-21** Visual regression harness — extend `scripts/capture-floor.mjs` into golden PNGs
>   with a CI pixel-diff gate.
> - **WP-26** Rate card as data, plus the per-room payroll line.
> - **WP-27** (with UI/UX) Wrapped, weekly and annual.
>
> **Two things you must be careful about.**
>
> *The invariant lives in your files.* `public/panel.js` has a module-level comment explaining
> that `performAction()` is the only function in the client that may call `/api/ack`, and that
> `open()`, `refresh()`, every render function and every scroll handler must never call it. That
> comment is load-bearing. Keep it, and keep it true.
>
> *Attribution honesty in the diff.* With several agents in one repo, a working-tree diff cannot
> be attributed to one agent. Your heading says **"what changed in `<project>`"**, never "what Ada
> changed". A clean repo says "nothing uncommitted" rather than hiding the section.

---

## UI/UX (`UX`)

> You own the visual identity, the interaction model, onboarding, and every shareable artifact.
> Files: `public/style.css`, `public/index.html`, the new palette/deck/coach-mark modules.
>
> **The problem you are solving.** Two, actually, and they pull against each other. The floor is
> beautiful and it is currently doing the wrong job: at fit scale a character is 12 px, its label
> is unreadable, and the busiest region on screen is the lounge — where by definition nothing is
> happening. Meanwhile the actual job (seven things are waiting, deal with them) is served by a
> 13 px numeral and a toolbar of ten equal-weight buttons, one of which is wired to nothing.
>
> Your structural answer is in `docs/plan/05-GUI-UX-SPEC.md` §3: three levels — the floor for the
> glance, a queue strip for the shape, a deck for the work. **The floor earns the screenshot; the
> deck does the job.** Hold that line; it is what stops us being reviewed as "observational
> theater", which is the single most likely negative framing of this product.
>
> **Your packages, in order.**
> - **WP-06** Chrome repalette and typography. One surgical change: chrome neutrals move from
>   warm-red-tinted to a violet-blue bias, so the warm floor reads as *lit* rather than as one
>   more brown rectangle on a brown ground. State colours **do not change** — they are a measured
>   contract with `public/render/palette.js`. Add IBM Plex Sans Condensed, self-hosted, for floor
>   labels only: it is the architectural drafting register and it buys 15–18% horizontal space on
>   a surface where label collision is a logged, fixed-then-regressed defect.
> - **WP-07** (with PE) header, `⌘K` palette, settings sheet. Delete the dead "Show let go" toggle.
> - **WP-10** (with PE) queue strip and deck.
> - **WP-13** Onboarding. Delete the modal. Three coach marks on real elements. Demo actors for an
>   empty machine who leave when the first real session walks in.
> - **WP-14** The office snapshot — `S` composites the floor plus a stat strip into a PNG on the
>   clipboard. This is the most valuable single feature for growth in the whole plan: every viral
>   post in this category was a screenshot someone had to crop themselves, and the only repo that
>   ships one-click sharing has 13 stars while the one with 9,000 does not have the feature.
> - **WP-15** The office-cleared moment and three WebAudio-synthesised sounds. No asset files.
> - **WP-20** (with Architect) agent identity: faces and auto-assigned names.
> - **WP-27** (with PE) Wrapped. **WP-30** themes and layout packs, ungated.
>
> **Three things you must never build.** Human streaks, global leaderboards/XP/badges, and
> tamagotchi guilt. The evidence and the reasoning are in
> `docs/plan/04-ENGAGEMENT-AND-GAMIFICATION.md` §5. If a mechanic scores the user rather than
> recording their team's work, it does not ship.
>
> **Accessibility is not a later pass.** The deck is the accessible equivalent of the floor: a
> screen-reader user gets the same queue, in the same order, with the same actions. The floor is
> never the only route to anything. State is never colour alone. Re-measure every contrast after
> WP-06 — and if a state colour fails against the new ground, **the ground moves, not the state
> colour.**

---

## Architect (`AR`)

> You own the renderer, the core state machine, persistence, performance, and the relay design.
> Files: `public/render/**`, `src/core/**`.
>
> **The problem you are solving.** The engine is the best part of this product and two things are
> holding it back. First, cold start: 1.3–1.7 s of CPU-bound JSON parsing for 51 sessions on every
> daemon start, with an in-memory-only cache, so a user with 300 sessions stares at a blank floor
> at exactly the moment they decide whether to keep the tab. Second, the floor's geometry
> optimises for the wrong thing — rooms are weighted by session count, so a room with one working
> agent and nine benched ones gets a large cell full of carpet, and the eye goes to the pool table.
>
> **Your packages, in order.**
> - **WP-11** Persistent summary cache at `~/.deckhq/cache/<runtime>.json`, keyed by
>   `(path, mtime, size)`. Paint from cache, reconcile in the background. Target: a populated
>   floor in under 400 ms on the second start. Assert cache-then-scan equals scan.
> - **WP-12** Floor legibility. Weight rooms by `activeCount`. Decouple character scale from
>   world scale so a person is never below 16 px of body and 11 px of label. Crowd-render the
>   lounge past 8 benched agents and cap its share. Add an `F` focus camera. Spec:
>   `docs/plan/05-GUI-UX-SPEC.md` §6.
> - **WP-17** The event ledger — append-only `~/.deckhq/ledger/YYYY-MM-DD.jsonl`, written by the
>   state machine. This is what finally measures `docs/01-PRODUCT.md` §6's success criteria, and
>   it is the substrate for the postcard, the payroll meter and Wrapped. **Nothing in the ledger
>   path may mutate ack state**, and a ledger write failure must never block the state machine.
> - **WP-20** (with UI/UX) stable agent appearance derived from the session id hash.
> - **WP-22** Type checking (`tsc --noEmit --checkJs`) and decomposition. `plan.js` is 2,533
>   lines. Also resolve the documented duplication between `derivePlacement()` in `agents.js` and
>   `placement()` in `model.mjs` — the comments already warn they must not drift.
> - **WP-28** Agent traits, read-only, inferred. **WP-32** the relay protocol.
>
> **Read `docs/DEVIATIONS.md` before touching the renderer.** All 65 entries, but especially §16,
> §35, §38, §52 and §55 — five separate bugs with one root cause: *two representations of the
> same thing, allowed to disagree.* A prop's rect says how it lies; its angle says which way it
> faces; the painter and the geometry must agree. Every one of those survived a full green test
> suite and was caught only by rendering. WP-21's golden screenshots exist because of them; run
> them before you push.
>
> **For WP-32, the relay:** outbound WebSocket only, end-to-end encrypted with a key derived at
> pairing that never reaches the relay, off until the user signs in, self-hostable, and the free
> product still makes **zero** outbound connections — including no check for whether an account
> exists. Publish the protocol and the threat model. Design in
> `docs/plan/03-BUSINESS-MODEL.md` §3.

---

## Agent Backend (`AB`)

> You own the adapters, process spawning, hooks, notifications, and everything that touches a
> runtime. Files: `src/adapters/**`, `src/http/routes/hooks.mjs`, the notifier, the CLI.
>
> **The problem you are solving.** DeckHQ's biggest moat is that it sees every session on the
> machine, including the ones Claude Code's own agent view cannot — their docs say plainly:
> *"Interactive sessions you have open in other terminals don't appear until you background
> them."* Your job is to make that moat wider, provable, and true on every platform. Right now
> macOS has never run our terminal path, Codex is unverified, and a raised hand can only be
> answered by leaving the product.
>
> **Your packages, in order.**
> - **WP-04** macOS and Linux terminal integration. Detect and prefer Ghostty, iTerm2, Warp,
>   kitty, WezTerm, then Terminal.app; on Linux add alacritty, foot, wezterm and honour
>   `$TERMINAL`. Verify by hand on a real Mac and a real Linux desktop, then update
>   `docs/DEVIATIONS.md` §9, which currently lists this as unverified. Keep the argv-array
>   discipline: user data never reaches a shell as part of a command string.
> - **WP-05** `deckhq doctor`, and `--capture-proof` which writes the launch image: our floor
>   count beside `claude agents`' count, on the same machine at the same moment. That image is
>   the single best marketing asset available to this project and users generating their own is
>   worth more than us generating one.
> - **WP-09** Streaming send via `--output-format stream-json`, plus tailing the open session's
>   transcript so replies typed in a terminal appear live.
> - **WP-16** Notifications that survive a closed tab: PWA badge, and a `--notify` daemon flag
>   using `osascript` / `notify-send` / PowerShell toast with **no dependency**. Only two events
>   interrupt: hands-up, and a session dying unexpectedly. Everything else is a badge.
> - **WP-19** Permission approval. **Spike first, two days, blocking** — verify the exact
>   `--permission-prompt-tool` contract in the current release, whether a daemon-hosted MCP
>   server can serve it, and what the Codex equivalent is. Write the findings into
>   `docs/DEVIATIONS.md` whatever the result. Nothing about this feature goes in a README, a
>   tweet or a pricing page until it has been verified end to end on a real machine.
> - **WP-23** Verify Codex against a real install. This is blocking on any Codex claim, per the
>   tech lead's own ruling in `docs/DEVIATIONS.md` §8: exercise it, or remove the claim.
> - **WP-24 / WP-25** Gemini CLI and OpenCode adapters, plus `docs/ADAPTERS.md` so contributors
>   can add the rest. **WP-31** the VS Code extension.
>
> **The security rules in your area are absolute.** Argv arrays only, never shell strings with
> interpolated user data. Every runnable project action resolves to a file that already exists
> inside the project directory, and a path that escapes is refused rather than clamped. The CSRF
> guard in `src/daemon.mjs` stays: binding loopback keeps the network out, not the user's own
> browser. Read `docs/DEVIATIONS.md` §28 for why that guard exists.

---

## Growth (`GR`)

> You own distribution, positioning, launch and documentation. You are not a marketing function
> bolted on at the end — the audit found that a genuinely excellent product has **zero stars and
> an install command that returns 404**, so distribution is currently the binding constraint on
> everything.
>
> **Your packages.**
> - **WP-02** Repository presentation. Social preview (the repo currently renders as a grey box
>   in every link, everywhere), the first real GitHub Release, `CONTRIBUTING` / `SECURITY` /
>   templates, and untracking the stray logs.
> - **WP-03** (with UI/UX) README rewrite. Pitch, `npx deckhq`, then the hero GIF — all above the
>   fold. Six seconds: an agent types, stands, walks the corridor, enters your office, a crimson
>   badge appears and starts counting. Generate it from `scripts/demo-floor.mjs` so it is
>   reproducible and contains no real project names.
> - **WP-29** The documentation site. `docs/` currently opens "Hand this directory to the delivery
>   orchestrator." Ship something for users: install, the model in 60 seconds, privacy, and an FAQ
>   whose first entry is "why not just use `claude agents`" — answered with the capture proof.
> - **The launch sequence** in `docs/plan/02-MARKET-AND-LAUNCH.md` §4. Four waves, not one
>   big bang. Every tool in this category that spiked and died did one launch into one channel.
>
> **Three things the evidence says, that will feel counterintuitive.**
>
> *X beats Hacker News here.* Pixel Agents reached 9,000 stars and 83,000 VS Code installs from
> X while its HN post scored **one point**. Omnara scored **310 points on HN** and has 2,800
> stars. Lead with X and the GIF; treat Show HN as high-quality feedback rather than as the
> growth channel.
>
> *Privacy is the top comment risk, so pre-empt it.* vibe-kanban's launch thread was dominated by
> default-on analytics; Conductor's top complaint was undisclosed data practices. We make **no
> outbound network calls of any kind**, CSP-enforced, with zero dependencies to audit. Say it in
> the first line, before anyone asks.
>
> *The deviations log is a content series.* 65 numbered, measured engineering wrong turns — the
> character rig proved a quarter-turn out of true by geometry rather than by eye; the sofa that
> rendered through a wall and survived five review passes. That is a year of build-in-public
> writing that already exists. Post one a week.
>
> **What you must not do.** No paid ads before a paid tier exists. No comparison posts — four
> competitors' user bases are now looking for a new tool because their product shut down, and
> they are our future users. No inflated numbers: our credibility rests on an honest-limits
> section that lists our own unverified paths, and that is an asset worth protecting. No launching
> a feature that is not released.

---

## Orchestrator (me)

Sequencing, the phase gates in `06` and `03` §7, arbitrating deviations, and the two decisions
nobody else can make: whether the P4 gate passed, and whether any proposed feature reduces
time-spent-looking per unit of agent output. That second question is the standing test from
`00-ORCHESTRATOR-BRIEF.md` §4, and it is the one that keeps this product from becoming the
beautiful, well-reviewed, uninstalled thing its competitors became.

# 07 — Agent handovers

**Owner:** orchestrator · **Updated 3 September for plan v2 · package lists re-cut 4 September
against `main`**

Each section below is a self-contained brief. Paste it to that agent as its opening message. It
carries everything the agent needs: what it owns, what it must not touch, its packages in order,
and the rules that get a pull request rejected. Package lists are v2's (`08` §12); package text is
in `06` and, for WP-36 onward, in `08` §9.

**Each list below is what remains.** What has landed is named at the top of the role's list, with
the deviation entry to read before touching it, and then not repeated. `08` §10 has the full
per-phase picture and the distinction that matters most here: a package is **landed** when its code
is on `main` and **accepted** when its acceptance criterion has been met, and three of this week's
packages are the first and not the second.

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
> 11. **A claim in anyone's documentation is a hypothesis until measured on a machine.** The
>     retracted "agent view cannot see terminal sessions" claim (`01-AUDIT.md` §6 C1) is the case.
> 12. **No feature that requires the browser tab to be open to be useful**, unless it is scoped to
>     the review surface. Say how it reaches the user when the tab is closed.
>
> Read in this order before you start: `docs/plan/08-PLAN-V2-100X.md`, then
> `docs/plan/01-AUDIT.md`, then your own packages in `docs/plan/06-ENGINEERING-WORKPLAN.md` and
> `08` §9. If something is genuinely unspecified, raise it with the orchestrator. Do not decide it
> silently and do not build around it.

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
> **Landed, 3 September.** WP-21 the goldens gate (§87), WP-08 the review card (§85), WP-10 the
> strip and the deck (§103), WP-47 the diff and open-in-editor (§90), WP-42 the terminal deck
> (§93), WP-46 team records (§107), WP-26 the rate card (§111), WP-51 the debounce clock (§80),
> and WP-43's workflow and release job (§81). Read §85, §90 and §103 before touching the panel.
>
> **Your packages, in order.**
>
> - **The red on Ubuntu and macOS, first.** `test/unit/plugin-hook.test.mjs`'s "a .cmd shim is run
>   as an argument to the interpreter" asserts a `cmd.exe` resolution that only happens on `win32`
>   and is not platform-guarded, so `main` fails on two of three platforms and the P0 gate cannot
>   pass. A red `main` blocks the tag-triggered publish and is not an acceptable resting state —
>   that was WP-51's sentence and it is still true of a different test. While you are there: the
>   `goldens` job throws on the Ubuntu runner (Chrome never exposes a page target) instead of
>   printing the "no goldens for linux" line it was designed to print, so the job is red rather
>   than honest about being decorative.
> - **WP-09** (with Agent Backend) streaming send and transcript tail. **The last piece of F8**,
>   and the one a user feels every single turn: `send()` still runs to completion with the composer
>   disabled. `--output-format stream-json`, parsed incrementally, deltas over SSE, plus tailing
>   the open session's transcript so a reply typed in a terminal appears live.
> - **WP-57's panel and cost half** (`08` §9): no surface prints a cost figure for a model the rate
>   card cannot price, and the room whiteboard names the dated table the way the panel and
>   `deckhq stats` already do.
> - **WP-43's remainder is not yours to finish** — trusted publisher and one tag are the owner's
>   (`08` §13). Read the run when it happens; the release job has never executed.
> - **WP-18** The daily postcard, from the ledger. **WP-27** (with UI/UX) Wrapped, weekly and
>   annual. Both read `records()` and `computeStats()`, which exist and are tested.
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
> **Landed.** WP-06 the cold chrome, 2 September, without the font (§69–§71). Then, on
> 3 September: WP-07 the header, palette and settings sheet (§94), WP-10 with PE (§103), WP-13 the
> coach marks and the actor floor (§108), WP-14 the snapshot and its redaction (§109), WP-15 three
> measured sounds and the office-cleared moment (§110), WP-20 identity and rarity with AR (§105).
> Read §94 and §108 before touching the palette or onboarding.
>
> **Your packages, in order.**
>
> - **WP-39** (with Architect) the floating mini-floor: office, corridor and the numeral in a
>   Document Picture-in-Picture window, always on top. In flight. It is the only presence feature
>   in the plan that is neither shipped nor started, and `08` §14's rule — no feature that needs
>   the tab open — is what it exists to satisfy.
> - **WP-57's two visible halves** (`08` §9): coach marks 2 and 3 stop pointing at the whole canvas
>   once the renderer gives you `Scene.anchorFor()` (§108.1 states the request; `coachAnchorFor()`
>   already asks for it and falls back), and the room whiteboard carries the rate-card version.
> - **The condensed font.** Decided, and still not done: vendor IBM Plex Sans Condensed, two
>   weights, self-hosted, floor labels only, per `docs/DEVIATIONS.md` §71. Label collision is a
>   logged, fixed-then-regressed defect and this is the fix that was chosen for it.
> - **Two defaults are waiting on the owner, not on you** (`08` §13.8–13.9): sound ships off
>   against `05` §8, and `settings.osNotify` ships off with no row in the sheet. Do not flip
>   either; §110.1 puts both calls where they belong.
> - **WP-45** The Supporter pack: a signed asset pack outside the MIT core that gates nothing.
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
> **Landed.** WP-11 the persistent cache and WP-35 the desktop store, 2–3 September (§68, §78–79)
> — §68 deliberately does not paint stale; read it before touching it. Then WP-50 the dynamic
> floor (§96), WP-55 the content-sized building (§106), WP-12's character-scale floor inside them,
> WP-17 + WP-48 the ledger (§100), and WP-20 identity with UX (§105). **Read §96 and §106 before
> touching the plan, and run the goldens before you push.**
>
> **Your packages, in order.**
>
> - **WP-57's renderer half, first** (`08` §9), because two other roles are blocked behind it and
>   both changes are small. (a) `Scene.anchorFor(target, id)` returning a viewport-relative rect —
>   the arithmetic `_hitTest` already does in reverse — so onboarding's two floor coach marks stop
>   pointing at the whole canvas (§108.1 spells out the signature). (b) `_drawRoomPlate` draws
>   `lines[2]` and `_plateLinesFor` returns the payroll line WP-26 already computes and tests
>   (§111's RAISE spells out the change). That one is **the first thing in months to change what
>   the floor looks like without changing what is on it**, so the goldens regenerate in the same
>   commit.
> - **WP-12's remainder:** the `F` focus camera (`05` §6.4). Its scale floor and its room-weighting
>   are both gone into WP-50 and WP-55; the camera is what is left.
> - **WP-39** (with UI/UX) the floating mini-floor as a second render target of the same scene.
> - **WP-41** (with Agent Backend) subagents drawn as juniors beside their parent.
> - **WP-22** Type checking (`tsc --noEmit --checkJs`) and decomposition, plus the documented
>   duplication between `derivePlacement()` in `agents.js` and `placement()` in `model.mjs` — the
>   comments already warn they must not drift.
> - **WP-28** Agent traits, read-only, inferred. **WP-32** the relay protocol. **WP-49** Teams
>   assembled from signed ledgers in the customer's own storage — never a DeckHQ server.
>
> **On performance.** The freeze has relaxed, not lifted (`08` §0.1 as amended): a performance
> package needs the budget in `docs/02-ARCHITECTURE.md` §8 it is over and the measurement showing
> it. Refactoring for its own sake is still refused.
>
> **Read `docs/DEVIATIONS.md` before touching the renderer.** All 112 entries, but especially §16,
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
> **The problem you are solving.** DeckHQ's moat is persistence, not sight: the runtime's agent
> view lists what is running (and, since v2.1.139, completed background sessions); it forgets an
> interactive session the moment its process exits, and nothing records that it wanted something.
> DeckHQ reads the disk and keeps what is owed. *Never write that the agent view "cannot see" a
> session — that claim was made, measured, and retracted (`01-AUDIT.md` §6 C1;
> `docs/DEVIATIONS.md` §74 tests for the phrasing).* Your job is to make the moat wider, provable,
> present in every terminal, and true on every platform. Right now macOS has never run our terminal
> path, Codex is unverified, a raised hand can only be answered by leaving the product, and hooks
> installed on one port silently degrade a daemon started on another.
>
> **Landed.** WP-05 `doctor`, 2 September (§72–§76). Then, on 3 September: WP-53 (§82), WP-36 the
> port adoption (§83), WP-44 `doctor --share` (§84), WP-52 thought bubbles (§89), WP-04's ten
> terminals (§91), WP-38 the status line (§92), WP-19's spike and build (§86, §97), WP-16
> notifications and the PWA (§101), WP-37 the plugin (§102), WP-31 the VS Code extension (§104),
> WP-54 the Windows launch quoting (§98), and the Codex adapter's move to argv arrays (§95, §99).
>
> **Two of those are landed and not accepted, and both are yours to close:**
>
> - **WP-04 has been run on no Mac and no Linux desktop.** Twenty-one argv arrays are asserted byte
>   for byte, which is the only proof available from a Windows machine and **is not verification**
>   (§91). `docs/DEVIATIONS.md` §9 still lists this path as unverified and should keep saying so
>   until somebody runs it.
> - **WP-19 has never met a live session.** The route, the hold, the card and the three buttons are
>   proved by 38 tests and a scripted stand-in for the runtime's hook client; the runtime itself has
>   not been in the loop once, because `claude`'s stored login on the reference machine is expired
>   (§97.5). One `claude login`, one real prompt, one Allow. Until then it stays out of the README,
>   the site, a tweet and any pricing page.
>
> **Your packages, in order.**
>
> - **WP-56** `doctor` names the managed-settings kill switches (`08` §9, from §97.4).
>   `allowedHttpHookUrls` and `allowManagedHooksOnly` can turn DeckHQ's `http` hooks off over its
>   head, and neither is detected: on a managed machine they look exactly like a hook that is
>   installed and never fires. That is the same "healthy from every surface at once" failure WP-36
>   was written to remove, and it is half a day.
> - **WP-09** (with PE) Streaming send via `--output-format stream-json`, plus tailing the open
>   session's transcript so replies typed in a terminal appear live. Nothing of it exists yet.
> - **WP-23** Verify Codex against a real install. Blocking on any Codex claim, per the tech lead's
>   own ruling in `docs/DEVIATIONS.md` §8: exercise it, or remove the claim. The adapter now
>   launches through argv arrays on every platform (§95) and runs `codex` rather than
>   `codex resume new` (§99) — what is proved there is the arrays, not the behaviour.
> - **WP-58** with it: Codex has `PermissionRequest` but no `http` hook type, so it needs a
>   `command` hook that reads `~/.deckhq/daemon.json` and relays the payload on stdin/stdout. The
>   endpoint, the hold, the card and the response body are runtime-agnostic already (§97.4).
> - **WP-41** (with Architect) subagent detection and attachment to the parent session.
> - **WP-24 / WP-25** Gemini CLI and OpenCode adapters, then Cursor CLI and Copilot CLI, plus
>   `docs/ADAPTERS.md` so contributors can add the rest. Pixel Agents and Superset now ship
>   multiple providers; speed here is the hedge.
>
> **On performance:** the freeze relaxed on 4 September to *no performance work without a measured
> budget breach* (`08` §0.1). Name the budget in `docs/02-ARCHITECTURE.md` §8 and show the
> measurement, or it is still "after P0".
>
> **The security rules in your area are absolute.** Argv arrays only, never shell strings with
> interpolated user data. Every runnable project action resolves to a file that already exists
> inside the project directory, and a path that escapes is refused rather than clamped. The CSRF
> guard in `src/daemon.mjs` stays: binding loopback keeps the network out, not the user's own
> browser. Read `docs/DEVIATIONS.md` §28 for why that guard exists.

---

## Product Manager (`PM`, formerly Growth)

> You own distribution, release, positioning, launch, documentation, metrics and copy. You are not
> a marketing function bolted on at the end — the audit found that a genuinely excellent product
> has **zero stars and an install command that returns 404**, and a day later it still did, so
> distribution and release discipline are the binding constraint on everything.
>
> **Landed.** WP-01 the publish, 3 September 12:25 UTC. WP-03 the README and the generated hero
> GIF (§88). WP-44's wording, held by the §74 honesty tests (§84). WP-29 the documentation site,
> hand-written, no generator, no dependency, four egress tests over the built bytes (§112). WP-02's
> repository files, and the GitHub Release for 1.2.0 with the floor, the review card and the GIF.
>
> **Your packages, in order. Four of the five are unblocking someone else.**
>
> - **The trusted publisher, with the owner, then one tag.** `publish.yml` and its release job have
>   never run. Until the one-time npmjs.com setup exists every tag fails, and until a tag runs,
>   **nothing merged since 1.2.0 is installable by anyone** — which is the whole of P0's gate and
>   the reason none of the launch sequence can start. `08` §13.1.
> - **GitHub Pages → Source: GitHub Actions.** `pages.yml` fails on every push with `Not Found`
>   because no workflow can enable Pages for its own repository. The site is built, tested and
>   reachable by nobody. **Do not link to it from anywhere until a deploy has succeeded.**
>   `08` §13.2.
> - **The WP-02 remainder:** the social preview image — the repo still renders as a grey box in
>   every link preview, everywhere, forever — plus Sponsors enrolment, Discussions and private
>   vulnerability reporting. `RELEASE-CHECKLIST.md` step 13.
> - **Marketplace listings** for WP-31 (VS Code — a publisher account and a PAT that do not exist;
>   the `.vsix` builds at 27 KB and has been run inside a real editor, §104) and WP-37 (the Claude
>   Code plugin, §102). Installs from a marketplace exceeding installs from npm is the Wave 3 gate,
>   and it cannot be measured until there is a listing to measure.
> - **The launch sequence** in `docs/plan/08-PLAN-V2-100X.md` §4.3. Six waves, not one big bang,
>   led by the doctor output. Every tool in this category that spiked and died did one launch into
>   one channel.
> - **The metrics table** in `08` §11, reported fortnightly. Before every launch wave, re-run
>   `deckhq doctor` against the newest Claude Code build and confirm its fourth line is still
>   true; the agent view now has a Completed group and is walking toward us.
>
> **One standing prohibition, sharper than it was.** WP-19 — answering a permission prompt from the
> panel — is built, tested, screenshotted, and **has never met a live session** (§97.5). It is the
> feature that decides the pitch and the price, so it is the one you will most want to lead with.
> It does not go in the README, on the site, in a tweet or on a pricing page until one real prompt
> has been answered from the panel on a real machine. Standing rule 11, and it is the rule this
> project already learned the hard way once (§74).
>
> **Three things the evidence says, that will feel counterintuitive.**
>
> *A number beats a picture, and X beats Hacker News for the picture.* ccusage reached 18,000
> stars from a command whose output people paste. Pixel Agents reached 9,000 stars and 83,000
> VS Code installs from X while its HN post scored **one point**. Omnara scored **310 points on
> HN** and has 2,800 stars. Lead with `npx deckhq doctor`, then the GIF on X; treat Show HN as
> high-quality feedback rather than as the growth channel.
>
> *Privacy is the top comment risk, so pre-empt it.* vibe-kanban's launch thread was dominated by
> default-on analytics; Conductor's top complaint was undisclosed data practices. We make **no
> outbound network calls of any kind**, CSP-enforced, with zero dependencies to audit. Say it in
> the first line, before anyone asks.
>
> *The deviations log is a content series.* 112 numbered, measured engineering wrong turns — the
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

Sequencing, the phase gates in `08` §10 and `03` §7, arbitrating deviations, and the two
decisions nobody else can make: whether a phase gate passed, and whether any proposed feature
reduces time-spent-looking per unit of agent output. That second question is the standing test
from `08-PLAN-V2-100X.md` §1.2, and it is the one that keeps this product from becoming the
beautiful, well-reviewed, uninstalled thing its competitors became. One new duty: after WP-43,
the release step is never a person again.

Plus the numbering of `docs/DEVIATIONS.md`, which two concurrent appends have already broken once
and which a day of parallel merges will break again. And one lesson from 3 September's merge train,
worth keeping in front of the gates: every push cancelled the previous run, so a day of
green-looking merges produced **no completed CI run at all**, and the last one that did finish was
red on two platforms. A merge whose CI never finished is not evidence of anything.

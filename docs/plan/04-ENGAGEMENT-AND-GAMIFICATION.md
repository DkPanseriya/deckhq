# 04 — Engagement, dopamine and gamification

**Owner:** UI/UX, with Product Engineer on the ledger · **Phases:** P1–P3
**Evidence:** gamification research, 2 Sep 2026.

---

## 1. The rule that governs this whole document

Developers accept **records** and **opt-in comparison**. They reject **scores applied to them**
and **guilt**.

The evidence is unambiguous. GitHub shipped streak counters and removed them in May 2016 after a
backlash that the graph survived intact. *Journal of Consumer Research*, April 2023: a broken
streak reduces continuation **even when the break was outside the user's control**, and making
the streak more salient amplifies both the motivation and the damage. GitHub's achievement
badges drew a 2022 thread titled "profile badges are patronising, ugly" and the YOLO badge
became a hiring red flag. A study of 114 employees using Habitica found people inventing fake
tasks and marking undone work done, to get the dopamine.

Meanwhile the contribution graph, `github-readme-stats` (79.7k stars), WakaTime's *private*
leaderboards (the paid feature — which tells you where the value is), Spotify Wrapped (200M
engaged users in 24 hours, 500M shares) and Raycast Wrapped all thrive.

So, binding:

> **The agents are the characters. The human is the manager, and the manager is never scored.**

Agents get names, faces, histories and traits. The user gets a record of their team's work and a
one-click way to share it. The user never gets a streak, a level, an XP bar, a badge, or a
message that implies they have let anyone down.

## 2. The core loop (P1–P2)

This is not gamification. It is the product working, and it is where the real dopamine is.

```
  agent raises hand / finishes turn
        ↓  (tray badge · OS notification · later a phone push)
  you glance — one number tells you whether to move
        ↓  (⌘K or click, or you were already looking)
  the review card: what it said, what changed on disk, three buttons
        ↓  (one keystroke)
  discharged — the person walks back to their desk, or to the lounge
        ↓
  the office empties → the chime → the floor is calm
```

The reward is **an empty office**, not points. Zeigarnik: the badge counting up is the open loop,
and clearing it is the close. This is why the counter must be honest — an inflated needs-you
number destroys the loop's value permanently.

**The "office cleared" moment (WP-15)** is the one deliberate celebration in the product: when
the last waiting agent is discharged, the lights warm slightly, a two-note chime plays, and a
single line appears — *"Office clear. 7 discharged today, longest wait 26h."* It happens at a
real milestone, at most a few times a day, and then it is gone. Vercel's first-deploy confetti
works for exactly this reason.

## 3. The shareable artifacts

### 3.1 What actually spread in this category, and what it was missing

Ethan Mollick's January 2026 video of pixel subagents being hired reached ~467k views. Pixel
Agents went from a repo created 8 February 2026 to 9,000 stars and 83,000 VS Code installs by
August, almost entirely from X. Claude Buddy — Anthropic's own April Fools tamagotchi, 18
species with rarity tiers — was removed on 9 April and users **downgraded their Claude Code
version to keep their pets**; the "Bring Back Buddy" issue consolidated eight separate requests.

Every one of those was a screenshot or a recording someone had to make themselves. The only repo
in the category that ships one-click sharing has **13 stars**. The one with 9,000 does not have
the feature.

### 3.2 The office snapshot — `S` (WP-14, P1)

One key. Composites the current floor plus a stat strip into a PNG, on the clipboard and saved
to disk.

```
┌──────────────────────────────────────────────────────────┐
│  [ the floor, cropped to content, at 2× ]                 │
├──────────────────────────────────────────────────────────┤
│  SAMCO-DESK · 15 rooms · 51 people                       │
│  5 working   2 hands up   7 in your office   37 benched  │
│  today  ≈ $18.40 · 2.4M tokens · longest wait 1d 2h      │
│                                              deckhq.dev  │
└──────────────────────────────────────────────────────────┘
```

Rules: the office is named after the hostname, because people share things with their name on
them. Project names are shown by default and there is a **one-key redact** that replaces them
with the MK tags, because half the audience works on things they cannot show. No watermark
beyond a small wordmark. No "share to X" button that opens a compose window — put the PNG on
the clipboard and get out of the way.

### 3.3 The daily postcard — lights out (WP-18, P2)

When the last live session ends, or at a configured hour, the floor dims to night lighting and
emits a card:

> **Tuesday.** 14 turns across 4 rooms. `orbital-api` shipped 3, `checkout-flow` waited 4h.
> 2 agents still up. ≈ $18.40. Longest wait today: 26h → cleared.

Stardew Valley's day-end save is the model: an ending, not a demand. It appears once, it does
not nag, and dismissing it costs nothing. Critically it makes *not looking* safe, which is the
requirement from [`00-ORCHESTRATOR-BRIEF.md`](00-ORCHESTRATOR-BRIEF.md) §4.

### 3.4 Wrapped — weekly and annual (WP-27, P3)

Weekly, Monday morning, from the ledger. Annual, 1 December.

Contents that are true and interesting: turns per room, tokens, estimated spend, longest wait
and whether it fell, the room that never slept, the agent you talked to most, your busiest hour,
and one genuinely funny derived stat (the count of a phrase across all transcripts, in the
spirit of the "you're absolutely right" tracker that got ~350 reactions on its issue).

Generated locally. One click to PNG. No email, no server, no account.

## 4. Attachment: making the agents people

The Claude Buddy episode proved attachment to agent characters is real and strong. DeckHQ has a
structural advantage over a per-terminal pet: our characters are *the actual sessions*, so
attachment attaches to real work.

**Identity (WP-20, P2).** Today every agent is `MK3.2` and every body is the same silhouette.
Instead: derive a stable appearance from the session id hash — hair, skin tone, outfit accent,
glasses, build — and auto-assign a first name from `names.js` on first sight rather than on
request. Keep the state colour on the torso and the state icon above the head, which preserves
`docs/03-VISUAL-SPEC.md` §3's rule that state stays readable. Keep `MK3.2` as the sub-label and
in the hover card.

*"Ada has been waiting since yesterday"* is a sentence that makes someone open a tab. *"MK3.2 has
been waiting since yesterday"* is not.

**Traits (WP-28, P3, optional).** Read-only, inferred from real behaviour, never trained and
never affecting anything: how often it raises its hand, its tool mix, its verbosity, its model.
Surfaced as one line in the hover card and as a tendency in idle animation. Two Point Hospital's
permanent staff traits, without the morale bar. **No skill levels, no training, no resignation.**

## 5. The three things we refuse to build

Written down so nobody proposes them again.

**No streaks, or any daily-active mechanic aimed at the human.** GitHub removed theirs in 2016.
The JCR 2023 finding is that breaking one depresses continuation even when the break was outside
your control. Managers take weekends. A tool that punishes you for a Saturday is a tool you
uninstall in January.

**No global leaderboards, XP or badges.** Strava's own research literature finds peer comparison
net-negative for the behaviour it is meant to encourage; the paper's line is that without the
comparison effects users *would exercise more*. Senior engineers find levels patronising.
If a user wants a spend leaderboard, **export to Viberank or CCgather** — they already exist,
they already have the audience, and they can own the toxicity. A one-line `deckhq export
--viberank` is the right amount of participation.

**No tamagotchi guilt.** No pet that suffers, no agent that dies of neglect, no sad face when
you have been away. Claude Buddy showed attachment is real; Duolingo shows guilt drives quitting
posts at 480 and 588 days. In DeckHQ, neglect means **benched**, which is restful and looks
pleasant, and the office never acts on a real session by itself.

Also excluded, for the same family of reasons: sounds that play more than a few times a day,
any modal that appears more than once, any copy in the second person that implies fault
("you've left 7 agents waiting" → **"7 waiting"**).

## 6. Notifications: the interruption budget

Interrupting a developer costs roughly 23 minutes of refocus. So the budget is small and spent
deliberately.

| Event | Channel | Default |
|---|---|---|
| An agent raises its hand (`needs_input`) | OS notification + tray badge + sound | **On** |
| A session dies unexpectedly while working | OS notification + tray badge | **On** |
| An agent finishes a turn (`for_review`) | Tray badge count only, no interrupt | On (badge) |
| Stalled | Badge only | On (badge) |
| Daily postcard | In-app at lights-out | On |
| Weekly Wrapped | In-app, Monday | On |
| Everything else | Nothing | — |

Two interrupting events. Everything else is an ambient count you consult when you choose to.
Coalescing already exists (one notification per 10s, multiples become "3 sessions need you") and
stays.

**The tray is the missing piece (WP-16, P2).** Today notifications require the browser tab to be
alive, which defeats the purpose — the daemon outlives the tab by design. Short term: PWA
install + the Badging API. Medium term: a small menu-bar/tray shell showing the needs-you count
that opens the floor on click.

## 7. The first sixty seconds

Benchmarks: the activation ceiling for dev tools is about five minutes; developers who reach
first success within ten minutes are 3–4× likelier to pay; 68% cite "too much setup" as the
reason they abandon. Warp's own post-mortem names its problem "the blank screen".

DeckHQ's advantage is that it reads history that already exists, so there is nothing to set up.
The design target:

| t | What happens |
|---|---|
| 0:00–0:05 | Browser opens on a floor **already populated** from the persisted summary cache (WP-11). No spinner, no modal, no empty state. |
| 0:05–0:20 | Coach mark 1 of 3, anchored to the real needs-you counter: *"7 sessions are waiting on you. This number is yours — the runtime can't clear it."* |
| 0:20–0:40 | Coach mark 2 points at the office: *"They finished and walked in here. Reading a message doesn't send them away."* Coach mark 3 points at one agent: *"Click anyone."* Escape skips all three, forever. |
| 0:40–1:00 | They click. The review card shows the last message, `+142 −18 across 6 files`, and three big buttons. They press **1**. Someone walks back to their desk. |

If the machine has **no** sessions, do not show an empty room. Show the demo floor with one line:
*"These are actors. Run `claude` in any repo and a real one walks in."* Then poll, and when the
first real session appears, the actors leave and it walks in alone. That is the aha moment and
it is worth engineering (WP-13).

## 8. Ranked mechanics, with the call

| # | Mechanic | Retention | Sharing | WP | Call |
|---|---|---|---|---|---|
| 1 | Hands-up hero loop + tray + notification | High | Low | WP-16, WP-19 | **Build P2** |
| 2 | One-key office snapshot | Low direct, high indirect | **Highest** | WP-14 | **Build P1** |
| 3 | Review card, one-keystroke discharge | **Highest** | Low | WP-08 | **Build P1** |
| 4 | Lights-out daily postcard | High | Medium | WP-18 | **Build P2** |
| 5 | Agent identity: names and faces | High | Medium | WP-20 | **Build P2** |
| 6 | Office-cleared chime and calm | Medium | Low | WP-15 | **Build P1** |
| 7 | Weekly + annual Wrapped | Medium | High | WP-27 | **Build P3** |
| 8 | Payroll meter per room | Medium | High | WP-26 | **Build P3** |
| 9 | Permanent shipped ledger per room | Medium | Low | WP-17 | **Build P2** (it underpins 4, 7, 8) |
| 10 | Cosmetic packs, layout import/export | Medium | High | WP-30 | **P3, ungated** |
| 11 | Inferred agent traits | Medium | Medium | WP-28 | **P3, optional** |
| 12 | Named lounge events ("pool tournament") | Low | Medium | — | Cheap, do it as flavour text in P3 |
| — | Human streaks | — | — | — | **Never** |
| — | Global leaderboards / XP / badges | — | — | — | **Never** — export instead |
| — | Tamagotchi guilt | — | — | — | **Never** |

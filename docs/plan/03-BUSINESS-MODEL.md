# 03 — Business model

**Owner:** orchestrator, with Architect on the relay design · **Starts:** month 1 (Sponsors and
the Supporter pack), relay alpha month 3
**Evidence:** monetisation research, 2 Sep 2026, re-checked 3 Sep. Figures marked *est.* are
third-party models.

> **Updated 3 September for plan v2.** Three changes, all in [`08`](08-PLAN-V2-100X.md) §5:
> (1) something is on sale in month 1, not month 4; (2) the relay's pitch is *every session on
> every machine with history*, because a phone window on one session is now free from Remote
> Control, Happy and Paseo; (3) a bring-your-own-storage Teams tier is added, and the ledger is
> designed for merging from day one (WP-48). The sections below are kept as the reasoning.

---

## 1. The constraint, restated because it is the whole design

`docs/01-PRODUCT.md` §7 chose free-and-MIT deliberately, and the reasoning was right: every
competitor is free, and the best-known one reached 27,900 stars and shut down for lack of a
business model. That reasoning argued against *monetising v1*. It did not argue against ever
having a business.

**Binding constraint:** the local daemon, the floor, the panel, the state model and every
adapter stay MIT, local, account-free and egress-free. Forever. Paid features are **services you
opt into**, never gates on the local UI. A user who never pays must never see a locked door in
the product they installed.

This is not idealism. Conductor's top HN complaint was undisclosed data practices;
vibe-kanban's launch thread was dominated by default-on analytics. Zero-egress is our single
loudest differentiator, worth more than any feature we could paywall.

## 2. What the evidence says

**vibe-kanban is the case study to learn from, not to fear.** 28,000 stars, 30,000 MAU, shut
down 10 April 2026. Their own words: *"the vast majority are free users and we couldn't find a
business model that we could get excited about."* Their founder onstage: *"Everybody who is
making money is doing two things. They're selling to enterprise and they're reselling tokens."*

But look at the dates. Cloud launched **3 February 2026**. They shut down **10 April 2026**.
That is nine weeks of selling. It is not a verdict on seat pricing; it is a verdict on starting
too late with too little runway.

**What works in this category:**

| Model | Evidence | Verdict for us |
|---|---|---|
| Local-first + paid sync | Obsidian: local, no telemetry, Sync $4–5/mo is its largest revenue line (~$2–4M ARR *est.*). Raycast Pro $8–10 sync+AI "unlocked the fundraise" | **Our model.** Identical shape: beloved free local tool, sync is the only thing the local version genuinely cannot do |
| Seats for teams | Linear $100M+ ARR, NRR 177%, ~$2,500 ARPA/yr. Nimbalyst $20/seat, Superset $15–20, Cline $20, Continue $20/seat | **Year two.** Where budget actually lives |
| Metered agent-runs | Devin $2.25/ACU, Warp credits, Ona OCU | **No.** We don't run the compute |
| Token resale / affiliate | Zero-markup is now table stakes (Amp, Kilo, Cline, OpenCode). Margin 0–5%. Only OpenCode's 7T tokens/day makes it work | **No** |
| Cloud agent compute | Terragon dead in 4 months. vibe-kanban Cloud dead in 9 weeks. Codegen acqui-hired and deprecated | **No.** Capital-hungry graveyard |
| Ads | Amp shipped ad-supported 15 Oct 2025, removed by Mar 2026 | **No** |
| Sponsors alone | ccusage: 18.3k stars → 27 sponsors, $120/mo. **0.15% of stargazers** | **Accept, don't plan on** |
| One-time license | Chive $29 lifetime, SessionWatcher $6.99 | **Maybe, as a price probe** |

**Willingness to pay, from the target user's own words.** They already pay Claude Max $100–200,
Cursor $20–200, Warp $20–200, Raycast $8–10. A five-agent fleet costs $1,000–2,600/mo in API
spend. On Conductor's HN thread: *"People on 100-200/month claude code subscription wouldn't
mind paying 10-30 bucks for this."* The anchor is consistent: **5–15% of the model bill**, so
$10–30/mo for tooling around a $100–200 plan.

**And the sobering one:** nobody has shown people paying for a phone window on its own. Claude
Remote Control is free on all plans. Codex mobile is free including on the free tier. Happy is
MIT with a free hosted relay. The only standalone that charges is Tactic Remote at **$2.99/mo**.

So the phone alone is not the product. The phone plus *multi-machine, multi-runtime, and the
ability to actually approve a permission* is.

## 3. The architecture: DeckHQ Relay

**$9/month, or $84/year. Alpha in month 3, paid in month 4.**

### 3.1 What it is

An opt-in, end-to-end encrypted relay that carries your floor off your machine.

- **One floor across every machine.** Laptop, desktop, the box under the desk, a cloud VM. One
  office, four buildings' worth of agents. No competitor does this, first-party included, and
  it is a genuine capability the local version cannot have.
- **Your phone as the office door.** A PWA (installable, no app store) that shows the needs-you
  queue and pushes when an agent raises its hand or walks into your office.
- **Approve from the phone.** The one that justifies the price. See §3.3.
- **90 days of floor history**, synced. The ledger from WP-17 becomes portable, so the standup
  card and the Wrapped survive a machine rebuild.

### 3.2 How it stays honest

- The daemon holds an **outbound WebSocket only**. Still no listening socket beyond loopback,
  still no `--host` flag.
- **The relay cannot read anything.** Session titles, conversation text, project names, paths
  are encrypted client-to-client with a key derived at pairing (QR code, never transmitted). The
  relay sees an opaque blob, a device id and a size. Publish the protocol, publish the threat
  model, and make the client half of it MIT so it can be audited.
- **Off by default. Not present until you sign in.** The free product makes zero outbound
  connections, including no check for whether a relay account exists.
- **Self-hostable.** Ship the relay server as a Docker image under a source-available licence.
  A user who prefers their own box gets it free; a user who wants ours pays $9. This kills the
  "you're holding my data hostage" objection outright, and costs us almost nothing — the people
  who self-host were never going to pay.

### 3.3 The feature that justifies $9: approve from anywhere

Right now a raised hand can only be answered by finding the terminal. DeckHQ has the hook, the
UI and the metaphor, and stops one step short.

A `PermissionRequest` hook of type HTTP, pointed at the daemon and installed with the same tagged
consent as the existing hooks, lets DeckHQ answer the prompt for **every** interactive session,
not only ones it started; Codex has the same hook since 0.150.0. The request renders in the panel
with **Allow / Deny / Allow for this session**, and — with the relay — on your phone, with a push
notification. Silence falls through to the terminal prompt, so a closed DeckHQ never blocks a
session. (`--permission-prompt-tool` is print-mode only and stays as the fallback for headless
sessions DeckHQ spawns.) Verified route recorded in `08` §3.0.2.

That is: *your agent asks to run a migration at 11pm, your phone buzzes, you read the command,
you tap Allow, it continues.* Nothing else in the category does this across machines and
runtimes.

> **Spike required before this is promised anywhere.** WP-19 is a two-day spike to verify the
> exact flag semantics and MCP contract in the current Claude Code release, and to determine the
> Codex equivalent. Nothing about this feature goes in a README, a tweet or a pricing page until
> that spike passes. If it fails, the relay still sells on multi-machine + push + history, at a
> lower price.

### 3.4 Price and projection

$9/mo, $84/yr (22% annual discount). Sits between Obsidian Sync ($4–5), Tactic ($3), Zed Pro
($10) and Raycast Pro ($8–10), and well under the $10–30 the target user says out loud.

Conversion basis: freemium dev-tool benchmarks run 2–4%; Tailscale's business-heavy funnel is
~7.7%; ccusage's sponsor rate is 0.15%. Plan on **2–3% of monthly actives at ~$95/yr**.

| Monthly actives | @2% | @3% |
|---|---|---|
| 5,000 | $9.5k ARR | $14k ARR |
| 20,000 | $38k ARR | $57k ARR |
| 60,000 | $114k ARR | $171k ARR |
| 150,000 | $285k ARR | $427k ARR |

Not a venture outcome. A durable, self-funding, one-person-and-then-some business that never has
to compromise the free product. That is the correct ambition for this shape of tool, and it is
precisely what vibe-kanban failed to build in time.

## 4. Second line: DeckHQ Teams (P5, month 6+)

**$18/seat/month.** One floor for a whole team.

Everyone's agents in one building. Rooms per repo across all members. A shared review queue with
"who has this". Per-room budgets and alerts. Slack and Linear hooks. Then Enterprise on top with
SSO, SCIM, audit log and a self-hosted relay — that is the tier that funds companies (Coder's
NDR is 184% on exactly this).

Comparables: Nimbalyst $20, Superset $15–20, Cline $20, Continue $20, Conductor $60.
Expect **1–2% of individual users to pull a workspace**, 3–8 seats each, $216/seat/yr.
20k MAU → 200–400 workspaces → 600–3,200 seats → **$130k–690k ARR**.

Built on the relay from P4, so it is an increment rather than a second product.

### 4.1 Teams BYOS — bring your own storage (added 3 Sep)

**$25/seat/month, month 8.** The enterprise objection to any agent-monitoring tool is "where does
the data go". Answer: nowhere of ours. A team floor is assembled from signed ledgers each machine
writes to *the customer's* storage — S3, R2, a shared drive. DeckHQ sells the software that merges
and renders them and never holds a byte. This is the tier that survives a procurement review, it
keeps the zero-egress promise literal for paying customers, and it is why WP-48 puts a machine id
and an Ed25519 signature on the ledger from day one. SSO and audit export in the enterprise
increment. WP-49.

## 5. Third line: the Supporter pack (month 1, the price probe)

**$29 one-time, on sale in month 1** so that something exists to buy before the December Wrapped
moment. WP-45. Cosmetic and personal-power extras shipped as a signed asset pack *outside*
the MIT core: floor themes (night shift, blueprint, warehouse), custom avatars and rooms,
floor replay ("watch yesterday"), a rate-card editor.

1–3% conversion at $30 one-time. Tens of thousands a year at best and no recurring base — but
zero servers, no accounts, ships in a week, and it price-tests the audience before we build the
relay. Treat it as a tip jar with dignity, and gate **nothing** that affects capture, the queue,
or any action.

## 6. What we will never sell

- **The queue.** Capture, the six states, the invariant and every action are free forever.
- **Adapters.** A runtime is never paywalled; that would break rule 4 (capture beats features)
  and rule 2 (§1) at once.
- **Your data, to anyone.** No analytics resale, no aggregate telemetry product, no "anonymised
  insights". The zero-egress promise has no asterisk.
- **Model tokens.** Zero-markup is table stakes; we would be competing on someone else's margin.

## 7. Sequencing and gates

| When | Do | Gate to proceed |
|---|---|---|
| Month 1 | GitHub Sponsors tiers; Supporter pack on sale | Take rate ≥ 1% means the audience will pay |
| Month 3 | Relay alpha, invite-only, free for 60 days | 1.5% of invitees convert at $9 |
| Month 4 | Public paid launch — **only if approve-from-here (WP-19) is verified end to end**; otherwise relay at $6 on multi-machine, push and history | 500 paying users |
| Month 6 | Teams | 10 paying teams |
| Month 8 | Teams BYOS | First procurement-reviewed customer |

If the P4 gate fails, we do not chase it with discounts. We go back to §5, keep the tool free,
and treat it as a portfolio and reputation asset — which was `docs/01-PRODUCT.md` §7's original
position and remains an honourable outcome.

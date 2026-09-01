# DeckHQ

## What it is

A local control plane for Claude Code sessions, rendered as a top-down open-plan office. Every running or resumable session is a person on the floor. Sessions that owe you a reply leave their desk and wait in the manager's corner office until *you* release them.

## Who uses it

One engineer running 5–15 concurrent Claude Code sessions across many unrelated repositories. They lose sessions: they read a reply, decide to follow up later, and the session is never reopened. The runtime thinks it is done. The user does not.

## Register

`product` — design serves the task. This is a monitoring and dispatch tool, not a marketing surface.

## Platform

`web` (served locally by a Node daemon on 127.0.0.1)

## The one invariant

**User acknowledgement outranks derived runtime state.** `runtime_state` is observed and may change without the user. `ack_state` changes only by explicit user action. The manager's office renders `ack_state`. No code path lets runtime status evict an item from the queue.

## Scene

11pm, low ambient light, six terminals open on the other monitor. The user glances over to see who is waiting. The surface sits beside dark terminals all day and must never glare.

## Color strategy

**Restrained.** Tinted near-black neutrals (chroma pulled toward the accent hue, not toward default warmth) and a single saturated accent — a crimson-rose at ~355° — reserved exclusively for *owes you* and primary actions. Working and snoozed states use calm, desaturated hues. If the accent appears, it means something needs the user.

## Jobs to be done

1. See, in one glance, how many sessions owe me a reply and which has waited longest.
2. Open a session's conversation without leaving the floor, and send it a reply.
3. See what each project is costing me in tokens.
4. Discharge an item deliberately: acknowledge, snooze, or archive.

## Non-goals

- Orchestrating agents. Claude Code owns the runtime.
- A manager agent that assigns work down a hierarchy.
- Deployment.
- Human presence, video, avatars for people.

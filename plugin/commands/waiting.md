---
description: What is waiting on you — every unreviewed, blocked or stalled session on this machine
disable-model-invocation: true
allowed-tools: Bash(node "${CLAUDE_PLUGIN_ROOT}/scripts/waiting.mjs")
---

!`node "${CLAUDE_PLUGIN_ROOT}/scripts/waiting.mjs"`

Show the list above to the user as it is. Keep the order — it is oldest wait
first. Do not re-rank it, do not add advice about what to do first, and do not
say anything about the user's discipline, backlog or habits.

---
description: Open the DeckHQ floor — every agent session on this machine, in one browser tab
disable-model-invocation: true
allowed-tools: Bash(node "${CLAUDE_PLUGIN_ROOT}/scripts/open.mjs")
---

!`node "${CLAUDE_PLUGIN_ROOT}/scripts/open.mjs"`

Report the line above to the user, in one sentence, and stop. Do not open
anything else, do not summarise the floor, and do not offer next steps.

# Changelog

## 0.1.0

First release.

- **`DeckHQ: Open floor`** — the floor in a VS Code panel, loaded from the daemon on
  `127.0.0.1`.
- **The needs-you count in the status bar** — `▣ 3 waiting · 1 hand up`, pushed live from the
  daemon's event stream with a 5-second poll as the fallback. Click it to open the floor.
- **`DeckHQ: Show waiting`** — the queue as a quick pick, oldest first. Enter opens the panel at
  that agent.
- **`DeckHQ: Start daemon` / `DeckHQ: Stop daemon`** — starts one with `npx deckhq --no-open`, or
  whatever `deckhq.startCommand` names.
- No telemetry, no dependencies, and no socket that goes anywhere but `127.0.0.1`.

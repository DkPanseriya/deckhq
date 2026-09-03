/**
 * Moved. The terminal emulator table now lives in `src/core/terminals.mjs`.
 *
 * WP-04 put it here because the spawn discipline belonged beside the adapter
 * that spawns, and left the note in `docs/DEVIATIONS.md` §91: "when a second
 * adapter adopts it, it should move to `src/core/terminals.mjs`". The Codex
 * adapter is that second adapter (§95), so it has moved.
 *
 * Nothing Claude-Code-specific was ever in it, and it imports only node
 * builtins, so it does not invert `02-ARCHITECTURE.md` §2's layering the way
 * `core/` reaching into `adapters/` would.
 *
 * This file stays as a re-export so the two callers outside `src/adapters/`
 * — `src/cli/doctor.mjs` and `src/http/routes/settings.mjs` — keep working
 * untouched. Both were already importing across the adapter boundary, which
 * is the thing the move fixes; repointing them at `src/core/terminals.mjs`
 * and deleting this file is a one-line change for their owner.
 */

export * from '../../core/terminals.mjs';

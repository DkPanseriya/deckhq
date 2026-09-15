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
 * This file stayed as a re-export so the two callers outside `src/adapters/`
 * — `src/cli/doctor-collect.mjs` and `src/http/routes/settings.mjs` — kept
 * working untouched. Both were already importing across the adapter boundary,
 * which is the thing the move fixes.
 *
 * WP-92f (audit finding A-09) repointed the route: a settings sheet listing
 * every terminal id on every platform is asking a question no runtime owns, so
 * it now reads `src/core/terminals.mjs` directly. `doctor-collect.mjs` is the
 * one caller left, and this file lives exactly as long as it does.
 */

export * from '../../core/terminals.mjs';

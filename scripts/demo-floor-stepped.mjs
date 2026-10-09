/**
 * The demo floor, with a clock its parent can step.
 *
 *   child = spawn(node, ['scripts/demo-floor-stepped.mjs', '--now', ISO, ...],
 *                 { stdio: ['ignore', 'pipe', 'pipe', 'ipc'] })
 *   child.send({ now: '2026-09-01T09:00:01.040Z' })   // answered with { at }
 *
 * A recording of the floor is taken one frame at a time, and a frame at twice
 * the size takes far longer to photograph than it lasts. So the recording runs
 * on a clock that moves only when a frame is taken — and the daemon has to be
 * on that clock too, or a turn that ends in the third second of the recording
 * is stamped with whatever the wall said a minute later.
 *
 * Nothing is added to the daemon for this. `src/core/clock.mjs` reads
 * `DECKHQ_NOW` on every call, which is the product's own injected clock; this
 * file is `demo-floor.mjs` with one listener that rewrites that variable when
 * its parent says what time it is. Every flag is `demo-floor.mjs`'s own.
 *
 * Dev script only: `scripts/` is not in the published package.
 */
import process from 'node:process';

import { CLOCK_ENV, parseInstant } from '../src/core/clock.mjs';

process.on('message', (message) => {
  const at = message && typeof message === 'object' ? /** @type {any} */ (message).now : null;
  if (typeof at === 'string' && parseInstant(at) !== null) process.env[CLOCK_ENV] = at;
  if (process.send) process.send({ at: process.env[CLOCK_ENV] });
});

await import('./demo-floor.mjs');

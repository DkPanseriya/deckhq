/**
 * Runtime adapter registry. docs/02-ARCHITECTURE.md §2.
 *
 * Every runtime-specific module lives behind the `RuntimeAdapter` interface;
 * nothing outside src/adapters/ may know a runtime's on-disk format or CLI.
 * Adding a third runtime means adding one entry to `REGISTRY` below — nothing
 * else in this file changes.
 */

import claudeCodeAdapter from './claude-code/adapter.mjs';
import codexAdapter from './codex/adapter.mjs';

const REGISTRY = [claudeCodeAdapter, codexAdapter];

/**
 * Every registered adapter, regardless of availability.
 * @returns {import('../core/model.mjs').RuntimeId extends never ? any : any[]}
 */
export function getAdapters() {
  return REGISTRY.slice();
}

/** @type {any[]|null} */
let availableCache = null;

/**
 * Registered adapters whose `available()` resolves true, cached for the
 * process lifetime. An adapter whose `available()` throws is treated as
 * unavailable rather than failing the whole call.
 * @returns {Promise<any[]>}
 */
export async function availableAdapters() {
  if (availableCache) return availableCache;
  const flags = await Promise.all(
    REGISTRY.map(async (adapter) => {
      try {
        return await adapter.available();
      } catch {
        return false;
      }
    }),
  );
  availableCache = REGISTRY.filter((_adapter, i) => flags[i]);
  return availableCache;
}

/**
 * @param {string} id
 * @returns {any|undefined}
 */
export function getAdapter(id) {
  return REGISTRY.find((adapter) => adapter.id === id);
}

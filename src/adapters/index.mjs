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
import { countCatchphrase } from './claude-code/catchphrase.mjs';

const REGISTRY = [claudeCodeAdapter, codexAdapter];

/**
 * Optional per-runtime capabilities, keyed by adapter id. WP-27.
 *
 * Wrapped's derived stat is a count of one phrase across a window of
 * transcripts, and reading a transcript is adapter work by rule (`08` §1.1
 * rule 8) — so the code lives in `./claude-code/catchphrase.mjs`, inside the
 * adapter, and this table is only how the rest of the product reaches it
 * without importing a runtime-specific path.
 *
 * **It belongs on the adapter object itself**, beside `hooks.toolSummary` and
 * the rest, and it is here instead because `claude-code/adapter.mjs` was held
 * by another package (WP-09) while this one was written. Moving it is one line
 * in each file and no behaviour; `docs/DEVIATIONS.md` §119 records the debt so
 * it is a decision somebody made rather than a shape somebody found.
 *
 * A runtime with no entry simply contributes nothing, which is what Codex does
 * today: its transcripts have a different shape and nobody has measured the
 * phrase in them.
 * @type {Record<string, (o:any) => Promise<any>>}
 */
const CATCHPHRASE_COUNTERS = {
  'claude-code': countCatchphrase,
};

/**
 * Count Wrapped's phrase across every available runtime that can count it.
 *
 * Returns one total plus the per-runtime detail, and `supported: false` when
 * no available runtime can answer — which the card reads as "leave the line
 * out", never as "zero".
 *
 * @param {{since:number, until?:number}} opts
 * @returns {Promise<{supported:boolean, phrase:string, count:number,
 *                    truncated:boolean, files:number, bytes:number, ms:number}>}
 */
export async function catchphraseCount(opts) {
  const out = {
    supported: false,
    phrase: '',
    count: 0,
    truncated: false,
    files: 0,
    bytes: 0,
    ms: 0,
  };
  for (const adapter of await availableAdapters()) {
    const counter = CATCHPHRASE_COUNTERS[adapter.id];
    if (!counter) continue;
    try {
      const r = await counter(opts);
      out.supported = true;
      out.phrase = out.phrase || r.phrase;
      out.count += r.count;
      out.files += r.files;
      out.bytes += r.bytes;
      out.ms += r.ms;
      if (r.truncated) out.truncated = true;
    } catch {
      // A runtime that cannot be read costs the line, never the card.
    }
  }
  return out;
}

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

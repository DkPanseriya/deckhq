/**
 * The rate card: where a cost estimate's numbers come from, and how a user
 * replaces them.
 *
 * WP-26, `docs/plan/01-AUDIT.md` F14. Until this file existed the rates were
 * four hand-typed tiers in the middle of `src/core/model.mjs` — a substring
 * test for "haiku", "sonnet" and "gpt", an opus-priced default for everything
 * else, and no way for anyone to tell when the numbers were last true or to
 * correct them without editing the package. Three things were wrong with that
 * and all three are fixed here:
 *
 *   1. **Nobody could check it.** The numbers are now `src/data/rates.json`,
 *      which carries the URL they were read from and the date they were read.
 *      Every display that shows a cost shows that date beside it, so a figure
 *      nobody can verify is at least a figure whose source is dated.
 *   2. **Nobody could correct it.** `~/.deckhq/rates.json` merges over the
 *      built-in table, entry by entry, and is picked up on its next mtime
 *      change — no restart. A user on a negotiated rate, a different currency,
 *      or a model this table has never heard of edits one file.
 *   3. **An unknown model was priced as Opus.** It is now priced as nothing:
 *      `estimateCost` returns `null`, every display says "no rate", and no
 *      invented number is summed into a project total. A wrong number is worse
 *      than no number, because a wrong number is actionable.
 *
 * ## Rule 7 is the whole point
 *
 * `08` §1.1 rule 7: **cost is an estimate, never a bill.** Nothing in this file
 * knows what the user's plan charges — a subscription, a negotiated rate, a
 * free tier, a monthly cap. It multiplies observed tokens by a published list
 * price so two projects can be compared with each other, and that is all it
 * claims. Every string this module produces carries "list price" and the rate
 * card's date, and `test/unit/rates.test.mjs` asserts that no display string
 * anywhere in the product says "bill" without "not a" in front of it.
 *
 * ## Why the loader is here and not in `model.mjs`
 *
 * `model.mjs` is the contract every other module imports and its header
 * promises "no I/O". A rate card that is read from disk and reloaded when the
 * file changes is I/O by definition, so `estimateCost` and the rate card
 * version moved out of `model.mjs` and into this file. The pure half — prefix
 * matching, the merge, the arithmetic — is still pure and still exported
 * separately, so the tests never touch a disk they did not create.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { DATA_DIR } from './paths.mjs';

/** The table that ships in the package. In `files` via `src/`. */
export const BUILTIN_RATES_FILE = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'data',
  'rates.json',
);

/** The user's overrides, beside their state. Optional, and usually absent. */
export const OVERRIDE_RATES_FILE = path.join(DATA_DIR, 'rates.json');

/** Rates are quoted per this many tokens unless an entry says otherwise. */
export const DEFAULT_PER = 1e6;

/**
 * How long a loaded card is trusted before the files are stat'd again.
 *
 * A scan prices every session it saw, so `estimateCost` is called hundreds of
 * times in a burst; stat'ing two files per call would be two syscalls per
 * session per scan for a number that changes when a human edits a file. One
 * second is far below "without a restart" and far above the burst.
 */
export const RECHECK_MS = 1000;

/**
 * What a cost estimate is shown as when the model has no entry in the table.
 * Not `$0.00`: zero is a claim about the money, and we do not have one.
 */
export const NO_RATE = 'no rate';

/**
 * Prefixes a provider or a gateway puts in front of a model id that are not
 * part of the model's own name. Bedrock ships `us.anthropic.claude-opus-5…`
 * and Vertex ships `claude-opus-5@20260101`; neither is a different model and
 * neither should fall off the table.
 */
const ID_PREFIXES = [
  'us.',
  'eu.',
  'apac.',
  'global.',
  'anthropic.',
  'anthropic/',
  'openai/',
  'bedrock/',
  'vertex_ai/',
  'azure/',
];

/**
 * A model id reduced to the thing a `match` is a prefix of.
 *
 * Lower-cased, provider prefixes peeled off (repeatedly — Bedrock's is two of
 * them), and everything from an `@` version separator dropped. Nothing else:
 * a normalisation that rewrote the id would be a second, invisible matching
 * rule on top of the one the table states.
 *
 * @param {string|null|undefined} model
 * @returns {string}
 */
export function normaliseModelId(model) {
  let id = String(model ?? '')
    .trim()
    .toLowerCase();
  let changed = true;
  while (changed) {
    changed = false;
    for (const p of ID_PREFIXES) {
      if (id.startsWith(p)) {
        id = id.slice(p.length);
        changed = true;
      }
    }
  }
  const at = id.indexOf('@');
  return at >= 0 ? id.slice(0, at) : id;
}

/** @param {unknown} n */
function num(n) {
  const v = Number(n);
  return Number.isFinite(v) ? v : null;
}

/**
 * One validated row. Returns null for a row that cannot be priced with —
 * a row with no `match` or no input/output price is not a rate, and silently
 * treating it as zero is exactly the invented number this package removes.
 *
 * `cacheRead` and `cacheWrite` may be omitted. They fall back to Anthropic's
 * published multipliers (0.1x input for a hit, 1.25x for a 5-minute write),
 * which is what makes a one-line override — `{"match":"my-model","input":4,
 * "output":20}` — a usable override rather than one that silently prices
 * every cached token at zero.
 *
 * @param {any} row
 * @returns {{match:string,input:number,output:number,cacheRead:number,cacheWrite:number,per:number,unverified:boolean}|null}
 */
export function normaliseRate(row) {
  if (!row || typeof row !== 'object') return null;
  const match = String(row.match ?? '')
    .trim()
    .toLowerCase();
  if (!match) return null;
  const input = num(row.input);
  const output = num(row.output);
  if (input == null || output == null) return null;
  const per = num(row.per);
  return {
    match,
    input,
    output,
    cacheRead: num(row.cacheRead) ?? input * 0.1,
    cacheWrite: num(row.cacheWrite) ?? input * 1.25,
    per: per && per > 0 ? per : DEFAULT_PER,
    unverified: row.unverified === true,
  };
}

/**
 * Parse and validate a rate card document. Never throws: a malformed card is
 * an empty card with a reason attached, because a bad `~/.deckhq/rates.json`
 * must cost the user their overrides and nothing else.
 *
 * @param {any} doc
 * @returns {{version:string, source:string, retrievedAt:string, rates:ReturnType<typeof normaliseRate>[], error:string|null}}
 */
export function parseRateCard(doc) {
  const out = {
    version: '',
    source: '',
    retrievedAt: '',
    /** @type {any[]} */ rates: [],
    /** @type {string|null} */ error: null,
  };
  if (!doc || typeof doc !== 'object') {
    out.error = 'not an object';
    return out;
  }
  out.version = typeof doc.version === 'string' ? doc.version.trim() : '';
  out.source = typeof doc.source === 'string' ? doc.source : '';
  out.retrievedAt = typeof doc.retrievedAt === 'string' ? doc.retrievedAt : '';
  if (!Array.isArray(doc.rates)) {
    out.error = 'rates is not an array';
    return out;
  }
  for (const row of doc.rates) {
    const rate = normaliseRate(row);
    if (rate) out.rates.push(rate);
  }
  return out;
}

/**
 * The user's card merged over the package's, entry by entry.
 *
 * MERGE, not replace: an override naming one model changes that model's price
 * and leaves every other row alone. A row that matches an existing `match`
 * replaces it in place — so the table keeps its order and longest-prefix
 * matching is unaffected — and a row with a new `match` is appended.
 *
 * The version the user sees is the override's own `version` when it declares
 * one, and otherwise the built-in version with `+local` on it. Both are
 * honest: a user who dates their table gets their date, and a user who does
 * not still gets told the figure in front of them is not the shipped table.
 *
 * @param {ReturnType<typeof parseRateCard>} base
 * @param {ReturnType<typeof parseRateCard>|null} override
 */
export function mergeRateCards(base, override) {
  if (!override || (override.rates.length === 0 && !override.version)) {
    return { ...base, rates: [...base.rates], overridden: false };
  }
  const rates = [...base.rates];
  for (const row of override.rates) {
    const i = rates.findIndex((r) => r.match === row.match);
    if (i >= 0) rates[i] = row;
    else rates.push(row);
  }
  return {
    ...base,
    rates,
    version: override.version || `${base.version}+local`,
    overridden: true,
  };
}

/**
 * The row whose `match` is the longest prefix of this model id, or null.
 *
 * LONGEST WINS, and that is the entire disambiguation rule: `claude-haiku-4-5`
 * beats `claude-haiku`, and `claude-3-5-haiku` beats neither because it is not
 * a prefix of them. It is stated once, here, so a table can be read top to
 * bottom without also having to be read in order.
 *
 * @param {string|null|undefined} model
 * @param {{match:string}[]} rates
 */
export function matchRate(model, rates) {
  const id = normaliseModelId(model);
  if (!id) return null;
  let best = null;
  for (const rate of rates || []) {
    if (!id.startsWith(rate.match)) continue;
    if (!best || rate.match.length > best.match.length) best = rate;
  }
  return best;
}

/**
 * USD for one usage breakdown at one row's prices. Pure arithmetic.
 * @param {{input?:number,output?:number,cacheRead?:number,cacheWrite?:number}} usage
 * @param {{input:number,output:number,cacheRead:number,cacheWrite:number,per:number}} rate
 */
export function costOf(usage, rate) {
  const { input = 0, output = 0, cacheRead = 0, cacheWrite = 0 } = usage || {};
  const usd =
    ((input || 0) * rate.input +
      (output || 0) * rate.output +
      (cacheRead || 0) * rate.cacheRead +
      (cacheWrite || 0) * rate.cacheWrite) /
    rate.per;
  return Math.round(usd * 10000) / 10000;
}

// ---------------------------------------------------------------------------
// Loading, and the hot reload
// ---------------------------------------------------------------------------

/** @type {Map<string, {card:any, checkedAt:number, stamps:string}>} */
const CACHE = new Map();

/**
 * `mtimeMs:size` for a file, or `''` when it is not there. Both, not just the
 * mtime: a filesystem whose mtime resolution is coarse (which is every
 * filesystem, at some granularity) can hand back the same timestamp for two
 * edits a few milliseconds apart, and the size catches the common case of
 * those two edits differing in length.
 * @param {string} file
 */
function stamp(file) {
  try {
    const st = fs.statSync(file);
    return `${st.mtimeMs}:${st.size}`;
  } catch {
    return '';
  }
}

/** @param {string} file */
function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * The rate card in force right now.
 *
 * Cached, and re-read when either file's mtime or size moves — which is what
 * WP-26's "a user override takes effect without a restart" means in practice.
 * The check is throttled to `RECHECK_MS` so a scan pricing two hundred
 * sessions does not stat two files four hundred times; pass `maxAgeMs: 0` to
 * force the check, which is what the hot-reload test does.
 *
 * Never throws. A missing built-in table is an empty table, which prices
 * nothing and says "no rate" — the same honest answer an unknown model gets.
 *
 * @param {{builtinFile?:string, overrideFile?:string, maxAgeMs?:number, now?:number}} [opts]
 */
export function loadRateCard(opts = {}) {
  const builtinFile = opts.builtinFile || BUILTIN_RATES_FILE;
  const overrideFile = opts.overrideFile || OVERRIDE_RATES_FILE;
  const maxAgeMs = opts.maxAgeMs ?? RECHECK_MS;
  const now = opts.now ?? Date.now();
  const key = `${builtinFile} ${overrideFile}`;

  const cached = CACHE.get(key);
  if (cached && now - cached.checkedAt < maxAgeMs) return cached.card;

  const stamps = `${stamp(builtinFile)}|${stamp(overrideFile)}`;
  if (cached && cached.stamps === stamps) {
    cached.checkedAt = now;
    return cached.card;
  }

  const base = parseRateCard(readJson(builtinFile));
  const rawOverride = readJson(overrideFile);
  const override = rawOverride == null ? null : parseRateCard(rawOverride);
  const card = mergeRateCards(base, override);
  card.builtinFile = builtinFile;
  card.overrideFile = overrideFile;
  // Say so rather than quietly pricing with half a table.
  card.overrideError = override && override.error ? override.error : null;

  CACHE.set(key, { card, checkedAt: now, stamps });
  return card;
}

/** Drop every cached card. For tests, and for nothing else. */
export function clearRateCardCache() {
  CACHE.clear();
}

/**
 * The dated version string every cost display carries.
 * @param {Parameters<typeof loadRateCard>[0]} [opts]
 */
export function rateCardVersion(opts) {
  return loadRateCard(opts).version || 'unknown';
}

/**
 * List-price estimate, in USD, for comparing projects. NEVER a bill.
 *
 * Returns `null` — not `0` — when the model has no row in the table. A caller
 * that must have a number writes `?? 0` and knows it is doing so; a display
 * shows `NO_RATE`.
 *
 * @param {{input?:number,output?:number,cacheRead?:number,cacheWrite?:number,model?:string|null}} usage
 * @param {Parameters<typeof loadRateCard>[0]} [opts]
 * @returns {number|null}
 */
export function estimateCost(usage, opts) {
  const card = loadRateCard(opts);
  const rate = matchRate(usage?.model, card.rates);
  if (!rate) return null;
  return costOf(usage || {}, rate);
}

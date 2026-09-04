/**
 * GET  /api/rates   the rate card, both halves, and where the user's lives
 * POST /api/rates   write the user's half
 *
 * WP-45's rate-card editor, and free.
 *
 * ============================================================================
 * WHY THIS IS NOT IN THE SUPPORTER PACK
 *
 * `docs/plan/08-PLAN-V2-100X.md` §5 and `03-BUSINESS-MODEL.md` §5 both list a
 * rate-card editor among the pack's contents. It ships free instead, for the
 * same reason floor replay does (`src/core/replay.mjs`'s header), plus one
 * that is specific to this file.
 *
 * `~/.deckhq/rates.json` already exists. WP-26 shipped it (`docs/DEVIATIONS.md`
 * §111): a user on a negotiated rate, a different currency, or a model the
 * shipped table has never heard of edits that file today, in any text editor,
 * for free. Selling a SHEET that edits a file the product already reads would
 * not be selling a feature; it would be charging for the absence of an
 * inconvenience we put there. That is the "gate with extra steps" shape rule 2
 * exists to refuse.
 *
 * And there is a correctness argument on top of the principle. Rule 7: *cost
 * is an estimate, never a bill.* The whole defence of the cost line is that
 * the user can see which dated table it came from and correct it. Putting the
 * correction behind a payment would leave the unpaid user looking at a number
 * they can see is wrong and cannot fix, which is worse than showing them no
 * number at all.
 * ============================================================================
 *
 * ## What the editor can and cannot do
 *
 * It writes ONE file: the override card beside the user's state. It never
 * touches `src/data/rates.json` — the shipped table is the package's, is
 * dated, carries the URL it was read from, and stays the thing a user's
 * overrides are compared against. A row here MERGES over the built-in table
 * entry by entry (`mergeRateCards`), so correcting one model leaves every
 * other price alone.
 *
 * Nothing in this route makes a network call. There is no "fetch the latest
 * prices" button and there will not be one: the free core makes no outbound
 * request, ever (`08` §1.1 rule 2), and a rate card that updated itself would
 * be a rate card nobody could pin a screenshot to.
 */
import fs from 'node:fs';
import path from 'node:path';

import { readJson, sendError, sendJson } from '../server.mjs';
import {
  BUILTIN_RATES_FILE,
  OVERRIDE_RATES_FILE,
  clearRateCardCache,
  loadRateCard,
  normaliseRate,
  parseRateCard,
} from '../../core/rates.mjs';

/** Most override rows one card may carry. A user is correcting models, not writing a price list. */
export const MAX_OVERRIDE_ROWS = 200;

/** What a `match` may look like. It is compared as a prefix of a model id, never opened. */
const MATCH_RE = /^[a-z0-9][a-z0-9._/-]{0,79}$/;

/** @param {string} file */
function readJsonFile(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * One row, as the editor writes it back. Only the five numbers and the match:
 * a row that carried anything else would be a row the loader ignores, which
 * is a row that lies about what it does.
 * @param {any} row
 */
function rowOut(row) {
  return {
    match: row.match,
    input: row.input,
    output: row.output,
    cacheRead: row.cacheRead,
    cacheWrite: row.cacheWrite,
    per: row.per,
    unverified: row.unverified === true,
  };
}

/**
 * @param {import('../server.mjs').Router} router
 * @param {{log:any, ratesFile?:string}} ctx
 */
export function register(router, ctx) {
  const overrideFile = ctx.ratesFile || OVERRIDE_RATES_FILE;

  router.get('/api/rates', (_req, res) => {
    const builtin = parseRateCard(readJsonFile(BUILTIN_RATES_FILE));
    const raw = readJsonFile(overrideFile);
    const override = raw == null ? null : parseRateCard(raw);
    const card = loadRateCard({ overrideFile, maxAgeMs: 0 });
    sendJson(res, 200, {
      // Where the two halves are, said out loud: the settings sheet shows the
      // path so a user who would rather edit the file can find it.
      builtinFile: BUILTIN_RATES_FILE,
      overrideFile,
      // The shipped table, so the editor can offer "start from this row"
      // rather than making the user retype a price they only want to nudge.
      builtin: {
        version: builtin.version,
        source: builtin.source,
        retrievedAt: builtin.retrievedAt,
        rates: builtin.rates.map(rowOut),
      },
      override: {
        present: raw != null,
        version: override?.version || '',
        error: override?.error || null,
        rates: (override?.rates || []).map(rowOut),
      },
      // What the cost line is actually quoting right now.
      version: card.version || 'unknown',
      overridden: card.overridden === true,
    });
  });

  router.post('/api/rates', async (req, res) => {
    let body;
    try {
      body = await readJson(req);
    } catch (err) {
      return sendError(res, 400, err.message);
    }
    if (!body || typeof body !== 'object') return sendError(res, 400, 'expected an object');

    const rows = Array.isArray(body.rates) ? body.rates : null;
    if (!rows) return sendError(res, 400, 'rates must be an array');
    if (rows.length > MAX_OVERRIDE_ROWS) {
      return sendError(res, 400, `a rate card override holds at most ${MAX_OVERRIDE_ROWS} rows`);
    }

    // Refused whole, with the row named — the same discipline `validateLayout`
    // applies to an imported layout. A card that half-applied would leave the
    // user unable to tell which prices are theirs.
    /** @type {any[]} */
    const clean = [];
    const seen = new Set();
    for (const [i, raw] of rows.entries()) {
      if (!raw || typeof raw !== 'object')
        return sendError(res, 400, `row ${i + 1} is not an object`);
      const match = String(raw.match ?? '')
        .trim()
        .toLowerCase();
      if (!MATCH_RE.test(match)) {
        return sendError(
          res,
          400,
          `row ${i + 1}: "match" is a model id or a prefix of one — lower-case letters, digits, . _ / or -`,
        );
      }
      if (seen.has(match)) return sendError(res, 400, `row ${i + 1}: "${match}" appears twice`);
      seen.add(match);
      for (const key of ['input', 'output', 'cacheRead', 'cacheWrite', 'per']) {
        if (raw[key] === undefined || raw[key] === null || raw[key] === '') continue;
        const n = Number(raw[key]);
        if (!Number.isFinite(n) || n < 0) {
          return sendError(res, 400, `row ${i + 1}: "${key}" must be a number of 0 or more`);
        }
        if (key === 'per' && n === 0) {
          return sendError(
            res,
            400,
            `row ${i + 1}: "per" is how many tokens the price is for, and cannot be 0`,
          );
        }
      }
      const normalised = normaliseRate({ ...raw, match });
      if (!normalised) {
        return sendError(
          res,
          400,
          `row ${i + 1}: a rate needs an "input" and an "output" price. A row without both is not a rate, ` +
            'and pricing its tokens at zero would be an invented number.',
        );
      }
      clean.push(normalised);
    }

    // No rows and no version is not an empty card, it is NO card: the file is
    // removed and the product goes back to the shipped table. Writing
    // `{"rates":[]}` instead would leave a file behind that says nothing and
    // makes `overridden` true for ever.
    const version = typeof body.version === 'string' ? body.version.trim().slice(0, 64) : '';
    try {
      if (clean.length === 0 && !version) {
        fs.rmSync(overrideFile, { force: true });
        clearRateCardCache();
        return sendJson(res, 200, { ok: true, removed: true, file: overrideFile, rates: [] });
      }
      const doc = {
        version,
        source: 'edited in DeckHQ',
        retrievedAt: new Date().toISOString().slice(0, 10),
        rates: clean.map(rowOut),
      };
      fs.mkdirSync(path.dirname(overrideFile), { recursive: true });
      fs.writeFileSync(overrideFile, `${JSON.stringify(doc, null, 2)}\n`, 'utf8');
    } catch (err) {
      ctx.log.warn('rate card write failed', err.message);
      return sendError(res, 500, `could not write ${overrideFile}: ${err.message}`);
    }

    // The loader caches for a second; a user who just pressed Save must see
    // their own number, not the one from before they pressed it.
    clearRateCardCache();
    const card = loadRateCard({ overrideFile, maxAgeMs: 0 });
    sendJson(res, 200, {
      ok: true,
      removed: false,
      file: overrideFile,
      version: card.version,
      rates: clean.map(rowOut),
    });
  });
}

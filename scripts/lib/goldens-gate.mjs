/**
 * The goldens gate's VERDICT, separated from the browser that takes the pictures.
 *
 * `scripts/goldens.mjs` needs Chrome, a demo daemon and about a minute per
 * capture, so the rule it applies at the end — which captures matched, which
 * have no golden on this platform yet, which actually disagree with one — was
 * never reachable from a test. It is the rule that was wrong: a capture with no
 * golden was a FAILURE whenever the platform directory existed at all, so the
 * partial linux set (6 of 16) made the ubuntu job red on every push for a
 * reason that had nothing to do with a pixel. DEVIATIONS §180, audit finding
 * A-01, and §87's own argument — *a red build on a missing browser teaches
 * people to ignore the gate* — applies to a missing golden exactly.
 *
 * So there are THREE outcomes, not two:
 *
 *   - `match`   — a golden exists and the capture agrees with it.
 *   - `missing` — no golden for this capture on this platform. NOT YET BAKED:
 *                 named in the summary, exit 0, because nothing about the floor
 *                 has been proved or disproved by a photograph with nothing to
 *                 compare against. The capture is left in `test/goldens/.out/`,
 *                 which is what CI uploads, which is how the set gets baked.
 *   - `fail`    — a golden exists and the capture disagrees, or is a different
 *                 size. This, and only this, is red.
 *
 * `--strict` is the other half: it says *this platform's set is meant to be
 * complete*, so a missing golden becomes a named non-zero exit. That is the
 * flag the bake package turns on once the ten linux goldens are committed, and
 * it is what keeps the third outcome from becoming a hole anybody can hide in.
 *
 * @typedef {'match'|'missing'|'fail'} Outcome
 * @typedef {{name:string, outcome:Outcome}} CaptureVerdict
 */

/** A capture disagreed with its committed golden. The only red the gate has. */
export const EXIT_MISMATCH = 1;
/** `--strict` was asked for and the platform's set is not complete. */
export const EXIT_NOT_BAKED = 2;

/**
 * Decide what a run of the gate means.
 *
 * Captures that could not be TAKEN at all — no browser, a demo that would not
 * boot, a deadline — are not passed in here; they are `unproven`, they prove
 * nothing either way, and `goldens.mjs` reports them separately (§87, §114,
 * §126.3). This function only ever sees captures that produced a picture.
 *
 * @param {CaptureVerdict[]} verdicts one per capture that was photographed
 * @param {{strict?:boolean, platform?:string}} [options]
 * @returns {{matched:string[], missing:string[], failed:string[], ok:boolean,
 *            exitCode:number, headline:string}}
 */
export function decide(verdicts, { strict = false, platform = 'this platform' } = {}) {
  /** @type {string[]} */ const matched = [];
  /** @type {string[]} */ const missing = [];
  /** @type {string[]} */ const failed = [];
  for (const { name, outcome } of verdicts) {
    if (outcome === 'fail') failed.push(name);
    else if (outcome === 'missing') missing.push(name);
    else matched.push(name);
  }

  const total = verdicts.length;
  const exitCode = failed.length ? EXIT_MISMATCH : missing.length && strict ? EXIT_NOT_BAKED : 0;

  let headline;
  if (failed.length) {
    headline = `${failed.length} of ${total} failed (${failed.join(', ')})`;
  } else if (!missing.length) {
    headline = `all ${matched.length} match`;
  } else {
    const baked = `${missing.length} of ${total} NOT YET BAKED on ${platform} (${missing.join(', ')})`;
    // With nothing matched there is nothing to compare against at all — which
    // is the state a platform with no set is in, and the state `--only` puts a
    // single unbaked capture in. Say that, rather than a green line CI would
    // read as protection it does not have. The names go LAST, because the
    // caller appends the elapsed time to this line.
    const head = matched.length
      ? `${matched.length} match, ${baked}`
      : `nothing to compare against — ${baked}`;
    headline = strict ? `--strict wants a complete set: ${head}` : head;
  }

  return { matched, missing, failed, ok: exitCode === 0, exitCode, headline };
}

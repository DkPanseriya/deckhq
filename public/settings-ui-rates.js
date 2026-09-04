/**
 * WP-45's rate-card editor (WP-22 follow-up).
 *
 * Split out of `createSettingsUI()` unchanged, comment for comment — the
 * argument for why this sheet is FREE is in the block below and is the whole
 * reason the editor exists.
 */

import { MAX_RATE_ROWS } from './settings-ui.js';

/**
 * @param {{toast: (m:string, o?:{isError?:boolean}) => void}} ctx
 */
export function createRatesSection(ctx) {
  const { toast } = ctx;
  /** Late-bound: the sheet's re-render (docs/DEVIATIONS.md §122, rule 3). */
  let render;

  // --------------------------------------------------- the rate-card editor
  //
  // WP-45, and FREE — `src/http/routes/rates.mjs` carries the argument. The
  // short version: `~/.deckhq/rates.json` has existed since WP-26 and anybody
  // can edit it in a text editor, so selling a sheet that edits it would be
  // charging for the removal of an inconvenience we put there. And rule 7 —
  // cost is an estimate, never a bill — only holds if the person looking at a
  // wrong number can correct it.
  //
  // Prices are edited PER MILLION TOKENS in this sheet, whatever `per` the
  // file says, because one unit means one column heading and a table with two
  // scales in it is a table nobody can read. A loaded row quoted per some
  // other unit is converted for display and written back per million; that is
  // arithmetic, not a change of meaning, and it is the only rewriting this
  // editor does.

  /** @type {any} the last `/api/rates` response */
  let rateCard = null;
  /** @type {any[]|null} the rows being edited, kept across re-renders */
  let rateDraft = null;
  /** Has anything been typed since the last load or save? */
  let rateDirty = false;
  /** @type {string} what the last save said, shown under the table */
  let rateStatus = '';

  const PER_MILLION = 1e6;

  /** One override row as the editor holds it: strings, because inputs are. */
  function toDraft(rate) {
    const per = Number(rate.per) > 0 ? Number(rate.per) : PER_MILLION;
    const scale = PER_MILLION / per;
    /** @param {unknown} n */
    const at = (n) =>
      n == null || n === '' ? '' : String(Math.round(Number(n) * scale * 1e6) / 1e6);
    return {
      match: String(rate.match || ''),
      input: at(rate.input),
      output: at(rate.output),
      cacheRead: at(rate.cacheRead),
      cacheWrite: at(rate.cacheWrite),
    };
  }

  async function loadRates() {
    try {
      const res = await fetch('/api/rates');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      rateCard = await res.json();
      rateDraft = (rateCard.override.rates || []).map(toDraft);
      rateDirty = false;
    } catch (err) {
      rateCard = null;
      rateDraft = null;
      console.debug('[deckhq] could not read /api/rates', err);
    }
  }

  async function saveRates() {
    const rows = (rateDraft || [])
      // A row with nothing typed in it is not an error, it is a row somebody
      // added and changed their mind about. Dropped, silently, on save.
      .filter((r) => r.match.trim() || r.input.trim() || r.output.trim())
      .map((r) => ({
        match: r.match.trim().toLowerCase(),
        input: r.input.trim() === '' ? null : Number(r.input),
        output: r.output.trim() === '' ? null : Number(r.output),
        cacheRead: r.cacheRead.trim() === '' ? undefined : Number(r.cacheRead),
        cacheWrite: r.cacheWrite.trim() === '' ? undefined : Number(r.cacheWrite),
        per: PER_MILLION,
      }));
    try {
      const res = await fetch('/api/rates', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ version: rateCard?.override?.version || '', rates: rows }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
      rateStatus = body.removed
        ? 'Your overrides were removed. Costs are quoted from the shipped table again.'
        : `Saved. Costs are now quoted from “${body.version}”.`;
      await loadRates();
      // The cost line on the floor and in the panel reads the rate card the
      // daemon holds, and the daemon re-reads the file within a second — so
      // there is nothing to push here, only something to say.
      toast(rateStatus);
      render();
    } catch (err) {
      toast(`That rate card was refused: ${err.message}`, { isError: true });
    }
  }

  /**
   * @param {HTMLElement} host
   */
  function renderRateEditor(host) {
    if (!rateCard) return;
    const wrap = document.createElement('div');
    wrap.className = 'settings-rates';

    const note = document.createElement('p');
    note.className = 'settings-note';
    note.textContent =
      'Your own prices, in US dollars per million tokens. A row here replaces one model’s ' +
      'price and leaves every other one alone; “match” is a model id or the start of one, and ' +
      'the longest match wins. Leave the two cache columns empty to use the published ' +
      'multipliers. This is still an estimate and never a bill.';
    wrap.appendChild(note);

    const path = document.createElement('p');
    path.className = 'settings-note mono';
    path.textContent = rateCard.overrideFile;
    wrap.appendChild(path);

    if (rateCard.override.error) {
      const bad = document.createElement('p');
      bad.className = 'settings-note is-error';
      bad.textContent = `That file could not be read as a rate card (${rateCard.override.error}), so nothing in it is being used. Saving here replaces it.`;
      wrap.appendChild(bad);
    }

    const table = document.createElement('div');
    table.className = 'settings-rate-table';
    table.setAttribute('role', 'group');
    table.setAttribute('aria-label', 'Rate card overrides');

    const head = document.createElement('div');
    head.className = 'settings-rate-row is-head';
    for (const label of ['Model', 'In', 'Out', 'Cache read', 'Cache write', '']) {
      const cell = document.createElement('span');
      cell.textContent = label;
      head.appendChild(cell);
    }
    table.appendChild(head);

    // The shipped table's ids, offered as completions. A user correcting a
    // price almost always wants a model the built-in card already names, and
    // retyping `claude-opus-5` from memory is how a typo becomes a silently
    // unmatched row.
    const list = document.createElement('datalist');
    list.id = 'settings-rate-models';
    for (const rate of rateCard.builtin.rates || []) {
      const opt = document.createElement('option');
      opt.value = rate.match;
      list.appendChild(opt);
    }
    wrap.appendChild(list);

    (rateDraft || []).forEach((draft, i) => {
      const line = document.createElement('div');
      line.className = 'settings-rate-row';

      const match = document.createElement('input');
      match.type = 'text';
      match.className = 'settings-input mono';
      match.value = draft.match;
      match.placeholder = 'claude-opus-5';
      match.setAttribute('aria-label', `Model for row ${i + 1}`);
      match.setAttribute('list', 'settings-rate-models');
      match.addEventListener('input', () => {
        draft.match = match.value;
        rateDirty = true;
      });
      line.appendChild(match);

      for (const key of ['input', 'output', 'cacheRead', 'cacheWrite']) {
        const field = document.createElement('input');
        field.type = 'number';
        field.min = '0';
        field.step = '0.01';
        field.className = 'settings-input';
        field.value = draft[key];
        field.setAttribute('aria-label', `${key} price for row ${i + 1}`);
        if (key === 'cacheRead' || key === 'cacheWrite') {
          const base = Number(draft.input);
          // The placeholder is the number that WILL be used if this is left
          // empty, not a hint: a blank cache column is a real price.
          field.placeholder = Number.isFinite(base)
            ? String(Math.round(base * (key === 'cacheRead' ? 0.1 : 1.25) * 1e4) / 1e4)
            : 'auto';
        }
        field.addEventListener('input', () => {
          draft[key] = field.value;
          rateDirty = true;
        });
        line.appendChild(field);
      }

      const drop = document.createElement('button');
      drop.type = 'button';
      drop.className = 'settings-rate-drop';
      drop.textContent = 'Remove';
      drop.setAttribute('aria-label', `Remove row ${i + 1}`);
      drop.addEventListener('click', () => {
        rateDraft?.splice(i, 1);
        rateDirty = true;
        render();
      });
      line.appendChild(drop);
      table.appendChild(line);
    });

    wrap.appendChild(table);

    const actions = document.createElement('div');
    actions.className = 'settings-rate-actions';

    const add = document.createElement('button');
    add.type = 'button';
    add.className = 'settings-btn';
    add.textContent = 'Add a price';
    add.disabled = (rateDraft || []).length >= MAX_RATE_ROWS;
    add.addEventListener('click', () => {
      rateDraft = rateDraft || [];
      rateDraft.push({ match: '', input: '', output: '', cacheRead: '', cacheWrite: '' });
      rateDirty = true;
      render();
    });

    const save = document.createElement('button');
    save.type = 'button';
    save.className = 'settings-btn is-primary';
    save.textContent = rateDirty ? 'Save prices' : 'Saved';
    save.disabled = !rateDirty;
    save.addEventListener('click', () => saveRates());

    actions.append(add, save);
    wrap.appendChild(actions);

    if (rateCard.overridden) {
      const state = document.createElement('p');
      state.className = 'settings-note';
      state.textContent = `Every cost on the floor is currently quoted from “${rateCard.version}”.`;
      wrap.appendChild(state);
    }

    host.appendChild(wrap);
  }

  return {
    renderRateEditor,
    loadRates,
    wire: (o) => {
      ({ render } = o);
    },
  };
}

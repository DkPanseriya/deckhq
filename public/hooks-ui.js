/**
 * DeckHQ hook consent screen.
 *
 * docs/02-ARCHITECTURE.md §4.1, §6; docs/04-BUILD-PLAN.md WP5 copy, WP11.
 *
 * WP-07 moved this out of a dialog of its own and into a section of the
 * settings sheet (docs/plan/05-GUI-UX-SPEC.md §5.4): "do I let DeckHQ write
 * to my Claude settings file" is a setting, and it was the third-last button
 * left in a header that is now a headline. Nothing about the consent contract
 * changed — the literal file path and the literal JSON block are still shown
 * before anything is written, and the install call still carries an explicit
 * `{ consent: true }` that only a click on that button can produce. This
 * component now renders into whatever element it is handed.
 *
 * Shows, per runtime, the literal JSON that would be written and the exact
 * absolute file it would land in — verbatim from `plan.file` and
 * `plan.json` — before any install. No installation happens without an
 * explicit click, and the install call always sends `{ consent: true }`.
 *
 * All daemon-provided strings (file paths, JSON text, event names, error
 * messages) are rendered with `textContent`, never `innerHTML`.
 */

const GAIN_COPY =
  'With hooks installed, DeckHQ knows exact, instant state the moment it changes — ' +
  'no polling delay. Two states become distinguishable that otherwise are not: ' +
  '"stalled" (gone quiet) and "hands up" (blocked on a question).';

const LOSS_COPY =
  'Without hooks, state is inferred by periodically re-reading the transcript. ' +
  '"Stalled" and "hands up" are not detectable at all in that mode — DeckHQ will ' +
  'say so plainly in the header rather than guessing.';

/** How long to wait before "no events yet" is worth mentioning at all. */
const QUIET_HOOK_MS = 10 * 60 * 1000;

/** @param {number} ms */
function ago(ms) {
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

/**
 * Whether hooks are demonstrably delivering, and what to say about it.
 *
 * "Installed" describes a settings file, not delivery. A wrong port is caught
 * exactly (the daemon compares them), but a hook blocked by a security tool or
 * a missing `node` on PATH looks identical to a working one from here. So the
 * screen reports what it actually knows: how many events arrived, and when the
 * last one did.
 *
 * @param {any} adapter
 * @returns {string|null}
 */
function deliveryNote(adapter) {
  if (!adapter.installed) return null;
  const seen = Number(adapter.eventsSeen || 0);
  if (seen > 0) {
    const last = Number(adapter.lastEventAt || 0);
    return `Receiving events — ${seen} so far, most recent ${ago(Date.now() - last)}.`;
  }
  const up = Date.now() - Number(adapter.daemonStartedAt || Date.now());
  if (up < QUIET_HOOK_MS) return 'Installed. Waiting for the first event.';
  return (
    'Installed, but no hook events have arrived since DeckHQ started. If sessions are ' +
    'running, something is stopping the hook from reaching this machine — check that ' +
    '`node` is on the PATH Claude Code runs with.'
  );
}

/**
 * @param {object} opts
 * @param {(message:string, opts?:{isError?:boolean}) => void} opts.toast
 */
export function createHooksUI(opts) {
  const { toast } = opts;
  /** @type {HTMLElement|null} where this screen currently draws itself */
  let bodyEl = null;
  let loading = false;

  /** Fetch GET /api/hooks and render the whole section from scratch. */
  async function load() {
    if (loading || !bodyEl) return;
    loading = true;
    bodyEl.textContent = '';
    const loadingMsg = document.createElement('p');
    loadingMsg.textContent = 'Loading…';
    bodyEl.appendChild(loadingMsg);
    try {
      const res = await fetch('/api/hooks');
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
      renderAdapters(body.adapters || []);
    } catch (err) {
      bodyEl.textContent = '';
      const errEl = document.createElement('p');
      errEl.className = 'hooks-error';
      errEl.textContent = `Could not load hook status: ${err.message}`;
      bodyEl.appendChild(errEl);
    } finally {
      loading = false;
    }
  }

  /** @param {any[]} adapters */
  function renderAdapters(adapters) {
    bodyEl.textContent = '';
    if (adapters.length === 0) {
      const p = document.createElement('p');
      p.textContent = 'No runtimes registered.';
      bodyEl.appendChild(p);
      return;
    }
    for (const adapter of adapters) {
      bodyEl.appendChild(renderRuntime(adapter));
    }
  }

  /** @param {any} adapter */
  function renderRuntime(adapter) {
    const section = document.createElement('div');
    section.className = 'hooks-runtime';

    const head = document.createElement('div');
    head.className = 'hooks-runtime-head';
    const h3 = document.createElement('h3');
    h3.textContent = adapter.label || adapter.runtime;
    const badge = document.createElement('span');
    badge.className = 'hooks-badge';
    if (!adapter.supported) {
      badge.textContent = 'Not supported';
    } else if (adapter.installed) {
      badge.textContent = 'Installed';
      badge.classList.add('is-installed');
    } else if (adapter.staleAtPort) {
      badge.textContent = 'Wrong port';
    } else {
      badge.textContent = 'Not installed';
    }
    head.append(h3, badge);
    section.appendChild(head);

    if (adapter.error) {
      const errEl = document.createElement('p');
      errEl.className = 'hooks-error';
      errEl.textContent = adapter.error;
      section.appendChild(errEl);
    }

    // Hooks are present but aimed at a port nothing is listening on. This is
    // the one failure that otherwise looks exactly like a healthy install:
    // the settings file is perfect and every event goes nowhere.
    if (adapter.staleAtPort) {
      const stale = document.createElement('p');
      stale.className = 'hooks-error';
      stale.textContent =
        `Your hooks post to port ${adapter.staleAtPort}, but DeckHQ is listening on ` +
        `${adapter.port}. Nothing is reaching it, so state is being inferred instead. ` +
        'Reinstall below to point them at this daemon.';
      section.appendChild(stale);
    }

    if (!adapter.supported) {
      const copy = document.createElement('p');
      copy.className = 'hooks-note';
      copy.textContent = `${adapter.label || adapter.runtime} does not support hooks. It falls back to polling for state.`;
      section.appendChild(copy);
      return section;
    }

    const copyWrap = document.createElement('div');
    copyWrap.className = 'hooks-copy';
    const gainP = document.createElement('p');
    gainP.className = 'gain';
    gainP.textContent = GAIN_COPY;
    const lossP = document.createElement('p');
    lossP.textContent = LOSS_COPY;
    copyWrap.append(gainP, lossP);
    section.appendChild(copyWrap);

    const plan = adapter.plan;
    if (plan) {
      const fileLabel = document.createElement('p');
      fileLabel.className = 'hooks-note';
      fileLabel.textContent = 'Written to:';
      section.appendChild(fileLabel);

      const fileBlock = document.createElement('div');
      fileBlock.className = 'hooks-file mono';
      // Verbatim, from plan.file. Text only.
      fileBlock.textContent = plan.file;
      section.appendChild(fileBlock);

      const jsonLabel = document.createElement('p');
      jsonLabel.className = 'hooks-note';
      jsonLabel.textContent = 'The literal JSON block that will be written:';
      section.appendChild(jsonLabel);

      const jsonBlock = document.createElement('pre');
      jsonBlock.className = 'hooks-json-block mono';
      // Verbatim, from plan.json. Text only — never innerHTML.
      jsonBlock.textContent = plan.json;
      section.appendChild(jsonBlock);

      if (Array.isArray(plan.events) && plan.events.length > 0) {
        const eventsLabel = document.createElement('p');
        eventsLabel.className = 'hooks-note';
        eventsLabel.textContent = 'Events captured:';
        section.appendChild(eventsLabel);
        const ul = document.createElement('ul');
        ul.className = 'hooks-events';
        for (const ev of plan.events) {
          const li = document.createElement('li');
          li.textContent = ev;
          ul.appendChild(li);
        }
        section.appendChild(ul);
      }

      if (plan.note) {
        // A blank line in the adapter's note starts a new paragraph. WP-19's
        // PermissionRequest paragraph is the one thing on this screen that
        // grants a runtime the ability to be ANSWERED rather than only
        // watched, and it must not be a wall of text at the end of a wall of
        // text. Text nodes only, as everywhere in this client.
        for (const para of String(plan.note).split(/\n{2,}/)) {
          const text = para.trim();
          if (!text) continue;
          const noteP = document.createElement('p');
          noteP.className = 'hooks-note';
          noteP.textContent = text;
          section.appendChild(noteP);
        }
      }
    }

    const delivery = deliveryNote(adapter);
    if (delivery) {
      const p = document.createElement('p');
      p.className = 'hooks-note';
      p.textContent = delivery;
      section.appendChild(p);
    }

    const actions = document.createElement('div');
    actions.className = 'hooks-actions';

    if (adapter.installed) {
      const removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.className = 'btn btn--danger';
      removeBtn.textContent = 'Remove';
      removeBtn.addEventListener('click', () => remove(adapter.runtime, removeBtn));
      const note = document.createElement('span');
      note.className = 'hooks-note';
      note.textContent = 'Removes only what DeckHQ wrote. The settings file is backed up first.';
      actions.append(removeBtn, note);
    } else {
      const installBtn = document.createElement('button');
      installBtn.type = 'button';
      installBtn.className = 'btn btn--primary';
      installBtn.textContent = adapter.staleAtPort
        ? `Reinstall for port ${adapter.port}`
        : 'Install';
      // No installation without this explicit click. The consent flag is
      // sent only because the user pressed this exact button.
      installBtn.addEventListener('click', () => install(adapter.runtime, installBtn));
      actions.append(installBtn);
    }

    section.appendChild(actions);
    return section;
  }

  /** @param {string} runtime @param {HTMLButtonElement} btn */
  async function install(runtime, btn) {
    btn.disabled = true;
    btn.classList.add('is-busy');
    try {
      const res = await fetch('/api/hooks/install', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ runtime, consent: true }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
      toast(`Hooks installed for ${body.label || runtime}`);
      await load();
    } catch (err) {
      toast(`Could not install hooks: ${err.message}`, { isError: true });
      btn.disabled = false;
      btn.classList.remove('is-busy');
    }
  }

  /** @param {string} runtime @param {HTMLButtonElement} btn */
  async function remove(runtime, btn) {
    btn.disabled = true;
    btn.classList.add('is-busy');
    try {
      const res = await fetch('/api/hooks/remove', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ runtime }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
      toast(`Hooks removed for ${body.label || runtime}`);
      await load();
    } catch (err) {
      toast(`Could not remove hooks: ${err.message}`, { isError: true });
      btn.disabled = false;
      btn.classList.remove('is-busy');
    }
  }

  /**
   * Draw into `host` and keep drawing there. Called by the settings sheet
   * when it builds its Hooks section.
   * @param {HTMLElement} host
   */
  function renderInto(host) {
    bodyEl = host;
    load();
  }

  /** Re-read `/api/hooks`. Installed, wrong port and "events arriving" are
   * live facts, so the sheet asks for them again every time it opens. */
  function refresh() {
    if (bodyEl) load();
  }

  return { renderInto, refresh };
}

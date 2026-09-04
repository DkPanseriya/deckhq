/**
 * WHAT CHANGED — the working-tree summary and the diffs under it
 * (WP-22 follow-up).
 *
 * Split out of `createPanel()` unchanged. Every request here is a GET of the
 * disk (`/api/changes`, `/api/diff`) or a request to open an editor
 * (`/api/open`); none of them touches ack state, per docs/01-PRODUCT.md §2.
 *
 * WP-47: which rows are open is state about the session being reviewed, not
 * about the rendered nodes, so a re-scan every few seconds cannot close a
 * diff the user opened.
 */

import { renderDiff } from './diff-view.js';
import { formatNumber } from './panel-format.js';
import { currentId } from './panel-state.js';
import { threadSkeleton } from './panel-dom.js';

/** @type {number|null|undefined} the scan the rendered diff belongs to */
export let changesScannedAt = undefined;
/** @param {number|null|undefined} v */
export const setChangesScannedAt = (v) => {
  changesScannedAt = v;
};
/** @type {{key:string, path:string, staged:boolean, head:any, diffEl:any, loaded:boolean, line:number}[]} */
export let fileRows = [];
/** @param {any[]} v */
export const setFileRows = (v) => {
  fileRows = v;
};
/**
 * Which file rows are open, by `U:`/`S:` plus path (WP-47).
 * @type {Set<string>}
 */
export const expandedFiles = new Set();

/** @typedef {ReturnType<typeof import('./panel-dom.js').buildPanelDom>} PanelDom */

/**
 * @param {PanelDom & {getSnapshot: () => any,
 *          toast: (m:string, o?:{isError?:boolean}) => void}} ctx
 */
export function createChangesPart(ctx) {
  const { getSnapshot, toast, changedEl, changedTotals, changedFoot, expandAllBtn } = ctx;
  let changesToken = 0;

  // `[ expand all ]`. A listener on an element of its own, so nothing about
  // registration order can matter (docs/DEVIATIONS.md §122, rule 1).
  expandAllBtn.addEventListener('click', () => {
    const open = fileRows.some((r) => r.head.getAttribute('aria-expanded') !== 'true');
    for (const row of fileRows) setFileExpanded(row, open);
  });

  /**
   * "What changed in <project>": the working-tree summary from
   * GET /api/changes. A passive read of the disk, cached per scan by the
   * daemon; it never touches ack state. Re-fetched only when a new scan has
   * happened, so a snapshot per second costs nothing here.
   * @param {string} id
   * @param {number|null} scannedAt
   */
  async function loadChanges(id, scannedAt) {
    if (scannedAt === changesScannedAt) return;
    changesScannedAt = scannedAt;
    const token = ++changesToken;
    if (!changedEl.childElementCount) {
      changedEl.textContent = '';
      changedEl.appendChild(threadSkeleton());
    }
    if (getSnapshot()?.demo) {
      changedEl.textContent = '';
      changedTotals.textContent = '';
      const note = document.createElement('div');
      note.className = 'review-note';
      note.textContent = 'An actor has no working tree. A real session shows what changed here.';
      changedEl.appendChild(note);
      return;
    }
    try {
      const res = await fetch(`/api/changes?id=${encodeURIComponent(id)}`);
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
      if (token !== changesToken) return;
      renderChanges(body);
    } catch (err) {
      if (token !== changesToken) return;
      changesScannedAt = undefined; // try again on the next snapshot
      changedEl.textContent = '';
      changedTotals.textContent = '';
      const msg = document.createElement('div');
      msg.className = 'review-note';
      msg.textContent = `Could not read the working tree: ${err.message}`;
      changedEl.appendChild(msg);
    }
  }

  /**
   * The section never disappears: a clean tree, a missing repository, a
   * missing git and a missing directory are each a sentence, because "no
   * changes" is itself review-relevant.
   * @param {any} c
   */
  function renderChanges(c) {
    changedEl.textContent = '';
    changedTotals.textContent = '';
    fileRows = [];
    const note = (text) => {
      const n = document.createElement('div');
      n.className = 'review-note';
      n.textContent = text;
      changedEl.appendChild(n);
    };
    switch (c.status) {
      case 'missing':
        note('the directory no longer exists');
        return;
      case 'no-git':
        note('git is not installed, so nothing here can be read');
        return;
      case 'no-repo':
        note('not a git repository');
        return;
      default:
        break;
    }
    const ahead = c.ahead && c.ahead.count > 0 ? c.ahead : null;
    if (c.status === 'clean') {
      note(
        ahead
          ? `nothing uncommitted · ${ahead.count} ${ahead.count === 1 ? 'commit' : 'commits'} ahead of ${ahead.base}`
          : 'nothing uncommitted',
      );
      return;
    }
    const t = c.totals || { files: 0, added: 0, removed: 0 };
    changedTotals.textContent = `+${formatNumber(t.added)}  −${formatNumber(t.removed)}  ${t.files} ${
      t.files === 1 ? 'file' : 'files'
    }`;
    const table = document.createElement('div');
    table.className = 'review-files';
    for (const [list, staged] of [
      [c.files || [], false],
      [c.staged || [], true],
    ]) {
      for (const f of list) {
        // The row is a button so that "click or Enter" is the platform's own
        // behaviour rather than a keydown handler that would also have to
        // reimplement Space, focus and the disclosure's ARIA.
        const head = document.createElement('button');
        head.type = 'button';
        head.className = 'review-file-head';
        head.setAttribute('aria-expanded', 'false');
        const p = document.createElement('span');
        p.className = 'review-file-path';
        p.textContent = f.path;
        head.title = staged ? `${f.path} (staged)` : f.path;
        const add = document.createElement('span');
        add.className = 'review-file-num num';
        add.textContent = f.binary ? 'bin' : `+${f.added}`;
        const rem = document.createElement('span');
        rem.className = 'review-file-num num';
        rem.textContent = f.binary ? '' : `−${f.removed}`;
        if (staged) {
          const s = document.createElement('span');
          s.className = 'review-file-staged';
          s.textContent = 'staged';
          p.appendChild(s);
        }
        head.append(p, add, rem);

        const openBtn = document.createElement('button');
        openBtn.type = 'button';
        openBtn.className = 'review-file-open';
        openBtn.textContent = '↗';
        openBtn.title = 'Open in editor';
        openBtn.setAttribute('aria-label', `Open ${f.path} in your editor`);

        const diffEl = document.createElement('div');
        diffEl.className = 'review-file-diff';
        diffEl.id = `review-diff-${fileRows.length}`;
        diffEl.hidden = true;
        head.setAttribute('aria-controls', diffEl.id);

        const row = document.createElement('div');
        row.className = 'review-file';
        const rowTop = document.createElement('div');
        rowTop.className = 'review-file-row';
        rowTop.append(head, openBtn);
        row.append(rowTop, diffEl);
        table.appendChild(row);

        const entry = {
          key: (staged ? 'S:' : 'U:') + f.path,
          path: f.path,
          staged,
          head,
          diffEl,
          loaded: false,
          line: 1,
        };
        fileRows.push(entry);
        head.addEventListener('click', () => setFileExpanded(entry, !isFileExpanded(entry)));
        openBtn.addEventListener('click', () => openFileInEditor(entry));
        if (expandedFiles.has(entry.key)) setFileExpanded(entry, true);
      }
    }
    changedEl.appendChild(table);
    if (fileRows.length) {
      changedEl.appendChild(changedFoot);
      syncExpandAll();
    }
    if (ahead) {
      note(`${ahead.count} ${ahead.count === 1 ? 'commit' : 'commits'} ahead of ${ahead.base}`);
    }
  }

  /** @param {any} entry */
  function isFileExpanded(entry) {
    return entry.head.getAttribute('aria-expanded') === 'true';
  }

  /** `[ expand all ]` becomes `[ collapse all ]` once everything is open. */
  function syncExpandAll() {
    const allOpen = fileRows.length > 0 && fileRows.every(isFileExpanded);
    expandAllBtn.textContent = allOpen ? '[ collapse all ]' : '[ expand all ]';
  }

  /**
   * Open or close one file's diff. Collapsed by default (`08` §8.1): a review
   * card that opened six diffs at once would bury the message the section
   * exists to support.
   * @param {any} entry @param {boolean} on
   */
  function setFileExpanded(entry, on) {
    entry.head.setAttribute('aria-expanded', String(on));
    entry.diffEl.hidden = !on;
    if (on) {
      expandedFiles.add(entry.key);
      loadDiff(entry);
    } else {
      expandedFiles.delete(entry.key);
    }
    syncExpandAll();
  }

  /**
   * GET /api/diff for one file. Passive, like loadChanges(): a read of the
   * disk that never touches ack state. Cached per scan by the daemon, and
   * fetched at most once per rendered row here.
   * @param {any} entry
   */
  async function loadDiff(entry) {
    if (entry.loaded) return;
    entry.loaded = true;
    const id = currentId;
    const note = (text) => {
      entry.diffEl.textContent = '';
      const n = document.createElement('div');
      n.className = 'review-note';
      n.textContent = text;
      entry.diffEl.appendChild(n);
    };
    note('reading the diff…');
    try {
      const res = await fetch(
        `/api/diff?id=${encodeURIComponent(id)}&file=${encodeURIComponent(entry.path)}`,
      );
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
      if (id !== currentId) return;
      const part = (entry.staged ? body.staged : body.unstaged) || {};
      const text = String(part.text || '');
      if (!text) {
        note('no textual diff — a binary file, or the change is no longer there');
        return;
      }
      // Aim "open in editor" at the first changed line rather than line 1.
      const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)/m.exec(text);
      if (hunk) entry.line = Number(hunk[1]) || 1;
      entry.diffEl.textContent = '';
      entry.diffEl.appendChild(renderDiff(text, document));
      if (part.truncated) {
        const n = document.createElement('div');
        n.className = 'review-note';
        n.textContent = 'the rest of this diff is too large to show here';
        entry.diffEl.appendChild(n);
      }
    } catch (err) {
      if (id !== currentId) return;
      entry.loaded = false; // so closing and reopening the row tries again
      note(`could not read the diff: ${err.message}`);
    }
  }

  /**
   * POST /api/open-in-editor. The client sends a path and a line, never a
   * command: which program that means is the daemon's decision, taken from an
   * allowlist (src/core/editor.mjs).
   * @param {any} entry
   */
  async function openFileInEditor(entry) {
    const id = currentId;
    if (!id) return;
    try {
      const res = await fetch('/api/open-in-editor', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id, file: entry.path, line: entry.line }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
      toast(`Opened ${entry.path} in ${body.label || 'your editor'}`);
    } catch (err) {
      toast(`Could not open in editor: ${err.message}`, { isError: true });
    }
  }

  return {
    loadChanges,
    renderChanges,
    setFileExpanded,
    isFileExpanded,
    loadDiff,
    openFileInEditor,
  };
}

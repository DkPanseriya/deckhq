/**
 * Unsent replies, kept per session in localStorage.
 *
 * docs/plan/08-PLAN-V2-100X.md §3.5 — "your draft" as a visible state: text
 * sitting in the composer is the agent's queue being held by you, and it
 * should survive closing the panel, switching sessions, and reloading the tab.
 * A draft is purely client-side: the daemon never sees it and it never
 * touches ack state.
 *
 * `createDrafts(storage)` takes the storage so it can be tested with a plain
 * object in Node; the default export binds to `window.localStorage` and
 * degrades to an in-memory map when storage is unavailable or throws
 * (private windows, disabled storage, quota).
 */

const PREFIX = 'deckhq.draft.';

/**
 * @param {{getItem(k:string):string|null, setItem(k:string,v:string):void,
 *   removeItem(k:string):void, key(i:number):string|null, length:number}} storage
 */
export function createDrafts(storage) {
  /** @param {string} id */
  const key = (id) => PREFIX + id;

  /** @param {string} id @returns {string} '' when there is none */
  function load(id) {
    try {
      return storage.getItem(key(id)) || '';
    } catch {
      return '';
    }
  }

  /**
   * Save a draft, or clear it when the text is blank — an empty composer is
   * not a draft, and a chip for one would be noise.
   * @param {string} id @param {string} text
   */
  function save(id, text) {
    if (!String(text ?? '').trim()) return clear(id);
    try {
      storage.setItem(key(id), String(text));
    } catch {
      /* storage full or unavailable: the composer still has the text */
    }
  }

  /** @param {string} id */
  function clear(id) {
    try {
      storage.removeItem(key(id));
    } catch {
      /* nothing to clear */
    }
  }

  /** @param {string} id */
  function has(id) {
    return load(id).trim().length > 0;
  }

  /** Every session id that currently holds a draft. */
  function ids() {
    /** @type {string[]} */
    const out = [];
    try {
      for (let i = 0; i < storage.length; i++) {
        const k = storage.key(i);
        if (k && k.startsWith(PREFIX) && (storage.getItem(k) || '').trim()) {
          out.push(k.slice(PREFIX.length));
        }
      }
    } catch {
      /* unreadable storage reads as no drafts */
    }
    return out;
  }

  return { load, save, clear, has, ids };
}

/** An in-memory stand-in with the same shape as `Storage`. */
export function memoryStorage() {
  /** @type {Map<string,string>} */
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => void map.set(k, String(v)),
    removeItem: (k) => void map.delete(k),
    key: (i) => [...map.keys()][i] ?? null,
    get length() {
      return map.size;
    },
  };
}

function pickStorage() {
  try {
    const s = globalThis.localStorage;
    // A probe write: some browsers expose the object and throw on use.
    s.setItem(PREFIX + '__probe', '1');
    s.removeItem(PREFIX + '__probe');
    return s;
  } catch {
    return memoryStorage();
  }
}

export const drafts = createDrafts(pickStorage());

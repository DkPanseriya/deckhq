/**
 * Tiny leveled logger to stderr. No dependencies, no transports, no files.
 *
 * Everything goes to stderr (via `console.error`) so stdout stays free for any
 * future machine-readable output. `debug` is silent unless `DECKHQ_DEBUG` is
 * set in the environment at the time of the call.
 */

/**
 * @typedef {object} Log
 * @property {(...args:any[]) => void} info
 * @property {(...args:any[]) => void} warn
 * @property {(...args:any[]) => void} error
 * @property {(...args:any[]) => void} debug
 */

/**
 * @param {string} scope short label identifying the calling module, e.g. 'store'
 * @returns {Log}
 */
export function createLog(scope) {
  const prefix = `[${scope}]`;
  return {
    info(...args) {
      console.error(prefix, 'info', ...args);
    },
    warn(...args) {
      console.error(prefix, 'warn', ...args);
    },
    error(...args) {
      console.error(prefix, 'error', ...args);
    },
    debug(...args) {
      if (process.env.DECKHQ_DEBUG) {
        console.error(prefix, 'debug', ...args);
      }
    },
  };
}

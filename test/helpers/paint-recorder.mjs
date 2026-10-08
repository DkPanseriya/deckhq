/**
 * A 2D CONTEXT THAT REMEMBERS WHAT IT WAS TOLD.
 *
 * The backdrop is baked on a canvas, and a canvas does not exist under
 * `node --test`. A painter does not need one to be asked what it painted: this
 * answers every method a painter calls, counts the calls, and keeps one entry
 * per fill or stroke — its style, its alpha, the shadow it was painted under,
 * and the arguments it was given.
 *
 * `save` and `restore` keep the paint state the way a canvas does, so a shadow
 * set inside a `save` is gone after its `restore`. Geometry is not transformed:
 * a test that needs to know WHERE something was painted reads the arguments.
 */

const PAINTS = new Set(['fill', 'stroke', 'fillRect', 'strokeRect', 'fillText']);
const PATHS = new Set([
  'moveTo',
  'lineTo',
  'quadraticCurveTo',
  'bezierCurveTo',
  'arc',
  'arcTo',
  'ellipse',
  'rect',
  'roundRect',
  'fill',
  'stroke',
  'fillRect',
  'strokeRect',
  'clip',
]);

/**
 * @returns {any} a context; `paints` is every fill and stroke in order,
 *   `counts` how many times each method was called, `turns` every angle it was
 *   rotated by, `pathOps()` how many path and paint operations were issued
 */
export function paintRecorder() {
  /** @type {any[]} */
  const paints = [];
  /** @type {Record<string, number>} */
  const counts = {};
  /** @type {any[]} */
  const stack = [];
  /** @type {Record<string, any>} */
  const state = {
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    lineCap: 'butt',
    lineJoin: 'miter',
    globalAlpha: 1,
    shadowBlur: 0,
    shadowColor: '',
    shadowOffsetX: 0,
    shadowOffsetY: 0,
    font: '',
    textAlign: 'start',
    textBaseline: 'alphabetic',
  };
  const gradient = { addColorStop() {} };
  /** @type {number[]} */
  const turns = [];
  /** @type {Record<string, any>} */
  const own = {
    paints,
    counts,
    turns,
    pathOps: () => Object.entries(counts).reduce((a, [k, n]) => a + (PATHS.has(k) ? n : 0), 0),
    save: () => stack.push({ ...state }),
    restore: () => Object.assign(state, stack.pop() || {}),
    createLinearGradient: () => gradient,
    createRadialGradient: () => gradient,
    measureText: (/** @type {string} */ t) => ({ width: String(t).length * 6 }),
  };
  return new Proxy(state, {
    get(target, key) {
      const k = String(key);
      if (k in own) {
        if (typeof own[k] === 'function' && k !== 'pathOps') {
          return (/** @type {any[]} */ ...args) => {
            counts[k] = (counts[k] || 0) + 1;
            return own[k](...args);
          };
        }
        return own[k];
      }
      if (k in target) return target[k];
      return (/** @type {any[]} */ ...args) => {
        counts[k] = (counts[k] || 0) + 1;
        if (k === 'rotate') turns.push(Number(args[0]));
        if (PAINTS.has(k)) {
          paints.push({
            op: k,
            style: k.startsWith('stroke') ? target.strokeStyle : target.fillStyle,
            args,
            alpha: target.globalAlpha,
            width: target.lineWidth,
            shadowBlur: target.shadowBlur,
            shadowColor: target.shadowColor,
            shadowOffsetX: target.shadowOffsetX,
            shadowOffsetY: target.shadowOffsetY,
          });
        }
        return undefined;
      };
    },
    set(target, key, value) {
      target[String(key)] = value;
      return true;
    },
  });
}

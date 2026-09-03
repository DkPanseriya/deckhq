/**
 * Minimal HTTP plumbing: a router, JSON helpers, and path-confined static
 * serving. No dependencies, no framework.
 *
 * docs/02-ARCHITECTURE.md §5, §9.
 */
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import path from 'node:path';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.ico': 'image/x-icon',
  '.map': 'application/json; charset=utf-8',
};

/** Body size ceiling. Nothing we accept is large. */
const MAX_BODY = 1024 * 1024;

export class Router {
  constructor() {
    /** @type {Map<string, Map<string, Function>>} */
    this.routes = new Map();
  }

  /** @param {string} method @param {string} pathname @param {Function} handler */
  add(method, pathname, handler) {
    let byPath = this.routes.get(method);
    if (!byPath) {
      byPath = new Map();
      this.routes.set(method, byPath);
    }
    byPath.set(pathname, handler);
    return this;
  }

  get(p, h) {
    return this.add('GET', p, h);
  }

  post(p, h) {
    return this.add('POST', p, h);
  }

  /** @param {string} method @param {string} pathname */
  match(method, pathname) {
    return this.routes.get(method)?.get(pathname);
  }
}

/**
 * @param {import('node:http').ServerResponse} res
 * @param {number} status
 * @param {unknown} body
 */
export function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
    'cache-control': 'no-store',
  });
  res.end(payload);
}

/** @param {import('node:http').ServerResponse} res */
export function sendError(res, status, message) {
  sendJson(res, status, { error: String(message) });
}

/**
 * Read and parse a JSON request body. Rejects oversized or malformed bodies.
 * @param {import('node:http').IncomingMessage} req
 */
export function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    /** @type {Buffer[]} */
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new Error('Request body too large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('error', reject);
    req.on('end', () => {
      if (chunks.length === 0) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(new Error('Malformed JSON body'));
      }
    });
  });
}

/**
 * Serve a file from `root`, confining the resolved path inside it.
 * A traversal attempt is rejected, not clamped.
 *
 * @param {import('node:http').ServerResponse} res
 * @param {string} root  absolute directory
 * @param {string} urlPath
 */
export async function serveStatic(res, root, urlPath) {
  let rel;
  try {
    rel = decodeURIComponent(urlPath);
  } catch {
    sendError(res, 400, 'Bad path');
    return;
  }
  if (rel.includes('\0')) {
    sendError(res, 400, 'Bad path');
    return;
  }
  if (rel === '/' || rel === '') rel = '/index.html';

  const resolvedRoot = path.resolve(root);
  const target = path.resolve(resolvedRoot, '.' + rel.replace(/\\/g, '/'));

  // Confinement. `relative` is the only trustworthy test on Windows, where
  // drive letters and case-insensitivity make prefix comparison unsafe.
  const relative = path.relative(resolvedRoot, target);
  if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) {
    sendError(res, 403, 'Forbidden');
    return;
  }

  let info;
  try {
    info = await stat(target);
  } catch {
    sendError(res, 404, 'Not found');
    return;
  }
  if (!info.isFile()) {
    sendError(res, 404, 'Not found');
    return;
  }

  res.writeHead(200, {
    'content-type': MIME[path.extname(target).toLowerCase()] || 'application/octet-stream',
    'content-length': info.size,
    'cache-control': 'no-cache',
    // Nothing in this page may reach the network. Belt and braces alongside
    // the fact that we make no outbound calls at all.
    //
    // `worker-src` and `manifest-src` are stated rather than left to fall back
    // through `default-src`, because WP-16 made the page install a service
    // worker and a manifest: a directive that matters is one worth reading in
    // the header rather than deriving. Both are `'self'` — the worker is
    // `/sw.js` on this loopback origin and the manifest is `/manifest.webmanifest`.
    'content-security-policy':
      "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; " +
      "connect-src 'self'; font-src 'self'; worker-src 'self'; manifest-src 'self'; " +
      "object-src 'none'; base-uri 'none'; form-action 'none'",
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
  });
  createReadStream(target).pipe(res);
}

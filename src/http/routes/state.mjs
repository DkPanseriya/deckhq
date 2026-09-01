/**
 * GET /api/state       full snapshot
 * GET /api/events      SSE stream, pushed on every change
 *
 * docs/02-ARCHITECTURE.md §5.
 */
import { sendJson } from '../server.mjs';

const HEARTBEAT_MS = 15000;

/**
 * @param {import('../server.mjs').Router} router
 * @param {{registry:any, log:any}} ctx
 */
export function register(router, ctx) {
  const { registry, log } = ctx;

  router.get('/api/state', (_req, res) => {
    sendJson(res, 200, registry.snapshot());
  });

  router.get('/api/events', (req, res) => {
    res.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-store, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    });
    // Tell the browser to back off for a second before reconnecting.
    res.write('retry: 1000\n\n');

    let closed = false;
    let lastId = 0;

    const push = (snapshot) => {
      if (closed) return;
      try {
        lastId += 1;
        res.write(`id: ${lastId}\nevent: state\ndata: ${JSON.stringify(snapshot)}\n\n`);
      } catch (err) {
        log.debug('SSE write failed', err);
      }
    };

    push(registry.snapshot());
    const unsubscribe = registry.on(push);

    const heartbeat = setInterval(() => {
      if (closed) return;
      try {
        res.write(': ping\n\n');
      } catch {
        /* the close handler will clean up */
      }
    }, HEARTBEAT_MS);
    if (typeof heartbeat.unref === 'function') heartbeat.unref();

    const cleanup = () => {
      if (closed) return;
      closed = true;
      clearInterval(heartbeat);
      unsubscribe();
    };

    req.on('close', cleanup);
    req.on('error', cleanup);
    res.on('close', cleanup);
    res.on('error', cleanup);
  });
}

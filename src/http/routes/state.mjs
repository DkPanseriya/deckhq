/**
 * GET /api/state       full snapshot
 * GET /api/events      SSE stream, pushed on every change
 *
 * docs/02-ARCHITECTURE.md §5.
 */
import { sendJson } from '../server.mjs';
import { splitAgentId } from '../../core/model.mjs';

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

  /**
   * The SSE channel. One endpoint, three kinds of subscriber, chosen by
   * `?stream=`:
   *
   *   (default)      `state` events — the whole snapshot, on every change.
   *                  Byte-for-byte what it has always been.
   *   ?stream=send   `send` events (WP-09) and, with `&watch=<agentId>`,
   *                  `transcript` events for that one session.
   *
   * The filter exists because the page needs both and app.js owns the
   * snapshot connection. Without it the panel's own connection would be a
   * second full snapshot on every scan, forever, for events it never reads —
   * see docs/DEVIATIONS.md §115.
   */
  router.get('/api/events', (req, res, url) => {
    const stream = url?.searchParams?.get('stream') === 'send' ? 'send' : 'state';
    const watchId = stream === 'send' ? url?.searchParams?.get('watch') || '' : '';

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

    /** @param {string} event @param {any} data */
    const write = (event, data) => {
      if (closed) return;
      try {
        lastId += 1;
        res.write(`id: ${lastId}\nevent: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      } catch (err) {
        log.debug('SSE write failed', err);
      }
    };

    /** @type {(() => void)[]} */
    const teardown = [];

    if (stream === 'state') {
      const push = (snapshot) => write('state', snapshot);
      push(registry.snapshot());
      teardown.push(registry.on(push));
    } else {
      // WP-09. Progress for whichever sends this client started. Every event
      // carries its own `sendId`, so one connection serves a page that has
      // more than one turn in flight.
      if (ctx.sends) teardown.push(ctx.sends.subscribe((event) => write('send', event)));

      if (watchId) {
        // The transcript of the session the panel currently has open. A
        // passive read of a file: it clears nothing and acks nothing.
        let stop = null;
        let gone = false;
        watchTranscript(ctx, watchId, (digest) =>
          write('transcript', { id: watchId, ...digest }),
        ).then(
          (fn) => {
            if (gone) fn();
            else stop = fn;
          },
          (err) => log.debug('transcript watch failed', watchId, err),
        );
        teardown.push(() => {
          gone = true;
          stop?.();
        });
      }
    }

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
      for (const fn of teardown) {
        try {
          fn();
        } catch (err) {
          log.debug('SSE teardown failed', err);
        }
      }
      teardown.length = 0;
    };

    req.on('close', cleanup);
    req.on('error', cleanup);
    res.on('close', cleanup);
    res.on('error', cleanup);
  });
}

/**
 * Ask the session's own adapter to watch its transcript. The daemon knows
 * nothing about transcript formats and does not learn any here — a runtime
 * with no `watchConversation` (Codex today) simply has no live tail, and
 * costs the panel nothing else.
 * @param {any} ctx
 * @param {string} id
 * @param {(digest:any) => void} onChange
 * @returns {Promise<() => void>}
 */
async function watchTranscript(ctx, id, onChange) {
  const { runtime } = splitAgentId(id);
  const adapter = ctx.adapters?.getAdapter?.(runtime);
  if (!adapter || typeof adapter.watchConversation !== 'function') return () => {};
  return adapter.watchConversation(id, { onChange });
}

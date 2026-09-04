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
 * @param {{registry:any, log:any, sends:any, endEventStreams?:() => number}} ctx
 *   `sends` was read here and not declared (WP-22). `endEventStreams` is
 *   written here and read by `startDaemon`'s `close()` — see below.
 */
export function register(router, ctx) {
  const { registry, log } = ctx;

  /**
   * Every event stream open right now, held as the function that ends it.
   *
   * An SSE response is a request **in flight, forever, by design**, and
   * `server.close()` waits for every request to finish. So a browser parked
   * on the floor made a graceful shutdown wait for a stream that would never
   * end on its own: `close()` simply did not return (`docs/DEVIATIONS.md`
   * §126.3, §127). Nothing outside this file can end one, because nothing
   * outside this file holds the `res`. So this file keeps the set, and hands
   * shutdown one function to call.
   * @type {Set<() => void>}
   */
  const open = new Set();

  /**
   * End every open stream, `bye` first. Called by `close()` in
   * `src/daemon.mjs` before it asks the server to close.
   * @returns {number} how many streams were ended
   */
  ctx.endEventStreams = () => {
    let ended = 0;
    for (const end of [...open]) {
      try {
        end();
        ended += 1;
      } catch (err) {
        log.debug('SSE shutdown failed', err);
      }
    }
    return ended;
  };

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
   * see docs/DEVIATIONS.md §117.
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
    /** Takes this stream back out of `open`; set once it is in there. */
    let forget = () => {};

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
      forget();
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

    /**
     * Shutdown's end of the stream, and the only one that is ours to take:
     * a last `event: bye` so the client learns the daemon is going rather
     * than watching a socket vanish, then the teardown the client's own
     * disconnect would have run, then `res.end()` — which is what takes this
     * request out of flight and lets `server.close()` complete.
     */
    const bye = () => {
      if (!closed) {
        try {
          res.write(`id: ${++lastId}\nevent: bye\ndata: {"reason":"shutdown"}\n\n`);
        } catch (err) {
          log.debug('SSE bye failed', err);
        }
      }
      cleanup();
      try {
        res.end();
      } catch (err) {
        log.debug('SSE end failed', err);
      }
    };
    open.add(bye);
    forget = () => open.delete(bye);

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

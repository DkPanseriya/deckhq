/**
 * Claude Code's `--output-format stream-json` event stream, parsed
 * incrementally into DeckHQ's own vocabulary.
 *
 * docs/02-ARCHITECTURE.md §2.1 and `07-AGENT-HANDOVERS.md` rule 8: a runtime's
 * wire format is its adapter's business and nobody else's. Everything above
 * this file — the send hub, the HTTP route, the panel — sees only the five
 * neutral events at the bottom of this comment, so a change in Claude Code's
 * spelling is a change here and nowhere else.
 *
 * WHAT THE RUNTIME ACTUALLY EMITS. Confirmed against Claude Code 2.1.231 on
 * the reference machine by running the real binary (`claude -p … --verbose
 * --output-format stream-json --include-partial-messages`) and reading its
 * output, and by reading the flag documentation in `claude --help`. The run
 * reached the API and was refused (`401 OAuth access token has expired`), so
 * every envelope below is a *recorded* shape; the assistant-delta shapes come
 * from the same binary's own embedded event vocabulary
 * (`stream_event` / `content_block_start` / `content_block_delta` /
 * `text_delta` / `input_json_delta` / `thinking_delta` / `message_delta`) and
 * from the Anthropic streaming events they wrap. See docs/DEVIATIONS.md §115:
 * a full turn against a logged-in `claude` has NOT been run.
 *
 * One JSON object per line:
 *
 *   {"type":"system","subtype":"init","session_id":"…","model":"…","cwd":"…"}
 *   {"type":"system","subtype":"status","status":"requesting"}
 *   {"type":"system","subtype":"api_retry","attempt":1,"error_status":401}
 *   {"type":"system","subtype":"hook_started"|"hook_response",…}
 *   {"type":"stream_event","event":{"type":"content_block_delta","index":0,
 *                                   "delta":{"type":"text_delta","text":"…"}}}
 *   {"type":"assistant","message":{"content":[{"type":"text","text":"…"},
 *                                             {"type":"tool_use","name":"Read"}]}}
 *   {"type":"user","message":{"content":[{"type":"tool_result",…}]}}
 *   {"type":"result","subtype":"success","is_error":false,"result":"…",
 *    "session_id":"…","duration_ms":5210,"total_cost_usd":0.04}
 *
 * WHAT THIS EMITS — the whole vocabulary above this file:
 *
 *   {type:'accepted', sessionId, model}   the turn is running; the composer
 *                                         may be handed back to the user
 *   {type:'status',   status}             'requesting' / 'responding' / …
 *   {type:'delta',    text}               a fragment of assistant prose
 *   {type:'text',     text}               a WHOLE assistant message, emitted
 *                                         only when no deltas were seen
 *   {type:'turn'}                         one assistant message ended
 *   {type:'tool',     name, summary}      the agent picked up a tool
 *   {type:'result',   ok, text, error, sessionId, durationMs, costUsd}
 *
 * Defensive throughout, like every other parser in this adapter: a corrupt
 * line is skipped, never thrown (CONTRACTS.md rule 6).
 */

import { MAX_TOOL_SUMMARY } from '../../core/model.mjs';

/**
 * Longest single NDJSON line this will buffer before giving up on it. A
 * `tool_result` carrying a large file, or a runtime that stops writing
 * newlines, must not be able to grow this process without bound. 8 MB matches
 * the `maxBuffer` the blocking `send()` used before this existed.
 */
export const MAX_LINE_BYTES = 8 * 1024 * 1024;

/**
 * Collapse a runtime-supplied string to one printable line. Same rule, and
 * the same reason, as `oneLine()` in ./hooks.mjs (docs/DEVIATIONS.md §89
 * decision 6): a tool name or a file path is text this project did not write
 * and it can carry newlines, ANSI escapes or a bidi override.
 * @param {unknown} value
 * @param {number} max
 */
function oneLine(value, max) {
  const text = String(value ?? '')
    .replace(/\p{C}/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > max ? text.slice(0, max - 1) + '…' : text;
}

/** Text blocks of a message's `content`, joined. Mirrors parse.mjs. */
function textOf(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  const parts = [];
  for (const block of content) {
    if (block && typeof block === 'object' && block.type === 'text') {
      if (typeof block.text === 'string' && block.text) parts.push(block.text);
    }
  }
  return parts.join('\n\n');
}

/**
 * What to say about a tool the agent just picked up: its name, plus at most
 * one field of its input. `{name, input}` — where `input` may be null,
 * because a tool block whose argument fragments never finished arriving still
 * has a true name.
 *
 * The same discipline as the hook path's `toolSummary()` in ./hooks.mjs, and
 * for the same two reasons: a path keeps only its basename, so someone else's
 * directory tree cannot land in a screenshot of this panel, and every string
 * is flattened to one line before it is anything else.
 * @param {any} block
 */
function toolSummaryOf(block) {
  const name = oneLine(block?.name, 40) || 'a tool';
  const input = block && typeof block.input === 'object' && block.input ? block.input : null;
  const detail = input
    ? input.file_path || input.path || input.command || input.pattern || input.url || ''
    : '';
  if (!detail) return name;
  // A path is shown by its last segment only, for the reason DEVIATIONS §89
  // decision 5 gives: someone else's directory tree must not land in a
  // screenshot of this panel.
  const shown =
    typeof detail === 'string' && (input.file_path || input.path)
      ? detail.split(/[\\/]/).pop() || detail
      : detail;
  return oneLine(`${name} ${shown}`, MAX_TOOL_SUMMARY);
}

/**
 * A line-buffered parser for one `claude --output-format stream-json` run.
 *
 * `push()` takes whatever came off the pipe — a chunk boundary may fall
 * anywhere, including inside a multi-byte character, so the caller hands over
 * decoded strings and this splits on newlines rather than assuming one chunk
 * is one event. `end()` flushes a final line that arrived without its
 * newline.
 *
 * @param {(event:any) => void} onEvent called synchronously, once per event.
 *   It must never throw; if it does, the throw is swallowed so one bad
 *   listener cannot kill the child's stdout handler.
 * @returns {{push:(chunk:string)=>void, end:()=>void, sawResult:boolean}}
 */
export function createStreamParser(onEvent) {
  let buffer = '';
  // How much of `buffer` has already been searched for a newline. Without
  // this the search restarts at byte 0 on every chunk, which is quadratic in
  // the length of a long line — and a `tool_result` carrying a large file is
  // exactly that.
  let scanned = 0;
  let overlong = false;

  /**
   * Tool blocks currently streaming, by content-block index. A `tool_use`
   * block arrives as a `content_block_start` carrying the NAME and an empty
   * input, then the input itself as `input_json_delta` fragments, then a
   * `content_block_stop`. The tool event is emitted at the stop, so it says
   * "Read vite.config.ts" rather than a bare "Read" — and still lands long
   * before the turn ends, which is the whole point.
   * @type {Map<number, {name:string, json:string}>}
   */
  const openTools = new Map();

  // Whether this run has produced any incremental delta at all. When it has,
  // the whole `assistant` messages that follow are duplicates of prose the
  // reader has already watched arrive, and re-emitting them would print
  // everything twice. When it has NOT — an older CLI, or
  // `--include-partial-messages` refused — the whole messages are the only
  // prose there is, so they become the stream. Exactly one of the two paths
  // ever produces text for a given run.
  let sawDelta = false;

  const state = { sawResult: false };

  /** @param {any} event */
  const emit = (event) => {
    try {
      onEvent(event);
    } catch {
      // A listener's failure is not this parser's to propagate.
    }
  };

  /** @param {string} line */
  function handleLine(line) {
    const trimmed = line.trim();
    if (!trimmed) return;
    let rec;
    try {
      rec = JSON.parse(trimmed);
    } catch {
      return; // corrupt or partial; the next line still counts
    }
    if (!rec || typeof rec !== 'object') return;

    switch (rec.type) {
      case 'system':
        if (rec.subtype === 'init') {
          emit({
            type: 'accepted',
            sessionId: typeof rec.session_id === 'string' ? rec.session_id : null,
            model: typeof rec.model === 'string' ? rec.model : null,
          });
        } else if (rec.subtype === 'status' && typeof rec.status === 'string') {
          emit({ type: 'status', status: oneLine(rec.status, 40) });
        } else if (rec.subtype === 'api_retry') {
          emit({ type: 'status', status: 'retrying' });
        }
        // hook_started / hook_response and every other subtype are the
        // runtime's own plumbing. They are not conversation and are dropped.
        return;

      case 'stream_event':
        handleStreamEvent(rec.event);
        return;

      case 'assistant': {
        const message = rec.message;
        if (!message || typeof message !== 'object') return;
        if (rec.parent_tool_use_id) return; // a subagent's turn, not this one's
        if (!sawDelta) {
          const text = textOf(message.content);
          if (text) emit({ type: 'text', text });
          if (Array.isArray(message.content)) {
            for (const block of message.content) {
              if (block && typeof block === 'object' && block.type === 'tool_use') {
                emit({
                  type: 'tool',
                  name: oneLine(block.name, 40),
                  summary: toolSummaryOf(block),
                });
              }
            }
          }
        }
        emit({ type: 'turn' });
        return;
      }

      case 'result': {
        state.sawResult = true;
        const ok = rec.is_error !== true;
        const text = typeof rec.result === 'string' ? rec.result : '';
        emit({
          type: 'result',
          ok,
          text: ok ? text : '',
          error: ok ? null : text || 'claude reported an error',
          sessionId: typeof rec.session_id === 'string' ? rec.session_id : null,
          durationMs: Number.isFinite(rec.duration_ms) ? rec.duration_ms : null,
          costUsd: Number.isFinite(rec.total_cost_usd) ? rec.total_cost_usd : null,
        });
        return;
      }

      default:
        // `user` records carry tool results, and a tool result is a trace of
        // how the answer was reached rather than the answer. parse.mjs drops
        // them from the transcript for the same reason; so does this.
        return;
    }
  }

  /** @param {any} event the Anthropic streaming event `stream_event` wraps */
  function handleStreamEvent(event) {
    if (!event || typeof event !== 'object') return;
    switch (event.type) {
      case 'content_block_start': {
        const block = event.content_block;
        if (block && typeof block === 'object' && block.type === 'tool_use') {
          openTools.set(Number(event.index), { name: oneLine(block.name, 40), json: '' });
        }
        return;
      }
      case 'content_block_delta': {
        const delta = event.delta;
        if (!delta || typeof delta !== 'object') return;
        if (delta.type === 'input_json_delta') {
          const open = openTools.get(Number(event.index));
          // Bounded: a tool input this project only wants one field out of
          // must not be able to grow a buffer.
          if (open && open.json.length < 64 * 1024 && typeof delta.partial_json === 'string') {
            open.json += delta.partial_json;
          }
          return;
        }
        // Only prose from here. `thinking_delta` is the model's private
        // reasoning; it is not something the panel is entitled to render as
        // the agent's reply.
        if (delta.type !== 'text_delta') return;
        if (typeof delta.text !== 'string' || !delta.text) return;
        sawDelta = true;
        emit({ type: 'delta', text: delta.text });
        return;
      }
      case 'content_block_stop':
        flushTool(Number(event.index));
        return;
      case 'message_stop':
        // A truncated stream can leave a tool block open. Say what it was
        // rather than silently losing it.
        for (const index of [...openTools.keys()]) flushTool(index);
        emit({ type: 'turn' });
        return;
      default:
        return;
    }
  }

  /** @param {number} index */
  function flushTool(index) {
    const open = openTools.get(index);
    if (!open) return;
    openTools.delete(index);
    let input = null;
    try {
      const parsed = JSON.parse(open.json);
      if (parsed && typeof parsed === 'object') input = parsed;
    } catch {
      // A half-arrived argument. The name alone is still true.
    }
    const block = { name: open.name, input };
    emit({ type: 'tool', name: open.name, summary: toolSummaryOf(block) });
  }

  return {
    /** @param {string} chunk */
    push(chunk) {
      if (typeof chunk !== 'string' || !chunk) return;
      buffer += chunk;
      let nl;
      while ((nl = buffer.indexOf('\n', scanned)) !== -1) {
        const line = buffer.slice(0, nl);
        buffer = buffer.slice(nl + 1);
        scanned = 0;
        if (overlong) {
          // The oversized line ended here. Resume with the next one.
          overlong = false;
          continue;
        }
        handleLine(line);
      }
      scanned = buffer.length;
      if (buffer.length > MAX_LINE_BYTES) {
        // Refuse the line rather than the process: drop what has been
        // buffered and skip forward to the next newline.
        buffer = '';
        scanned = 0;
        overlong = true;
      }
    },
    end() {
      if (!overlong && buffer) handleLine(buffer);
      buffer = '';
      scanned = 0;
      overlong = false;
    },
    get sawResult() {
      return state.sawResult;
    },
  };
}

/**
 * The one-line summary a `tool` event carries, exported so the shape can be
 * asserted without driving a whole stream through the parser.
 */
export { toolSummaryOf as _toolSummaryOf };

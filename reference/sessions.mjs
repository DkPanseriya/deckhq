// Session discovery and transcript parsing for Claude Code.
//
// Two sources, deliberately separated:
//   liveSessions()  - `claude agents --json`, the officially supported roster.
//                     Authoritative for "is this process alive right now".
//   scanTranscripts() - ~/.claude/projects/<slug>/<sessionId>.jsonl.
//                     Internal format, documented as unstable. Used only for
//                     title, cost and message text. Everything it touches is
//                     isolated here so a format change is one file to fix.

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const execFileP = promisify(execFile);

export const CLAUDE_DIR = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
export const PROJECTS_DIR = path.join(CLAUDE_DIR, 'projects');

// Rough list prices per million tokens. Used for a relative cost signal, not billing.
const PRICES = {
  'claude-opus-5':     { in: 15,   out: 75,   cacheRead: 1.50,  cacheWrite: 18.75 },
  'claude-fable-5':    { in: 15,   out: 75,   cacheRead: 1.50,  cacheWrite: 18.75 },
  'claude-sonnet-5':   { in: 3,    out: 15,   cacheRead: 0.30,  cacheWrite: 3.75  },
  'claude-haiku-4-5':  { in: 1,    out: 5,    cacheRead: 0.10,  cacheWrite: 1.25  },
  default:             { in: 3,    out: 15,   cacheRead: 0.30,  cacheWrite: 3.75  },
};

// A session Claude last spoke in counts as a debt only inside this window.
export const OWED_WINDOW_MS = 3 * 86400_000;   // 72h
// Older than this and it is history, not floor traffic.
export const STALE_MS = 14 * 86400_000;

function priceFor(model = '') {
  const key = Object.keys(PRICES).find((k) => k !== 'default' && model.startsWith(k));
  return PRICES[key] || PRICES.default;
}

/** Live sessions from the supported CLI surface. Never throws. */
export async function liveSessions() {
  try {
    const { stdout } = await execFileP('claude', ['agents', '--json'], {
      timeout: 15000, windowsHide: true, maxBuffer: 4 * 1024 * 1024,
    });
    const parsed = JSON.parse(stdout);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** `C--Dk-Projects-1-1percent-better` -> best-effort real path. */
function slugToPath(slug) {
  const m = slug.match(/^([A-Za-z])--(.*)$/);
  if (!m) return slug;
  return `${m[1]}:\\${m[2].replace(/-/g, '\\')}`;
}

function projectLabel(cwd) {
  if (!cwd) return 'unknown';
  const parts = cwd.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] || cwd;
}

/**
 * Read the tail of a file as text. Session transcripts grow to hundreds of MB;
 * we only ever need the head (for the title) and the tail (for recent turns).
 */
function readTail(file, bytes) {
  const size = fs.statSync(file).size;
  const len = Math.min(size, bytes);
  const fd = fs.openSync(file, 'r');
  try {
    const buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, size - len);
    return { text: buf.toString('utf8'), truncated: size > len, size };
  } finally {
    fs.closeSync(fd);
  }
}

function readHead(file, bytes) {
  const fd = fs.openSync(file, 'r');
  try {
    const buf = Buffer.alloc(bytes);
    const n = fs.readSync(fd, buf, 0, bytes, 0);
    return buf.subarray(0, n).toString('utf8');
  } finally {
    fs.closeSync(fd);
  }
}

function* jsonLines(text) {
  for (const line of text.split('\n')) {
    const t = line.trim();
    if (!t.startsWith('{')) continue;
    try { yield JSON.parse(t); } catch { /* partial line at a chunk edge */ }
  }
}

/**
 * Flatten an assistant/user content field to the prose a human actually said.
 * Tool calls, tool results and thinking blocks are deliberately dropped: the
 * panel is a conversation, not a trace, and a turn that only fired a tool is
 * not a turn that is waiting on you.
 */
function contentToText(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  const out = [];
  for (const block of content) {
    if (!block || typeof block !== 'object') continue;
    if (block.type === 'text' && block.text) out.push(block.text);
  }
  return out.join('\n\n').trim();
}

/**
 * Summarise one transcript file: title, model, cost, last turn, who spoke last.
 * Reads at most ~2.5MB per file regardless of size.
 */
export function summariseTranscript(file) {
  let head, tail;
  try {
    head = readHead(file, 262144);
    tail = readTail(file, 2 * 1024 * 1024);
  } catch {
    return null;
  }

  const sessionId = path.basename(file, '.jsonl');
  let title = null, cwd = null, gitBranch = null, model = null;
  let lastRole = null, lastText = '', lastTs = null, turns = 0;
  const usage = { in: 0, out: 0, cacheRead: 0, cacheWrite: 0 };

  // Title records appear early; scan the head for them.
  for (const rec of jsonLines(head)) {
    if (rec.type === 'custom-title' && rec.customTitle) title = rec.customTitle;
    if (rec.cwd && !cwd) cwd = rec.cwd;
  }

  for (const rec of jsonLines(tail.text)) {
    if (rec.type === 'custom-title' && rec.customTitle) title = rec.customTitle;
    if (rec.cwd) cwd = rec.cwd;
    if (rec.gitBranch) gitBranch = rec.gitBranch;

    if (rec.type === 'assistant' && rec.message) {
      const u = rec.message.usage;
      if (u) {
        usage.in += u.input_tokens || 0;
        usage.out += u.output_tokens || 0;
        usage.cacheRead += u.cache_read_input_tokens || 0;
        usage.cacheWrite += u.cache_creation_input_tokens || 0;
      }
      if (rec.message.model) model = rec.message.model;
      const text = contentToText(rec.message.content);
      if (text) { lastRole = 'assistant'; lastText = text; lastTs = rec.timestamp || lastTs; turns++; }
    } else if (rec.type === 'user' && rec.message) {
      const text = contentToText(rec.message.content);
      if (text) { lastRole = 'user'; lastText = text; lastTs = rec.timestamp || lastTs; turns++; }
    }
  }

  if (!lastRole) return null; // no real conversation in this file

  const p = priceFor(model || '');
  const cost =
    (usage.in / 1e6) * p.in +
    (usage.out / 1e6) * p.out +
    (usage.cacheRead / 1e6) * p.cacheRead +
    (usage.cacheWrite / 1e6) * p.cacheWrite;

  let mtime = null;
  try { mtime = fs.statSync(file).mtimeMs; } catch { /* ignore */ }

  return {
    sessionId,
    file,
    title,
    cwd,
    gitBranch,
    model,
    // Headline number is real work: input + output. Cache reads are the same
    // context re-read every turn; summing them into one figure makes a chatty
    // session look enormous and tells you nothing you can act on.
    tokens: usage.in + usage.out,
    cacheTokens: usage.cacheRead + usage.cacheWrite,
    usage,
    cost,
    // Partial: only counts turns inside the tail window.
    turns,
    lastRole,
    lastText,
    lastTs: lastTs ? Date.parse(lastTs) : mtime,
    mtime,
    sizeBytes: tail.size,
  };
}

/** Every transcript on disk, newest first. */
export function scanTranscripts({ maxAgeDays = 45, limit = 300 } = {}) {
  if (!fs.existsSync(PROJECTS_DIR)) return [];
  const cutoff = Date.now() - maxAgeDays * 86400_000;
  const files = [];

  for (const slug of fs.readdirSync(PROJECTS_DIR)) {
    const dir = path.join(PROJECTS_DIR, slug);
    let stat;
    try { stat = fs.statSync(dir); } catch { continue; }
    if (!stat.isDirectory()) continue;
    for (const name of fs.readdirSync(dir)) {
      if (!name.endsWith('.jsonl')) continue;
      const full = path.join(dir, name);
      try {
        const s = fs.statSync(full);
        if (s.mtimeMs < cutoff || s.size < 512) continue;
        files.push({ full, slug, mtimeMs: s.mtimeMs });
      } catch { /* ignore */ }
    }
  }

  files.sort((a, b) => b.mtimeMs - a.mtimeMs);
  const out = [];
  for (const f of files.slice(0, limit)) {
    const s = summariseTranscript(f.full);
    if (!s) continue;
    if (!s.cwd) s.cwd = slugToPath(f.slug);
    s.slug = f.slug;
    out.push(s);
  }
  return out;
}

/** Full message list for one session, for the chat panel. */
export function readConversation(file, { maxMessages = 120 } = {}) {
  let text;
  try { text = readTail(file, 6 * 1024 * 1024).text; } catch { return []; }
  const msgs = [];
  for (const rec of jsonLines(text)) {
    if (rec.type === 'assistant' && rec.message) {
      const body = contentToText(rec.message.content);
      if (body) msgs.push({ role: 'assistant', text: body, ts: rec.timestamp || null, model: rec.message.model || null });
    } else if (rec.type === 'user' && rec.message) {
      const body = contentToText(rec.message.content);
      if (body) msgs.push({ role: 'user', text: body, ts: rec.timestamp || null });
    }
  }
  return msgs.slice(-maxMessages);
}

/** Merge the live roster with disk transcripts into one agent list. */
export function buildAgents({ live, transcripts, ackState }) {
  const liveBySession = new Map(live.map((s) => [s.sessionId, s]));
  const agents = [];

  for (const t of transcripts) {
    const l = liveBySession.get(t.sessionId);
    const ack = ackState[t.sessionId] || {};

    // Derived, never authoritative over ack_state.
    let runtimeState;
    if (l) runtimeState = t.lastRole === 'assistant' ? 'needs_input' : 'working';
    else runtimeState = 'ended';

    // Default ack_state. A session only counts as a live debt if Claude spoke
    // last AND it was recent; otherwise every months-old transcript would
    // arrive as an unanswered obligation and the queue would be noise on day
    // one. Anything the user has explicitly acted on always wins over this.
    const ageMs = Date.now() - (t.lastTs || 0);
    let ackStateValue = ack.state;
    if (!ackStateValue) {
      if (ageMs > STALE_MS) ackStateValue = 'archived';
      else if (t.lastRole === 'assistant' && ageMs < OWED_WINDOW_MS) ackStateValue = 'owed';
      else ackStateValue = 'clear';
    }
    if (ackStateValue === 'snoozed' && ack.until && Date.now() > ack.until) {
      ackStateValue = 'owed';
    }

    agents.push({
      id: t.sessionId,
      title: t.title || l?.name || t.sessionId.slice(0, 8),
      hasCustomTitle: Boolean(t.title),
      project: projectLabel(t.cwd),
      cwd: t.cwd,
      gitBranch: t.gitBranch,
      model: t.model,
      live: Boolean(l),
      pid: l?.pid || null,
      runtimeState,
      ackState: ackStateValue,
      owedSince: ack.owedSince || t.lastTs,
      snoozedUntil: ack.until || null,
      tokens: t.tokens,
      cacheTokens: t.cacheTokens,
      cost: t.cost,
      lastRole: t.lastRole,
      lastText: t.lastText.slice(0, 400),
      lastTs: t.lastTs,
      file: t.file,
    });
  }

  // Live sessions with no usable transcript yet still deserve a desk.
  for (const l of live) {
    if (agents.some((a) => a.id === l.sessionId)) continue;
    agents.push({
      id: l.sessionId,
      title: l.name || l.sessionId.slice(0, 8),
      hasCustomTitle: false,
      project: projectLabel(l.cwd),
      cwd: l.cwd,
      model: null,
      live: true,
      pid: l.pid,
      runtimeState: 'working',
      ackState: 'clear',
      owedSince: l.startedAt,
      tokens: 0,
      cost: 0,
      lastRole: null,
      lastText: '',
      lastTs: l.startedAt,
      file: null,
    });
  }

  return agents;
}

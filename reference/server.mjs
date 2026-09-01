// DeckHQ daemon. Binds to loopback only.
//
// Owns two things the runtime does not: acknowledgement state (which outranks
// runtime state, always) and the roll-up the floor renders.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  liveSessions, scanTranscripts, buildAgents, readConversation,
} from './lib/sessions.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(__dirname, 'public');
const STATE_FILE = path.join(__dirname, 'state.json');
const PORT = Number(process.env.PORT || 4317);
const HOST = '127.0.0.1';

// ---------------------------------------------------------------- ack state
function loadState() {
  try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); }
  catch { return { ack: {} }; }
}
function saveState(s) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(s, null, 2));
}
let state = loadState();

// ------------------------------------------------------------------- cache
let cache = { at: 0, agents: [], live: [] };
const CACHE_MS = 4000;

async function getAgents(force = false) {
  if (!force && Date.now() - cache.at < CACHE_MS) return cache;
  const live = await liveSessions();
  const transcripts = scanTranscripts({ maxAgeDays: 60, limit: 200 });
  const agents = buildAgents({ live, transcripts, ackState: state.ack });
  cache = { at: Date.now(), agents, live };
  return cache;
}

function rollUp(agents) {
  const zones = new Map();
  for (const a of agents) {
    if (a.ackState === 'archived') continue;
    if (!zones.has(a.project)) {
      zones.set(a.project, { id: a.project, name: a.project, cwd: a.cwd, agents: 0, owed: 0, tokens: 0, cost: 0 });
    }
    const z = zones.get(a.project);
    z.agents++; z.tokens += a.tokens; z.cost += a.cost;
    if (a.ackState === 'owed') z.owed++;
  }
  return [...zones.values()].sort((x, y) => y.tokens - x.tokens);
}

// ------------------------------------------------------------------ helpers
function json(res, code, body) {
  const s = JSON.stringify(body);
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(s) });
  res.end(s);
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let d = '';
    req.on('data', (c) => { d += c; if (d.length > 1e6) req.destroy(); });
    req.on('end', () => { try { resolve(d ? JSON.parse(d) : {}); } catch (e) { reject(e); } });
    req.on('error', reject);
  });
}
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json' };

function serveStatic(req, res, pathname) {
  const rel = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const file = path.join(PUBLIC, rel);
  if (!file.startsWith(PUBLIC)) { res.writeHead(403); return res.end('forbidden'); }
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(buf);
  });
}

// -------------------------------------------------------------------- routes
const server = http.createServer(async (req, res) => {
  const { pathname, query } = url.parse(req.url, true);

  try {
    if (pathname === '/api/state') {
      const { agents } = await getAgents(query.force === '1');
      return json(res, 200, {
        now: Date.now(),
        agents,
        zones: rollUp(agents),
        counts: {
          total: agents.length,
          onFloor: agents.filter((a) => a.ackState !== 'archived').length,
          owed: agents.filter((a) => a.ackState === 'owed').length,
          live: agents.filter((a) => a.live).length,
        },
      });
    }

    if (pathname === '/api/conversation') {
      const { agents } = await getAgents();
      const a = agents.find((x) => x.id === query.id);
      if (!a) return json(res, 404, { error: 'unknown session' });
      if (!a.file) return json(res, 200, { messages: [], note: 'No transcript on disk yet.' });
      return json(res, 200, { messages: readConversation(a.file), agent: a });
    }

    if (pathname === '/api/ack' && req.method === 'POST') {
      const { id, action, hours } = await readBody(req);
      if (!id || !action) return json(res, 400, { error: 'id and action required' });
      const entry = state.ack[id] || {};
      if (action === 'acknowledge') { entry.state = 'clear'; entry.owedSince = null; }
      else if (action === 'owe') { entry.state = 'owed'; entry.owedSince = Date.now(); }
      else if (action === 'snooze') { entry.state = 'snoozed'; entry.until = Date.now() + (Number(hours) || 24) * 3600_000; }
      else if (action === 'archive') { entry.state = 'archived'; }
      else if (action === 'restore') { entry.state = 'clear'; }
      else return json(res, 400, { error: 'unknown action' });
      state.ack[id] = entry;
      saveState(state);
      cache.at = 0;
      return json(res, 200, { ok: true, id, ack: entry });
    }

    // Sends a real turn into a real session. Deliberate, user-initiated only.
    if (pathname === '/api/send' && req.method === 'POST') {
      const { id, text } = await readBody(req);
      if (!id || !text) return json(res, 400, { error: 'id and text required' });
      const { agents } = await getAgents();
      const a = agents.find((x) => x.id === id);
      if (!a) return json(res, 404, { error: 'unknown session' });

      const child = spawn('claude', ['--resume', id, '-p', text, '--output-format', 'json'], {
        cwd: a.cwd && fs.existsSync(a.cwd) ? a.cwd : process.cwd(),
        windowsHide: true,
      });
      let out = '', err = '';
      child.stdout.on('data', (d) => { out += d; });
      child.stderr.on('data', (d) => { err += d; });
      const done = await new Promise((resolve) => {
        const t = setTimeout(() => { child.kill(); resolve({ timeout: true }); }, 180000);
        child.on('close', (code) => { clearTimeout(t); resolve({ code }); });
        child.on('error', (e) => { clearTimeout(t); resolve({ error: e.message }); });
      });
      cache.at = 0;
      if (done.error) return json(res, 500, { error: done.error });
      if (done.timeout) return json(res, 504, { error: 'timed out after 180s' });
      let parsed = null;
      try { parsed = JSON.parse(out); } catch { /* not json */ }
      return json(res, 200, { ok: done.code === 0, code: done.code, result: parsed, raw: parsed ? null : out.slice(0, 4000), stderr: err.slice(0, 2000) });
    }

    if (pathname === '/api/open' && req.method === 'POST') {
      const { id } = await readBody(req);
      const { agents } = await getAgents();
      const a = agents.find((x) => x.id === id);
      if (!a) return json(res, 404, { error: 'unknown session' });
      const cwd = a.cwd && fs.existsSync(a.cwd) ? a.cwd : process.cwd();
      if (process.platform === 'win32') {
        spawn('cmd', ['/c', 'start', '', 'cmd', '/k', `cd /d "${cwd}" && claude --resume ${id}`], { detached: true, windowsHide: false }).unref();
      } else {
        spawn('sh', ['-c', `cd "${cwd}" && claude --resume ${id}`], { detached: true }).unref();
      }
      return json(res, 200, { ok: true });
    }

    return serveStatic(req, res, pathname);
  } catch (e) {
    return json(res, 500, { error: e.message });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`\n  DeckHQ  →  http://${HOST}:${PORT}\n`);
});

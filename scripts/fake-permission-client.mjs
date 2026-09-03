#!/usr/bin/env node
/**
 * Play the runtime's `PermissionRequest` hook against a running DeckHQ.
 *
 * WP-19's acceptance criterion is a live Claude Code session raising a prompt
 * and the panel answering it, and that run is still owed — the CLI's stored
 * OAuth token on the reference machine is expired, so no tool call can be
 * provoked (`docs/DEVIATIONS.md` §86.1, §94). Everything up to that boundary
 * is exercised here instead: this script sends the payload the runtime sends,
 * to the endpoint the runtime posts to, waits on the socket exactly as the
 * runtime waits, and prints the body it gets back.
 *
 * It is NOT a mock of the daemon. The route, the hold, the adapter's parser,
 * the registry, the SSE push and the panel are all the real ones; only the
 * caller is fake. That makes it useful for three things:
 *
 *   1. Driving the panel by hand while working on the card.
 *   2. The integration test in test/integration/permission.test.mjs, which
 *      spawns it and answers from the API.
 *   3. Standing up the screenshot in docs/media/permission-card.png.
 *
 *   node scripts/fake-permission-client.mjs --port 4317
 *   node scripts/fake-permission-client.mjs --port 4499 --tool Bash --input "rm -rf build"
 *   node scripts/fake-permission-client.mjs --port 4499 --tool AskUserQuestion
 *   node scripts/fake-permission-client.mjs --port 4499 --no-suggestions
 *
 * With no `--session`, it asks the daemon for its first agent and borrows that
 * session's id and cwd, so the card lands on somebody who is actually on the
 * floor. That is a convenience of the harness; the runtime always knows its
 * own session id.
 *
 * Exit code 0 if a decision came back, 1 if the hold fell through with no
 * decision (which is the correct outcome on a timeout, and what the terminal
 * prompt is for).
 */
import http from 'node:http';
import process from 'node:process';

const argv = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = argv.indexOf(name);
  return i !== -1 && argv[i + 1] !== undefined ? argv[i + 1] : fallback;
};
const flag = (name) => argv.includes(name);

const PORT = Number(opt('--port', 4317));
const TOOL = opt('--tool', 'Bash');
const INPUT = opt('--input', '');
const CWD = opt('--cwd', '');
const TOOL_USE_ID = opt('--id', `toolu_fake_${Date.now().toString(36)}`);
const SESSION = opt('--session', '');
/** How long this fake runtime is willing to wait, in seconds. */
const WAIT_SECONDS = Number(opt('--wait', 600));
const QUIET = flag('--quiet');
const NO_SUGGESTIONS = flag('--no-suggestions');

const say = (...args) => {
  if (!QUIET) console.error(...args);
};

/** @param {string} path */
function getJson(path) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: PORT, path, method: 'GET' }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
        } catch (err) {
          reject(err);
        }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

/**
 * The session this request should appear to come from. Named explicitly, or
 * borrowed from whoever is first in the daemon's own queue order.
 * @returns {Promise<{sessionId:string, cwd:string}>}
 */
async function target() {
  if (SESSION) return { sessionId: SESSION, cwd: CWD || process.cwd() };
  let snapshot;
  try {
    snapshot = await getJson('/api/state');
  } catch (err) {
    throw new Error(
      `Could not read http://127.0.0.1:${PORT}/api/state (${err.message}). ` +
        'Start DeckHQ first, or pass --session and --cwd.',
    );
  }
  const agent = (snapshot.agents || [])[0];
  if (!agent) {
    throw new Error('That daemon has no sessions to attach a permission request to.');
  }
  // Agent ids are `<runtime>:<sessionId>`; the runtime sends the bare id.
  const bare = String(agent.id).includes(':')
    ? String(agent.id).slice(String(agent.id).indexOf(':') + 1)
    : String(agent.id);
  return { sessionId: bare, cwd: CWD || agent.cwd || process.cwd() };
}

/**
 * The tool input the payload carries. Matches the shape the runtime sends for
 * the tools it sends most.
 * @param {string} tool
 */
function toolInput(tool) {
  if (tool === 'Bash') {
    return { command: INPUT || 'npm run deploy -- --production', description: 'Run the deploy' };
  }
  if (tool === 'Write' || tool === 'Edit') {
    return { file_path: INPUT || 'src/events/backfill.ts', content: '…' };
  }
  if (tool === 'WebFetch') return { url: INPUT || 'https://example.invalid/spec' };
  if (tool === 'AskUserQuestion') return { question: INPUT || 'Which approach should I take?' };
  return INPUT ? { input: INPUT } : {};
}

/**
 * The `permission_suggestions` the runtime attaches: the rules its own prompt
 * would have offered as "don't ask again". `destination` arrives pointing at a
 * settings file, and DeckHQ's job is to retarget it at the session and never
 * to send it back as it came (`docs/DEVIATIONS.md` §86.3).
 * @param {string} tool
 */
function suggestions(tool) {
  if (NO_SUGGESTIONS || tool === 'AskUserQuestion') return [];
  const ruleContent =
    tool === 'Bash' ? `${String(INPUT || 'npm run deploy').split(' ')[0]}:*` : undefined;
  return [
    {
      type: 'addRules',
      rules: [ruleContent ? { toolName: tool, ruleContent } : { toolName: tool }],
      behavior: 'allow',
      destination: 'localSettings',
    },
  ];
}

const { sessionId, cwd } = await target();

const payload = {
  session_id: sessionId,
  transcript_path: `${cwd}/.claude/transcript.jsonl`,
  cwd,
  prompt_id: '550e8400-e29b-41d4-a716-446655440000',
  permission_mode: 'default',
  hook_event_name: 'PermissionRequest',
  tool_name: TOOL,
  tool_input: toolInput(TOOL),
  tool_use_id: TOOL_USE_ID,
  permission_suggestions: suggestions(TOOL),
};

say(`[hand up] ${TOOL} in ${cwd}`);
say(`  session ${sessionId}`);
say(`  id      ${TOOL_USE_ID}`);
say(`  waiting on http://127.0.0.1:${PORT}/api/permission — answer it in the panel`);

const body = Buffer.from(JSON.stringify(payload));

const decision = await new Promise((resolve, reject) => {
  const req = http.request(
    {
      host: '127.0.0.1',
      port: PORT,
      path: '/api/permission',
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': body.length },
    },
    (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    },
  );
  // The runtime gives up after its own timeout and falls back to the terminal
  // prompt. So does this: no answer is a valid, expected outcome.
  req.setTimeout(WAIT_SECONDS * 1000, () => {
    req.destroy(new Error(`no answer within ${WAIT_SECONDS}s`));
  });
  req.on('error', reject);
  req.end(body);
});

// stdout is the decision and nothing else, so a caller can pipe it.
process.stdout.write(decision.endsWith('\n') ? decision : `${decision}\n`);

let parsed;
try {
  parsed = JSON.parse(decision);
} catch {
  parsed = null;
}
const inner = parsed?.hookSpecificOutput?.decision;
if (!inner || !inner.behavior) {
  say('[fell through] no decision — the terminal prompt is what answers this one.');
  process.exit(1);
}
say(`[answered] ${inner.behavior}${inner.updatedPermissions ? ' + a session rule' : ''}`);

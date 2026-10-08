/**
 * WP-100 · `GET /api/conversation?detail=1`, against a real daemon.
 *
 * The panel asks for a conversation WITH what the agent did. Two things are
 * held here that a unit test of the reader cannot hold: that the plain request
 * every other caller makes answers exactly as it did, and that reading the
 * richer one is still a read.
 */
// First, and before anything under `src/`: it moves the machine.
import { CLAUDE_DIR, HOME, daemonScratch } from '../helpers/isolate.mjs';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';

import { REPLY, richTranscriptJsonl } from '../fixtures/rich-transcript.mjs';

const { startDaemon } = await import('../../src/daemon.mjs');

const SESSION = '55555555-5555-5555-5555-555555555555';

test('detail=1 adds tools and reasoning; the plain request is what it always was; and both are reads', async () => {
  const cwd = path.join(HOME, 'code', 'panel');
  const dir = path.join(CLAUDE_DIR, 'projects', cwd.replace(/[\\/:]+/g, '-'));
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, `${SESSION}.jsonl`),
    richTranscriptJsonl({ sessionId: SESSION, cwd }),
  );

  const scratch = daemonScratch('detail-');
  const d = await startDaemon({
    port: 0,
    stateFile: scratch.stateFile,
    publicDir: scratch.publicDir,
  });
  try {
    await d.registry.refresh();
    const agent = d.registry.agents.find((a) => a.id.endsWith(SESSION));
    assert.ok(agent, 'the planted session did not reach the floor');
    const { ackState, reviewSince } = agent;
    const url = `${d.url}api/conversation?id=${encodeURIComponent(agent.id)}`;

    const plain = await (await fetch(url)).json();
    assert.deepEqual(
      plain.messages.map((m) => m.role),
      ['user', 'assistant', 'assistant', 'user', 'assistant'],
    );
    assert.ok(plain.messages.every((m) => !('tool' in m)));

    const detail = await (await fetch(`${url}&detail=1&limit=400`)).json();
    const roles = detail.messages.map((m) => m.role);
    assert.equal(roles.filter((r) => r === 'tool').length, 5);
    assert.equal(roles.filter((r) => r === 'thinking').length, 2);
    assert.equal(detail.messages[detail.messages.length - 1].text, REPLY);
    const bash = detail.messages.find((m) => m.role === 'tool' && m.tool.name === 'Bash');
    assert.equal(bash.tool.summary, 'Bash npm test');
    assert.equal(bash.tool.resultTruncated, true);

    // INVARIANT: reading a conversation, in either shape, clears nothing.
    const after = d.registry.agents.find((a) => a.id === agent.id);
    assert.equal(after.ackState, ackState);
    assert.equal(after.reviewSince, reviewSince);
  } finally {
    await d.close();
    await fsp.rm(dir, { recursive: true, force: true });
    await fsp.rm(scratch.dir, { recursive: true, force: true });
  }
});

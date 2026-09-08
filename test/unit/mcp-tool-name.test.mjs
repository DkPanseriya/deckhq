// A machine of our own, before anything under `src/` is loaded.
// `docs/DEVIATIONS.md` §124.
import '../helpers/isolate.mjs';

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  displayServer,
  humaniseToolSummary,
  isMcpToolName,
  mcpToolLabel,
  parseMcpToolName,
} from '../../src/core/mcp-tool-name.mjs';

// WP-64. The module under test lives in `public/` and is re-exported from
// `src/core/` (the §122 direction: `public/` may never import from `src/`).
// The import above is the re-export on purpose, so the test covers both.

test('mcp__<server>__<tool> splits into its two halves', () => {
  assert.deepEqual(parseMcpToolName('mcp__gmail__send'), { server: 'gmail', tool: 'send' });
  assert.deepEqual(parseMcpToolName('mcp__linear__create_issue'), {
    server: 'linear',
    tool: 'create_issue',
  });
  // A single underscore is legal in BOTH halves; the split is the first `__`.
  assert.deepEqual(parseMcpToolName('mcp__ccd_session__mark_chapter'), {
    server: 'ccd_session',
    tool: 'mark_chapter',
  });
  // A tool name that itself contains a double underscore stays whole.
  assert.deepEqual(parseMcpToolName('mcp__srv__a__b'), { server: 'srv', tool: 'a__b' });
});

test('anything that is not an MCP id is null, and never throws', () => {
  for (const name of [
    'Bash',
    'WebFetch',
    '',
    'mcp__',
    'mcp____tool', // empty server
    'mcp__server__', // empty tool
    'mcp__server', // no separator
    'notmcp__server__tool',
    null,
    undefined,
    42,
    {},
  ]) {
    assert.equal(parseMcpToolName(/** @type {any} */ (name)), null, String(name));
    assert.equal(isMcpToolName(/** @type {any} */ (name)), false, String(name));
  }
});

test('the display label is `Server · tool`, and renames nothing else', () => {
  assert.equal(mcpToolLabel('mcp__gmail__send'), 'Gmail · send');
  // No underscore-to-space rewriting, no title casing of every word: the
  // server is the name the user gave it and the tool is the tool's own name.
  assert.equal(mcpToolLabel('mcp__ccd_session__mark_chapter'), 'Ccd_session · mark_chapter');
  assert.equal(mcpToolLabel('mcp__claude-in-chrome__read_page'), 'Claude-in-chrome · read_page');
  // A server whose name already starts upper-cased is untouched.
  assert.equal(mcpToolLabel('mcp__Gmail__send'), 'Gmail · send');
  // A non-MCP name comes back exactly as it went in, so a caller can pass
  // every tool name through this without asking first.
  assert.equal(mcpToolLabel('Bash'), 'Bash');
  assert.equal(mcpToolLabel(''), '');
  assert.equal(mcpToolLabel(/** @type {any} */ (null)), '');
});

test('displayServer upper-cases the first character and nothing else', () => {
  assert.equal(displayServer('gmail'), 'Gmail');
  assert.equal(displayServer('a'), 'A');
  assert.equal(displayServer(''), '');
  assert.equal(displayServer('9to5'), '9to5');
});

test('a summary that is the bare id becomes the label; every other summary is untouched', () => {
  assert.equal(humaniseToolSummary('mcp__gmail__send', 'mcp__gmail__send'), 'Gmail · send');
  // A summary the adapter grew arguments for keeps them, verbatim.
  assert.equal(
    humaniseToolSummary('mcp__gmail__send', 'mcp__gmail__send to:ada@example.invalid'),
    'Gmail · send to:ada@example.invalid',
  );
  // A non-MCP tool is never rewritten — this is what keeps the floor's
  // ordinary bubbles pixel-identical.
  assert.equal(humaniseToolSummary('Bash', 'Bash npm test'), 'Bash npm test');
  // A summary that does not begin with the tool's own name is something this
  // function did not build and must not edit.
  assert.equal(humaniseToolSummary('mcp__gmail__send', 'something else'), 'something else');
  // An empty summary still names the tool rather than drawing an empty bubble.
  assert.equal(humaniseToolSummary('mcp__gmail__send', ''), 'Gmail · send');
  assert.equal(humaniseToolSummary(/** @type {any} */ (null), /** @type {any} */ (null)), '');
});

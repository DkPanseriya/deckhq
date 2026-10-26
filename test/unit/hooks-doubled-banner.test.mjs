/**
 * Hooks installed twice over: the header says so, and only when nothing more
 * urgent holds the banner. A re-saving tool left the owner's settings file
 * with every DeckHQ entry twice (25 October 2026), so every event ran twice.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hooksDoubled, DOUBLED_HOOKS_TEXT } from '../../public/hooks-status.js';

test('a doubled set is reported only for a runtime whose hooks are installed', () => {
  assert.equal(
    hooksDoubled({ 'claude-code': { supported: true, installed: true, doubled: true } }),
    true,
  );
  assert.equal(hooksDoubled({ 'claude-code': { supported: true, installed: true } }), false);
  assert.equal(
    hooksDoubled({ 'claude-code': { supported: true, installed: false, doubled: true } }),
    false,
  );
  assert.equal(hooksDoubled(null), false);
  assert.match(DOUBLED_HOOKS_TEXT, /twice/);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDrafts, memoryStorage } from '../../public/drafts.js';

test('a draft round-trips per session id and blank text clears it', () => {
  const d = createDrafts(memoryStorage());
  assert.equal(d.load('claude-code:a'), '');
  assert.equal(d.has('claude-code:a'), false);
  d.save('claude-code:a', 'Yes, but rename the flag first.');
  d.save('claude-code:b', 'second');
  assert.equal(d.load('claude-code:a'), 'Yes, but rename the flag first.');
  assert.equal(d.has('claude-code:a'), true);
  assert.deepEqual(d.ids().sort(), ['claude-code:a', 'claude-code:b']);
  d.save('claude-code:a', '   \n');
  assert.equal(d.has('claude-code:a'), false);
  assert.deepEqual(d.ids(), ['claude-code:b']);
  d.clear('claude-code:b');
  assert.deepEqual(d.ids(), []);
});

test('a storage that throws reads as no drafts and never throws out', () => {
  const broken = {
    getItem() {
      throw new Error('SecurityError');
    },
    setItem() {
      throw new Error('QuotaExceededError');
    },
    removeItem() {
      throw new Error('SecurityError');
    },
    key() {
      throw new Error('SecurityError');
    },
    length: 1,
  };
  const d = createDrafts(broken);
  assert.doesNotThrow(() => d.save('x', 'text'));
  assert.equal(d.load('x'), '');
  assert.equal(d.has('x'), false);
  assert.deepEqual(d.ids(), []);
  assert.doesNotThrow(() => d.clear('x'));
});

test('drafts under other keys in the same storage are ignored', () => {
  const s = memoryStorage();
  s.setItem('deckhq.settings', '{}');
  s.setItem('unrelated', 'x');
  const d = createDrafts(s);
  d.save('claude-code:a', 'hi');
  assert.deepEqual(d.ids(), ['claude-code:a']);
});

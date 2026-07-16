import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveCommission, resolveSelection } from '../dist/index.js';

const c = resolveCommission({
  version: 1,
  assets: [
    { id: 'a1', prompt: 'x', px: [8, 8], out: 'a1.png', group: 'castle', tags: ['prop'], priority: 4 },
    { id: 'a2', prompt: 'x', px: [8, 8], out: 'a2.png', group: 'castle', tags: ['floor'], priority: 3 },
    { id: 'a3', prompt: 'x', px: [8, 8], out: 'a3.png', group: 'forest', tags: ['prop'], priority: 2 },
    { id: 'a4', prompt: 'x', px: [8, 8], out: 'a4.png', group: 'forest', tags: ['prop'], priority: 1, enabled: false },
  ],
}, '/tmp/sel/commission.json');

const ids = (s) => s.rows.map((r) => r.id);

test('default selection = all enabled, priority order', () => {
  const s = resolveSelection(c, { includeDisabled: false });
  assert.deepEqual(ids(s), ['a1', 'a2', 'a3']);
});

test('filters: group, tag, include-disabled', () => {
  assert.deepEqual(ids(resolveSelection(c, { groups: ['castle'], includeDisabled: false })), ['a1', 'a2']);
  assert.deepEqual(ids(resolveSelection(c, { tags: ['prop'], includeDisabled: false })), ['a1', 'a3']);
  assert.deepEqual(ids(resolveSelection(c, { tags: ['prop'], includeDisabled: true })), ['a1', 'a3', 'a4']);
});

test('explicit ids win and may name disabled rows', () => {
  assert.deepEqual(ids(resolveSelection(c, { ids: ['a4', 'a2'], includeDisabled: false })), ['a2', 'a4']);
});

test('top + batch slicing is deterministic and non-overlapping', () => {
  const s0 = resolveSelection(c, { batchSize: 2, batchIndex: 0, includeDisabled: false });
  const s1 = resolveSelection(c, { batchSize: 2, batchIndex: 1, includeDisabled: false });
  assert.deepEqual(ids(s0), ['a1', 'a2']);
  assert.deepEqual(ids(s1), ['a3']);
  assert.equal(s0.batchCount, 2);
  assert.deepEqual(ids(resolveSelection(c, { top: 1, includeDisabled: false })), ['a1']);
});

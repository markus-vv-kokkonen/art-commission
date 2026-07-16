import test from 'node:test';
import assert from 'node:assert/strict';
import { validateCommission, resolveCommission, keyClause } from '../dist/index.js';

const base = () => ({
  version: 1,
  palette: ['#111111', '#eeeeee'],
  assets: [
    { id: 'a', prompt: 'a crate', px: [32, 32], out: 'a.png' },
    { id: 'b', kind: 'tile', prompt: 'a floor', px: [64, 64], out: 'b.png', channel: 'FLOOR' },
  ],
});

test('a sound file validates clean', () => {
  assert.deepEqual(validateCommission(base()), []);
});

test('validation catches structural mistakes', () => {
  const raw = base();
  raw.assets.push({ id: 'a', prompt: 'dupe', px: [8, 8], out: 'dupe.png' });
  raw.assets.push({ id: 'c', kind: 'nope', prompt: 'x', px: [8, 8], out: 'c.png' });
  raw.assets.push({ id: 'd', prompt: 'no px', out: 'd.png' });
  raw.assets.push({ id: 'e', prompt: 'x', px: [8, 8], out: 'a.png' }); // out collision
  raw.assets.push({ id: 'f', prompt: 'x', px: [8, 8], out: 'f.png', styleAnchor: 'missing' });
  const errs = validateCommission(raw);
  assert.ok(errs.some((e) => e.includes('duplicate asset id "a"')), errs.join('\n'));
  assert.ok(errs.some((e) => e.includes('unknown kind "nope"')));
  assert.ok(errs.some((e) => e.includes('px [w, h] is required')));
  assert.ok(errs.some((e) => e.includes('both write to out')));
  assert.ok(errs.some((e) => e.includes('styleAnchor "missing" does not exist')));
});

test('anchor chains are limited to one level', () => {
  const raw = base();
  raw.assets = [
    { id: 'root', prompt: 'x', px: [8, 8], out: 'r.png' },
    { id: 'mid', prompt: 'x', px: [8, 8], out: 'm.png', styleAnchor: 'root' },
    { id: 'leaf', prompt: 'x', px: [8, 8], out: 'l.png', styleAnchor: 'mid' },
  ];
  const errs = validateCommission(raw);
  assert.ok(errs.some((e) => e.includes('one level deep')), errs.join('\n'));
});

test('quantize without a palette is an error', () => {
  const raw = { version: 1, assets: [{ id: 't', kind: 'tile', prompt: 'x', px: [8, 8], out: 't.png' }] };
  const errs = validateCommission(raw);
  assert.ok(errs.some((e) => e.includes('quantize needs a top-level palette')), errs.join('\n'));
});

test('resolution folds defaults: prompts, sizes, channels, ordering', () => {
  const raw = {
    version: 1,
    pxScale: 4,
    style: { prefix: 'STYLE.', suffix: 'PALETTE.', negative: 'NEG.' },
    palette: ['#111111'],
    assets: [
      { id: 'low', prompt: 'a low one', px: [10, 20], out: 'low.png', priority: 1 },
      { id: 'high', kind: 'tile', prompt: 'a floor', px: [64, 64], out: 'hi.png', priority: 9 },
      {
        id: 'drv', prompt: 'a pot', px: [16, 16], out: 'drv.png', priority: 5,
        derive: [{ id: 'drv_broken', prompt: 'smash it', out: 'drv_broken.png' }],
      },
    ],
  };
  const c = resolveCommission(raw, '/tmp/x/commission.json');
  // priority-sorted
  assert.deepEqual(c.assets.map((a) => a.id), ['high', 'drv', 'low']);
  const low = c.assets.find((a) => a.id === 'low');
  // cutout kind: key clause appended, style blocks wrapped, px scaled ×4
  assert.ok(low.prompt.startsWith('STYLE. a low one'));
  assert.ok(low.prompt.includes(keyClause('#ff00ff').trim()));
  assert.ok(low.prompt.includes('PALETTE.'));
  assert.ok(low.prompt.endsWith('NEG.'));
  assert.deepEqual(low.storePx, [40, 80]);
  // tile kind: exact px, quantize on, no key clause
  const high = c.assets.find((a) => a.id === 'high');
  assert.deepEqual(high.storePx, [64, 64]);
  assert.equal(high.post.quantize, true);
  assert.ok(!high.prompt.includes('backdrop'));
  // derive inherits px + post, gets the key clause (cutout post)
  const drv = c.assets.find((a) => a.id === 'drv');
  assert.equal(drv.derive.length, 1);
  assert.deepEqual(drv.derive[0].storePx, [64, 64]);
  assert.ok(drv.derive[0].prompt.includes('backdrop'));
  // absolute paths resolve against the file's directory
  assert.equal(low.outAbs, '/tmp/x/low.png');
  assert.ok(low.rawAbs.startsWith('/tmp/x/.art-raw/'));
});

test('resolution throws on an invalid file', () => {
  assert.throws(() => resolveCommission({ version: 2, assets: [] }, 'x.json'), /invalid commission file/);
});

/**
 * End-to-end over the mock provider: generate (anchors, derivations, skip
 * logic) → raws kept → wire → repost. No network, no keys, no spend.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import {
  loadCommission, runGenerate, runRepost, resolveSelection, writeManifest, renderTsModule, splitPhases,
} from '../dist/index.js';

const FILE_BODY = {
  version: 1,
  name: 'e2e',
  paths: { assetRoot: 'public', rawRoot: 'raw', manifest: 'manifest.json' },
  style: { suffix: 'Pixel art.', negative: 'no text.' },
  palette: ['#1a1c2c', '#f4f4f4', '#566c86'],
  pxScale: 2,
  providers: { default: 'mock' },
  assets: [
    {
      id: 'urn', kind: 'cutout', prompt: 'an urn', px: [20, 30], out: 'skins/urn.png',
      channel: 'PROP_ART', group: 'castle', priority: 5,
      derive: [{ id: 'urn_broken', prompt: 'smash the urn', out: 'skins/urn_broken.png' }],
    },
    { id: 'floor', kind: 'tile', prompt: 'a floor', px: [64, 64], out: 'skins/floor.png', channel: 'FLOOR_ART', group: 'castle', priority: 4 },
    { id: 'dawn', kind: 'still', prompt: 'dawn', aspect: '16:9', out: 'stills/dawn.png', channel: 'STILL_ART', group: 'stills', priority: 3 },
    { id: 'dusk', kind: 'still', prompt: 'dusk', aspect: '16:9', out: 'stills/dusk.png', channel: 'STILL_ART', group: 'stills', priority: 2, styleAnchor: 'dawn' },
    { id: 'benched', prompt: 'never generated', px: [8, 8], out: 'skins/benched.png', channel: 'PROP_ART', enabled: false },
  ],
};

async function setup() {
  const dir = await mkdtemp(join(tmpdir(), 'art-commission-'));
  const file = join(dir, 'commission.json');
  await writeFile(file, JSON.stringify(FILE_BODY, null, 2));
  return { dir, file };
}

test('generate → wire → repost, all offline via the mock provider', async (t) => {
  const { dir, file } = await setup();
  t.after(() => rm(dir, { recursive: true, force: true }));
  const c = await loadCommission(file);
  const sel = resolveSelection(c, { includeDisabled: false });
  assert.equal(sel.rows.length, 4, 'disabled row excluded');

  // anchors split: dawn must generate before dusk
  const phases = splitPhases(sel.rows, c, false);
  assert.deepEqual(phases.anchors.map((a) => a.id), ['dawn']);
  assert.ok(!phases.members.some((m) => m.id === 'dawn'));

  const log = [];
  const summary = await runGenerate(c, sel.rows, {}, (s) => log.push(s));
  assert.equal(summary.failed.length, 0, log.join('\n'));
  assert.equal(summary.generated, 4);

  // files landed where the format says, raws mirrored
  for (const rel of ['skins/urn.png', 'skins/urn_broken.png', 'skins/floor.png', 'stills/dawn.png', 'stills/dusk.png']) {
    assert.ok(existsSync(join(dir, 'public', rel)), `missing ${rel}`);
  }
  assert.ok(existsSync(join(dir, 'raw', 'skins/urn.png')), 'raw original kept');
  assert.ok(!existsSync(join(dir, 'public', 'skins/benched.png')), 'disabled row not generated');

  // cutout landed at px × pxScale with real alpha; tile at exact px, palette-locked
  const urn = await sharp(join(dir, 'public/skins/urn.png')).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  assert.equal(urn.info.width, 40);
  assert.equal(urn.info.height, 60);
  assert.equal(urn.data[3], 0, 'urn corner is transparent (chroma key cut)');
  const floor = await sharp(join(dir, 'public/skins/floor.png')).raw().toBuffer({ resolveWithObject: true });
  assert.equal(floor.info.width, 64);
  const fpx = [floor.data[0], floor.data[1], floor.data[2]];
  assert.ok([[0x1a, 0x1c, 0x2c], [0xf4, 0xf4, 0xf4], [0x56, 0x6c, 0x86]].some(
    (p) => p[0] === fpx[0] && p[1] === fpx[1] && p[2] === fpx[2]), `floor pixel ${fpx} not palette-locked`);

  // stills keep native resolution (no fit) — the mock emits its own size
  const dawn = await sharp(join(dir, 'public/stills/dawn.png')).metadata();
  assert.ok(dawn.width >= 64, 'still kept native px');

  // second run: everything skips (resumable by default)
  const again = await runGenerate(c, sel.rows, {}, () => {});
  assert.equal(again.generated, 0);
  assert.equal(again.skipped, 4);

  // wire: manifest maps channel → key → path; disabled row missing
  const scan = await writeManifest(c, { ts: true });
  const manifest = JSON.parse(await readFile(join(dir, 'manifest.json'), 'utf8'));
  assert.equal(manifest.channels.PROP_ART.urn, 'skins/urn.png');
  assert.equal(manifest.channels.PROP_ART.urn_broken, 'skins/urn_broken.png');
  assert.equal(manifest.channels.FLOOR_ART.floor, 'skins/floor.png');
  assert.equal(manifest.channels.STILL_ART.dusk, 'stills/dusk.png');
  assert.ok(!('benched' in (manifest.channels.PROP_ART ?? {})), 'disabled row not wired');
  assert.equal(scan.manifest.counts.wired, 5);
  const ts = renderTsModule(scan.manifest);
  assert.ok(ts.includes('export const PROP_ART'));
  assert.ok(existsSync(join(dir, 'manifest.ts')));

  // repost: delete an output, rebuild it from the kept raw — no provider call
  await rm(join(dir, 'public/skins/urn.png'));
  const rs = await runRepost(c, sel.rows.filter((r) => r.id === 'urn'), {}, () => {});
  assert.equal(rs.reprocessed, 2, 'base + derivation reprocessed from raw');
  assert.ok(existsSync(join(dir, 'public/skins/urn.png')));
});

test('a member whose anchor is missing fails loudly instead of drifting', async (t) => {
  const { dir, file } = await setup();
  t.after(() => rm(dir, { recursive: true, force: true }));
  const c = await loadCommission(file);
  // select ONLY dusk; its anchor dawn has no output on disk and is not selected
  const sel = resolveSelection(c, { ids: ['dusk'], includeDisabled: false });
  const summary = await runGenerate(c, sel.rows, {}, () => {});
  // the anchor is pulled into the run instead of failing — dawn generates first
  assert.equal(summary.failed.length, 0);
  assert.ok(existsSync(join(dir, 'public/stills/dawn.png')), 'anchor auto-generated first');
  assert.ok(existsSync(join(dir, 'public/stills/dusk.png')));
});

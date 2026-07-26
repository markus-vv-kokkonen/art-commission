#!/usr/bin/env node
/**
 * art-commission — commission AI-generated game art from a standard data file.
 *
 *   art-commission init                     scaffold a starter commission.json
 *   art-commission validate                 check the file (schema + references)
 *   art-commission plan [selection]         preview rows + rough cost, NO requests
 *   art-commission generate [selection]     generate (provider batch path by default)
 *   art-commission repost [selection]       re-run post from raw originals (free)
 *   art-commission wire [--ts]              scan disk → write the asset manifest
 *   art-commission status                   coverage per group / channel
 *   art-commission models [--provider=]     list image models your key can call
 *
 * Global:      --file=commission.json   (default ./commission.json; .json or .mjs)
 * Selection:   --id= --group= --tag= --kind= --channel= --top= --limit=
 *              --include-disabled --batch-size= --batch=
 * Generation:  --provider= --model= --sync --force --concurrency= --poll-secs=
 *              --ref-dir= --size= --aspect= --no-derive --no-downscale --plan
 *
 * The spend-safe loop: plan → generate a tiny --id selection → eyeball → widen.
 * Files on disk are skipped, raws are kept, `repost` is always free.
 */
import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { loadCommission } from './config.js';
import { parseSelectionArgs, resolveSelection, describeSelection, unknownIds } from './select.js';
import { countTodo, effectiveProvider, runGenerate } from './generate.js';
import { runRepost } from './repost.js';
import { buildManifest, writeManifest } from './wire.js';
import { createProvider } from './providers/index.js';
import { probeRefDir } from './pipeline.js';
// ------------------------------------------------------------------ argv/env
const argv = process.argv.slice(2);
const command = argv[0] && !argv[0].startsWith('-') ? argv[0] : 'help';
const rest = command === 'help' ? argv : argv.slice(1);
const has = (k) => rest.includes(`--${k}`);
const get = (k) => {
    const hit = rest.find((a) => a.startsWith(`--${k}=`));
    return hit?.slice(hit.indexOf('=') + 1);
};
const num = (k) => {
    const v = get(k);
    return v === undefined ? undefined : Number(v);
};
/** Minimal .env loader (bun does this natively; node needs the nudge). */
async function loadDotEnv() {
    const path = resolve('.env');
    if (!existsSync(path))
        return;
    for (const line of (await readFile(path, 'utf8')).split('\n')) {
        const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
        if (!m || line.trim().startsWith('#'))
            continue;
        const val = m[2].replace(/^["']|["']$/g, '');
        if (process.env[m[1]] === undefined)
            process.env[m[1]] = val;
    }
}
const FILE = get('file') ?? 'commission.json';
async function commission() {
    return loadCommission(FILE);
}
function selection(c) {
    const args = parseSelectionArgs(get, has);
    const unknown = unknownIds(c, args);
    if (unknown.length) {
        console.error(`✗ unknown id(s): ${unknown.join(', ')}`);
        process.exit(1);
    }
    return resolveSelection(c, args);
}
const genFlags = () => ({
    provider: get('provider'),
    model: get('model'),
    sync: has('sync'),
    force: has('force'),
    concurrency: num('concurrency'),
    pollSecs: num('poll-secs'),
    refDir: get('ref-dir'),
    noDerive: has('no-derive'),
    noDownscale: has('no-downscale'),
    size: get('size'),
    aspect: get('aspect'),
});
// ------------------------------------------------------------------ commands
async function cmdValidate() {
    const c = await commission(); // loadCommission throws with the error list
    const derives = c.assets.reduce((n, a) => n + a.derive.length, 0);
    console.log(`✓ ${c.name} — ${c.assets.length} asset(s), ${derives} derivation(s), valid.`);
    const anchors = new Set(c.assets.filter((a) => a.styleAnchor).map((a) => a.styleAnchor));
    if (anchors.size)
        console.log(`  ${anchors.size} style anchor(s): ${[...anchors].join(', ')}`);
}
function costLine(c, rows, flags, images) {
    if (images === 0)
        return 'nothing to generate — everything on disk (use --force to redo)';
    // per-row estimates: rows may span providers AND per-asset model overrides
    const providers = new Map();
    const perProvider = new Map();
    let total = 0, unknown = false;
    for (const row of rows) {
        const name = effectiveProvider(row, c, flags);
        let provider = providers.get(name);
        if (!provider) {
            provider = createProvider(name, c.providers[name] ?? {});
            providers.set(name, provider);
        }
        const batch = !flags.sync && provider.supportsBatch;
        const per = provider.estimateUSD(row.model ?? flags.model ?? provider.defaultModel, batch);
        const needBase = flags.force || !existsSync(row.outAbs) ? 1 : 0;
        const derives = flags.noDerive ? 0 : row.derive.filter((d) => flags.force || !existsSync(d.outAbs)).length;
        const n = needBase + derives;
        if (n === 0)
            continue;
        if (per === null) {
            unknown = true;
            continue;
        }
        total += per * n;
        perProvider.set(name, (perProvider.get(name) ?? 0) + per * n);
    }
    const parts = [...perProvider.entries()].map(([name, usd]) => {
        const batch = !flags.sync && providers.get(name).supportsBatch;
        return `${name}${batch ? ' (batch ~50% off)' : ''}: ~$${usd.toFixed(2)}`;
    });
    return `est ≈ $${total.toFixed(2)}${unknown ? ' + unknown' : ''} for ${images} image(s)  [${parts.join('  ')}]  (rough)`;
}
async function cmdPlan() {
    const c = await commission();
    const sel = selection(c);
    const flags = genFlags();
    console.log(`\n▪ ${c.name} · plan (no requests)`);
    console.log(`  ${describeSelection(parseSelectionArgs(get, has), sel)}`);
    if (sel.rows.length === 0) {
        console.log('  nothing selected.\n');
        return;
    }
    const show = sel.rows.slice(0, 20);
    console.log('');
    for (const r of show) {
        const px = r.storePx ? `${r.storePx[0]}×${r.storePx[1]}` : 'native';
        const marks = [
            existsSync(r.outAbs) ? 'on-disk' : '',
            r.refAbs || probeRefDir(flags.refDir, r.group, r.id) ? 'ref' : '',
            r.styleAnchor ? `anchor:${r.styleAnchor}` : '',
            r.derive.length ? `+${r.derive.length}drv` : '',
        ].filter(Boolean).join(' ');
        console.log(`    ${r.kind.padEnd(8)} ${r.id.padEnd(28)} → ${px.padEnd(10)} ${r.out}${marks ? `  [${marks}]` : ''}`);
    }
    if (sel.rows.length > show.length)
        console.log(`    …and ${sel.rows.length - show.length} more`);
    const { bases, derives } = countTodo(sel.rows, flags);
    console.log(`\n  to generate: ${bases} base(s) + ${derives} derivation(s); the rest are on disk.`);
    console.log(`  ${costLine(c, sel.rows, flags, bases + derives)}`);
    if (flags.refDir) {
        const withRef = sel.rows.filter((r) => probeRefDir(flags.refDir, r.group, r.id) || (r.refAbs && existsSync(r.refAbs))).length;
        console.log(`  ${withRef}/${sel.rows.length} row(s) have a composition reference under ${flags.refDir}.`);
    }
    console.log('  (preview only — no requests)\n');
}
async function cmdGenerate() {
    if (has('plan')) {
        await cmdPlan();
        return;
    }
    const c = await commission();
    const sel = selection(c);
    const flags = genFlags();
    const providerName = flags.provider ?? c.defaultProvider;
    console.log(`\n▪ ${c.name} · generate · provider=${providerName}${flags.sync ? ' · sync (full price)' : ''}${flags.refDir ? ` · ref-dir=${flags.refDir}` : ''}`);
    console.log(`  ${describeSelection(parseSelectionArgs(get, has), sel)}`);
    if (sel.rows.length === 0) {
        console.log('  nothing selected.\n');
        return;
    }
    const { bases, derives } = countTodo(sel.rows, flags);
    console.log(`  ${costLine(c, sel.rows, flags, bases + derives)}`);
    const summary = await runGenerate(c, sel.rows, flags);
    console.log(`\n▪ done — ${summary.generated} generated, ${summary.skipped} skipped, ${summary.failed.length} failed.`);
    if (summary.failed.length) {
        // Print the REASON, not just the id. runGenerate already captures it on Outcome.error
        // (generate.ts:218), and dropping it here meant a failed asset was undiagnosable without
        // paying to re-run it — the difference between a safety refusal, a transient batch error
        // and a billing precondition all looked identical.
        for (const f of summary.failed) {
            console.log(`  failed: ${f.id}` + (f.error ? `\n           ${f.error}` : ' (no reason reported by the provider)'));
        }
        process.exitCode = 1;
    }
    console.log('  next: art-commission wire\n');
}
async function cmdRepost() {
    const c = await commission();
    const sel = selection(c);
    console.log(`\n▪ ${c.name} · repost (no API calls)`);
    console.log(`  ${describeSelection(parseSelectionArgs(get, has), sel)}`);
    const s = await runRepost(c, sel.rows, { noDownscale: has('no-downscale') });
    console.log(`\n▪ repost done — ${s.reprocessed} reprocessed from raw, ${s.noRaw} had no raw original.`);
    if (s.reprocessed)
        console.log('  next: art-commission wire\n');
    else
        console.log('');
}
async function cmdWire() {
    const c = await commission();
    const scan = await writeManifest(c, { ts: has('ts') });
    console.log(`\n✓ wrote ${c.manifestPath}${has('ts') ? ' (+ .ts module)' : ''}`);
    console.log(`  ${scan.manifest.counts.wired}/${scan.catalogued} enabled assets have art on disk.`);
    const chans = Object.entries(scan.manifest.channels).map(([ch, m]) => `${ch} ${Object.keys(m).length}`).join('  ·  ');
    if (chans)
        console.log(`  ${chans}`);
    if (scan.missing.length) {
        console.log(`  still missing (${scan.missing.length}): ${scan.missing.slice(0, 20).join(', ')}${scan.missing.length > 20 ? ' …' : ''}`);
    }
    console.log('');
}
async function cmdStatus() {
    const c = await commission();
    const scan = buildManifest(c);
    console.log(`\n▪ ${c.name} — ${scan.manifest.counts.wired}/${scan.catalogued} enabled assets have art on disk.`);
    const per = (label, keyOf) => {
        const agg = {};
        for (const a of c.assets) {
            if (!a.enabled)
                continue;
            const k = keyOf(a) ?? '(none)';
            const cell = (agg[k] ??= [0, 0]);
            cell[1]++;
            if (existsSync(a.outAbs))
                cell[0]++;
        }
        const line = Object.entries(agg).sort().map(([k, [h, t]]) => `${k} ${h}/${t}`).join('  ');
        if (line)
            console.log(`  by ${label}: ${line}`);
    };
    per('group', (a) => a.group);
    per('channel', (a) => a.channel);
    if (scan.missing.length) {
        console.log(`  missing: ${scan.missing.slice(0, 30).join(', ')}${scan.missing.length > 30 ? ' …' : ''}`);
    }
    console.log('');
}
async function cmdModels() {
    let name = get('provider');
    let cfg = {};
    if (!name) {
        try {
            const c = await commission();
            name = c.defaultProvider;
            cfg = c.providers[name] ?? {};
        }
        catch {
            name = 'gemini'; // no commission file needed just to list models
        }
    }
    const provider = createProvider(name, cfg);
    if (!provider.listModels) {
        console.log(`provider "${name}" has no model-listing endpoint.`);
        return;
    }
    const models = await provider.listModels();
    console.log(`\nimage-capable models visible to this ${name} key:`);
    for (const m of models)
        console.log(`  ${m.name.replace(/^models\//, '').padEnd(36)} ${m.description ?? ''}`.trimEnd());
    console.log('\npick one with --model= or per-asset "model".\n');
}
const STARTER = `{
  "$schema": "./node_modules/art-commission/schema/commission.schema.json",
  "version": 1,
  "name": "my-game",
  "paths": {
    "assetRoot": "public",
    "rawRoot": ".art-raw",
    "manifest": "src/data/artManifest.json"
  },
  "style": {
    "prefix": "",
    "suffix": "Detailed pixel art, clean hard pixel edges, muted palette.",
    "negative": "no text, no watermark, no signature, no UI, no people, not photorealistic."
  },
  "chromaKey": "#ff00ff",
  "pxScale": 2,
  "providers": { "default": "gemini", "gemini": { "model": "gemini-3.1-flash-image" } },
  "assets": [
    {
      "id": "crate",
      "kind": "cutout",
      "prompt": "A single worn wooden supply crate, iron-banded corners.",
      "px": [32, 32],
      "out": "art/props/crate.png",
      "channel": "PROP_ART",
      "group": "props",
      "derive": [
        {
          "id": "crate_broken",
          "prompt": "Smash this crate into a low pile of broken debris resting on the ground — same materials, same palette, scattered fragments, nothing standing. Keep it centered.",
          "out": "art/props/crate_broken.png"
        }
      ]
    }
  ]
}
`;
async function cmdInit() {
    if (existsSync(FILE)) {
        console.error(`✗ ${FILE} already exists — not overwriting.`);
        process.exit(1);
    }
    await writeFile(FILE, STARTER);
    console.log(`✓ wrote ${FILE}`);
    console.log('  next: edit it, then  art-commission validate && art-commission plan');
    console.log('  smoke the pipeline with no key:  art-commission generate --provider=mock --id=crate\n');
}
function help() {
    console.log(`
art-commission — commission AI-generated game art from a standard data file.

  init | validate | plan | generate | repost | wire | status | models

Global      --file=commission.json (.json or .mjs module)
Selection   --id=a,b --group=g --tag=t --kind=k --channel=c --top=N --limit=N
            --include-disabled --batch-size=N --batch=I
Generation  --provider=gemini|retrodiffusion|scenario|mock --model=ID
            --sync (per-request, full price; default is the provider's ~50%-off batch)
            --force --concurrency=N --poll-secs=N --ref-dir=DIR
            --size=1K|2K --aspect=W:H --no-derive --no-downscale --plan
Wire        --ts (also emit a typed .ts module next to the JSON manifest)

The spend-safe loop:
  1. art-commission plan                         preview + rough cost, no requests
  2. art-commission generate --id=<one or two>   the look test, cents
  3. eyeball the output in-engine (wire first), then widen the selection
  4. art-commission repost                       post tweaks are always free
`);
}
// ---------------------------------------------------------------------- main
async function main() {
    await loadDotEnv();
    switch (command) {
        case 'init': return cmdInit();
        case 'validate': return cmdValidate();
        case 'plan': return cmdPlan();
        case 'generate':
        case 'gen': return cmdGenerate();
        case 'repost': return cmdRepost();
        case 'wire': return cmdWire();
        case 'status': return cmdStatus();
        case 'models': return cmdModels();
        case 'help':
        case '--help':
        case '-h': return help();
        default:
            console.error(`✗ unknown command "${command}"\n`);
            help();
            process.exit(1);
    }
}
main().catch((e) => {
    console.error(`✗ ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
});

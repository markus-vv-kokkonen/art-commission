# Programmatic API

Everything the CLI does is exported from the package root (`src/index.ts` → `dist/index.js`), so a
game's build scripts can embed the pipeline or add bespoke steps without shelling out. Import from
`art-commission` (or relative `./dist/index.js` in-repo).

## Load / resolve / validate

```ts
import { loadCommission, loadCommissionFile, resolveCommission, validateCommission } from 'art-commission';

const c = await loadCommission('commission.json');   // load + validate + resolve (throws on invalid)
// or, to inspect before resolving:
const raw = await loadCommissionFile('commission.json');
const errors: string[] = validateCommission(raw);     // [] means sound
const resolved = resolveCommission(raw, 'commission.json');
```

`loadCommission` returns a `ResolvedCommission`: every default folded in, all relative paths made
absolute (`outAbs`, `rawAbs`, `manifestPath`), prompts pre-assembled, kinds resolved to concrete
`PostSpec`s, and `assets` sorted priority→group→id. It's what every runner below consumes.

## Selection

```ts
import { parseSelectionArgs, resolveSelection, unknownIds } from 'art-commission';

// Build SelectionArgs however you like; parseSelectionArgs mirrors the CLI flag readers.
const sel = resolveSelection(c, { groups: ['props'], includeDisabled: false });
sel.rows;      // ResolvedAsset[] in run order
sel.poolSize;  // filtered pool size before batch slicing
```

## Generate / repost / wire

```ts
import { runGenerate, countTodo, runRepost, writeManifest, buildManifest } from 'art-commission';

const { bases, derives } = countTodo(sel.rows, {});           // what a run would actually pay for
const summary = await runGenerate(c, sel.rows, {              // GenerateFlags mirror the CLI
  provider: 'mock', sync: true, force: false,
}, (line) => console.log(line));                              // optional log sink (default console.log)
// summary: { outcomes, generated, skipped, failed }

await runRepost(c, sel.rows, { noDownscale: false });         // $0 reprocess from raws
const scan = await writeManifest(c, { ts: true });            // scan disk → write manifest (+ .ts)
// or, without writing, just compute it:
const { manifest, missing, catalogued } = buildManifest(c);
```

`GenerateFlags` fields: `provider`, `model`, `sync`, `force`, `concurrency`, `pollSecs`, `refDir`,
`noDerive`, `noDownscale`, `size`, `aspect`. All optional.

## Post functions & providers (for bespoke steps)

```ts
import { keyCutout, fitContain, fitCover, quantizePalette, applyPost, hexToRgb } from 'art-commission';
import { createProvider, providerNames } from 'art-commission';
import { processAndWrite, loadImageRef, probeRefDir } from 'art-commission';

const cut = await keyCutout(rawBytes, hexToRgb('#ff00ff'), 110); // { bytes, borderKeyFrac, clearedFrac }
const provider = createProvider('gemini', c.providers.gemini ?? {});
const models = await provider.listModels?.();                    // gemini only
```

`applyPost(input, post, storePx, opts)` runs one `PostSpec` end-to-end; `processAndWrite(c, target,
rawBytes, opts)` is the pipeline used by generate/repost (writes raw + final, reports key misses).

## The exporter pattern — data-driven catalogues

The cleanest setup for a real game is **not** a hand-written JSON file but a `.mjs` commission module
(or a script that writes JSON) that walks the game's own data — item tables, room catalogues, cutscene
lists — and emits the assets. Then the art catalogue can never drift from what the game actually
places, and adding an item to the game adds its art commission for free.

```js
// commission.mjs — default-export the CommissionFile shape
import { ITEMS } from './src/data/items.js';
export default {
  version: 1,
  name: 'my-game',
  paths: { assetRoot: 'public', rawRoot: '.art-raw', manifest: 'src/data/artManifest.json' },
  style: { suffix: 'Detailed pixel art, clean hard edges, muted palette.', negative: 'no text, no people.' },
  chromaKey: '#ff00ff',
  pxScale: 2,
  providers: { default: 'gemini' },
  assets: ITEMS.map((it) => ({
    id: it.id,
    kind: 'cutout',
    prompt: it.artPrompt,          // one subject sentence per item, colocated with the item
    px: it.size,
    out: `art/items/${it.id}.png`,
    channel: 'ITEM_ART',
    group: it.category,
  })),
};
```

Run the CLI against it with `--file=commission.mjs`. The reference implementation this tool was
extracted from ships a real ~450-asset exporter (`tools/areagen-art/export-commission.ts` in the
`reverse-rpg` repo) mapping a live game catalogue onto this exact format.

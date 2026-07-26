# art-commission

Commission AI-generated game art from **one standard data file** — for any
game, any engine.

You describe every asset you want procured (what to draw, how big, where it
lands, how the game looks it up); the tool plans the spend, generates through
a pluggable provider (Google Gemini with its ~50%-off Batch API, Retro
Diffusion, Scenario — or a free offline mock), runs the local post pipeline
(chroma-key cutout → de-spill → trim → exact-px fit → palette lock), keeps
every untouched original for zero-cost reprocessing, and emits an
engine-agnostic manifest your game reads with one guarded lookup per channel.

Extracted and generalized from the asset pipeline of *Candlemere: The Kingdom
Is Grateful*, where it procured a ~450-asset catalogue (props, breakables,
floors, room plates, story stills, icons, weapon plates) against live APIs.
The hard-won rules are baked in as defaults.

---

## The rules this tool encodes

1. **Spend-safety is a workflow, not a virtue.** Every command prints a rough
   $ estimate before anything is spent; files already on disk are skipped
   (every run is resumable); the discounted batch path is the default where
   the provider has one.
2. **Transparency is a contract, not a request.** Image models cannot emit
   PNG alpha — asked for "transparent", they *paint* a checkerboard. Cutout
   prompts therefore demand one exact, palette-foreign backdrop colour
   (default `#ff00ff`), and local post chroma-keys it: border-confirmed
   **global** clear (reaches enclosed holes a flood fill can't), de-spill,
   trim, then fit **inside** the target px without cropping. If a model
   ignores the key, the tool warns loudly instead of shipping an opaque prop.
3. **Raw originals are an asset.** The model's untouched native-res output is
   always kept under `rawRoot`; `repost` re-runs post-processing from it at
   zero API cost. Post tweaks never mean paying again.
4. **Look drift is fought with images, not adjectives.** Two reference
   mechanisms: `ref` / `--ref-dir` attaches your own render as an img2img
   *composition* anchor ("redraw this at higher fidelity"), and `styleAnchor`
   chains a set to one generated *style* anchor plate (generated first, fed
   back as a style reference) so a sequence holds one look without bleeding
   into another.
5. **Generated art must be additive.** The emitted manifest only contains
   files that exist; the intended game-side pattern is *image-if-present,
   code-drawn fallback*. Disabling an asset (`enabled: false`) unwires it on
   the next `wire` even if its PNG still exists.

---

## Quick start

Install it into your game as a dependency, pinned to a release tag. `dist/` is
committed, so the `art-commission` binary works straight from a git install with
no build step — under bun, npm or anything else:

```sh
bun  add --dev github:markus-vv-kokkonen/art-commission#v0.1
# or: npm install --save-dev github:markus-vv-kokkonen/art-commission#v0.1
```

Or to hack on the package itself:

```sh
bun install                       # (in this package; needs Node ≥ 20)
bun run build

node dist/cli.js init             # scaffold commission.json
node dist/cli.js validate
node dist/cli.js plan             # preview + rough cost, no requests

# smoke the ENTIRE pipeline with no API key and no spend:
node dist/cli.js generate --provider=mock
node dist/cli.js wire --ts        # emit the manifest (+ typed .ts module)

# then the real thing:
echo 'GEMINI_API_KEY=...' >> .env # Google AI Studio → Get API key (paid tier for images)
node dist/cli.js generate --id=crate --sync     # ONE image — the look test
node dist/cli.js generate                       # everything, one ~50%-off batch job
```

(Installed as a dependency, the binary is `art-commission`; under bun,
`bun run src/cli.ts` works directly.)

**The spend-safe loop:** `plan` → generate a tiny `--id` selection → wire →
eyeball in-engine → widen the selection → `repost` freely as post settings
evolve. A bad round costs one look, not a re-buy.

---

## The commission file

One JSON file (or a `.mjs` module default-exporting the same shape — handy
for *generating* the catalogue from your game's own data). Schema for editor
autocomplete: [`schema/commission.schema.json`](schema/commission.schema.json).

```jsonc
{
  "version": 1,
  "name": "my-game",
  "paths": {
    "assetRoot": "public",              // where `out` paths land
    "rawRoot": ".art-raw",              // untouched originals (gitignore this)
    "manifest": "src/data/artManifest.json"
  },
  "style": {
    "prefix": "",                        // global STYLE block, prepended
    "suffix": "Detailed pixel art, ...", // palette/lighting/mood, appended
    "negative": "no text, no watermark, no people, ..."
  },
  "palette": ["#1a1c2c", "#f4f4f4"],    // enables `quantize`
  "chromaKey": "#ff00ff",
  "pxScale": 2,                          // stored-size multiplier for cutouts
  "providers": {
    "default": "gemini",
    "gemini": { "model": "gemini-3.1-flash-image" }
  },
  "assets": [ /* … */ ]
}
```

### Assets

```jsonc
{
  "id": "urn",                    // unique
  "kind": "cutout",               // cutout | plate | tile | still | your own
  "prompt": "A cracked ceremonial urn on a stone plinth.",   // SUBJECT only —
                                  // style/negatives/key clause are wrapped on
  "px": [20, 36],                 // final target size in game px
  "out": "skins/castle/urn.png",  // relative to assetRoot
  "channel": "PROP_ART",          // manifest map this belongs to (default "art")
  "key": "urn",                   // lookup key in that map (default id)
  "group": "castle",              // filterable; also the --ref-dir subfolder
  "tags": ["breakable"],          // filterable
  "priority": 40,                 // higher = sooner under --top
  "enabled": true,                // false = catalogued but not generated/wired
  "ref": "renders/urn.png",       // optional img2img composition anchor
  "styleAnchor": "urn-anchor",    // optional style anchor (another asset's id)
  "aspect": "2:3",                // optional; default snapped from px
  "seed": 7, "model": "…", "provider": "…", "providerOptions": { },
  "post": { "quantize": true },   // per-asset post overrides
  "derive": [                     // edits of the fresh base image
    {
      "id": "urn_broken",
      "prompt": "Smash this urn into a low pile of broken debris — same materials, same palette, nothing standing.",
      "out": "skins/castle/urn_broken.png"
    }
  ]
}
```

### Kinds — what happens to the pixels

| kind | prompt gets key clause | post | sizing |
| --- | --- | --- | --- |
| `cutout` | yes | chroma-key → alpha → de-spill → trim → fit-**contain** | `px × pxScale` (stored headroom; display stays size-driven) |
| `plate` | no | fit-**cover** resize | exact `px` |
| `tile` | no | fit-**cover** + palette **quantize** | exact `px` (baked surfaces hate double resamples) |
| `still` | no | none — native model resolution | engine scales it itself |

All four are presets over the same knobs (`cutout`, `trim`, `fit`,
`quantize`, `kernel`, `scaled`, `keyClause`); override per asset via `post`,
or define your own preset under `kinds`.

### Prompt assembly

```
style.prefix + asset.prompt + [key clause] + style.suffix + style.negative + asset.negative
                                  + [style.refSuffix    when a ref image is attached]
                                  + [style.anchorSuffix when a styleAnchor output is attached]
```

Negatives ride inside the prompt — that works on every backend. The key
clause is auto-built from `chromaKey`; battle-tested `refSuffix` /
`anchorSuffix` defaults ship in the box and are overridable.

### Derivations

`derive` entries are generated by **editing the freshly generated base**
(the base image is the reference), so companions read as the same object:
broken/debris states, wear tiers, damage variants, recolours. They run
synchronously after the base lands — also after batch jobs. Chain length is
one (base → companions), by design.

### Style anchors

Give a set of assets `styleAnchor: "<id>"` pointing at one of them. The
anchor generates first (it is pulled into the run automatically if missing),
then every member generates with the anchor's output attached as a style
reference. Separate sequences get separate anchors so a warm sequence can't
bleed gold into a cold one. Anchors are one level deep — an anchor cannot
itself be anchored.

---

## CLI

```
art-commission <command> [--file=commission.json] [flags]

  init        scaffold a starter commission.json
  validate    structural + referential checks (ids, anchors, collisions)
  plan        resolve the selection, print rows + rough cost — NO requests
  generate    generate the selection (provider's discounted batch by default)
  repost      re-run post-processing from kept raws — zero API cost
  wire        scan disk → write the manifest (--ts adds a typed module)
  status      coverage per group / channel
  models      list image models your key can actually call
```

**Selection** (shared by plan/generate/repost/status): `--id=a,b`
`--group=g` `--tag=t` `--kind=k` `--channel=c` `--top=N` `--limit=N`
`--include-disabled` `--batch-size=N --batch=I` (deterministic,
non-overlapping slices over the priority-sorted pool).

**Generation:** `--provider=` `--model=` `--sync` (per-request full price;
default is the provider's ~50%-off batch path where one exists) `--force`
`--concurrency=N` `--poll-secs=N` `--ref-dir=DIR` (probe
`DIR/<group>/<id>.png` then `DIR/<id>.png` as composition refs) `--size=1K|2K`
`--aspect=W:H` `--no-derive` `--no-downscale` `--plan`.

API keys come from the environment; a `.env` in the working directory is
loaded automatically (`GEMINI_API_KEY`, `RETRODIFFUSION_API_KEY`,
`SCENARIO_API_KEY`+`_SECRET` — override names via `providers.<p>.apiKeyEnv`).

---

## Providers

| | gemini | retrodiffusion | scenario | mock |
| --- | --- | --- | --- | --- |
| mode | sync + **Batch API (~50% off, default)** | sync | async job+poll | local, free |
| reference images (refs/anchors/derives) | ✅ | ✅ (img2img) | — | ✅ (accepted) |
| how the look holds | edit from refs/anchors | `prompt_style` + palette tools | train a model on your art bible | n/a |
| model listing | ✅ `models` | — | — | — |

- **gemini** — the primary path. Batch jobs print their name on submit and
  run server-side even if you stop; already-generated files are skipped on
  the next run. Model ids drift between API revisions: trust `models` over
  any docs list (a 404 on generate = wrong id for *your* key, not a broken
  tool).
- **retrodiffusion** — pixel-art-native; RD-specific knobs (`prompt_style`,
  `input_palette`, `strength`, `remove_bg`…) pass through verbatim via
  `providerOptions`.
- **scenario** — its draw is training a model on your own art; set the
  trained id via `providers.scenario.model`.
- **mock** — deterministic local placeholders (cutout requests are painted on
  the real chroma key so post has real work to do). Use it to smoke the whole
  pipeline in CI, or to land your entire catalogue as placeholders in-engine
  before spending anything.

Adding a backend = implement the small `Provider` interface
(`src/providers/types.ts`: `generate`, optional `generateBatch` /
`listModels`, a cost estimate) and register it in `src/providers/index.ts`.

---

## The manifest, game-side

`wire` writes one JSON file: `channels → key → path` (plus per-asset
metadata), containing **only files that exist on disk**. The intended
integration is one guarded lookup per channel, with the code-drawn version as
the permanent fallback:

```ts
import manifest from './data/artManifest.json';

const src = manifest.channels.PROP_ART?.[propId];
if (src) loadImage(key, src);   // procured art
else drawProcedural(propId);    // shipped fallback — the game runs without any PNG
```

`wire --ts` additionally emits a typed module (`export const PROP_ART:
Record<string, string>` per channel) for engines that prefer an import over
JSON.

---

## Programmatic API

Everything the CLI does is exported from the package root — load/resolve,
selection, `runGenerate`, `runRepost`, `writeManifest`, the post functions,
and the provider registry — so a game's build scripts can embed the pipeline
or bolt on bespoke steps. See `src/index.ts`.

Because a commission file can be a `.mjs` module, the cleanest setup for a
data-driven game is an **exporter**: a small script that walks your real game
data (item tables, room catalogues, cutscene lists) and emits the commission
file, so the art catalogue can never drift from what the game actually places.

---

## Repository layout

```
schema/commission.schema.json   editor-facing schema for the format
src/types.ts                    the format, precisely typed
src/config.ts                   load + validate + resolve (source of truth)
src/select.ts                   the selection/batching language
src/generate.ts                 orchestration: anchors → members → derivations
src/pipeline.ts                 raw retention + post application + ref probing
src/post.ts                     keyCutout / fitContain / fitCover / quantize (sharp)
src/repost.ts                   zero-cost reprocessing from raws
src/wire.ts                     manifest emission (JSON + optional .ts)
src/providers/                  gemini (sync+batch) · retrodiffusion · scenario · mock
src/cli.ts                      the CLI
examples/minimal/               a four-asset example exercising every mechanism
test/                           node:test suite — the whole loop runs offline via mock
```

`bun run test` builds and runs the suite; no keys, no network, no spend.

---

## Provenance

This package is the generalized extraction of
`tools/areagen-art` from *Candlemere: The Kingdom Is Grateful*
([reverse-rpg](https://github.com/markus-vv-kokkonen/reverse-rpg)) — see that
repo's `tools/areagen-art/export-commission.ts` for a real 450-asset exporter
mapping a live game catalogue onto this format. It is designed to be lifted
into its own repository as-is: the folder is self-contained (own
`package.json`, no imports from the host repo). Pick a license before
publishing (`"license"` is declared MIT in package.json; add the LICENSE file
with the copyright holder you want).

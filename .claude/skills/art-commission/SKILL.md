---
name: art-commission
description: >-
  Operate the art-commission tool — a CLI + library that commissions AI-generated
  game art from one standard data file (the "commission file"). Use this whenever
  working in the art-commission repo, in any project that has a commission.json /
  commission.mjs, or when the user wants to generate, plan the cost of, batch, cut
  out, palette-lock, repost, or wire game sprites, tiles, plates, stills, icons, or
  props — even if they never name the tool. Also use when adding assets, derivations,
  or style anchors; choosing between Gemini / Retro Diffusion / Scenario / the offline
  mock provider; configuring the chroma key, pxScale, palette, or custom kinds; adding
  a new provider backend; or debugging opaque cutouts, chroma-key misses, missing
  manifest keys, "no image" responses, or model-not-found errors. Prefer this skill
  over improvising: the tool encodes hard-won spend-safety and transparency rules that
  are easy to break by hand.
---

# art-commission

`art-commission` turns **one data file** into a folder of game-ready art plus an
engine-agnostic manifest the game reads. You (a Claude agent) will mostly be doing
one of four things: **authoring/editing the commission file**, **running the
spend-safe generation loop**, **wiring the manifest into a game**, or **extending
the tool** (a new provider or kind). This file gives you the mental model and the
common workflows; the `references/` files hold the exhaustive specs — read the one
you need when you need it, don't preload them all.

## The one thing to understand first: spend-safety is a workflow

Every image costs real money at a real provider. The whole tool is shaped around
*never paying twice for the same pixels*. Internalize these invariants — they explain
almost every design decision, and breaking them is the main way to waste the user's
money:

1. **Files on disk are skipped.** Every run is resumable. `generate` only pays for
   outputs that don't already exist (override with `--force`). Never re-run a broad
   `generate` "just in case" — it's a no-op if files exist, but with `--force` it is a
   full re-buy.
2. **Raw originals are always kept.** Before post-processing writes the shipped PNG,
   the model's untouched native-resolution output is saved under `rawRoot`. This means
   **`repost` re-runs all local post-processing for $0** — key tolerance, target size,
   palette lock, trimming. Post tweaks must NEVER go through `generate`.
3. **Preview before you buy.** `plan` (and `generate --plan`) resolves the selection and
   prints a rough `$` estimate and per-provider breakdown, making **zero** API requests.
   Lead with it.
4. **The default path is the cheap one.** Where a provider has a discounted batch API
   (only Gemini today), `generate` uses it by default (~50% off). `--sync` opts into the
   full-price per-request path — only for the one-off "look test" where you want a single
   image back immediately.

The canonical loop the user should follow:

```
plan  →  generate --id=<one asset> --sync   →  wire  →  eyeball in-engine
      →  widen the selection & generate (batch)  →  repost freely as post settings evolve
```

A bad round costs one look, not a re-buy.

## Setup / how to invoke the CLI

The published binary is `art-commission`; its `bin` points at `dist/`, which is
**committed** (a git-tag install runs no build, so the built output ships in the repo).
A fresh checkout therefore works without building — but after editing `src/` you must
rebuild and commit `dist/` (CI fails on drift):

```sh
bun install            # needs Node ≥ 20; installs sharp (the one runtime dep)
bun run build          # tsc → dist/ — commit the result with the src change
node dist/cli.js <command> [flags]
```

Under **bun**, skip the build and run the TypeScript directly: `bun run src/cli.ts <command>`.
When the package is installed as a dependency elsewhere, just call `art-commission <command>`.
In this skill I write `art-commission <command>`; substitute `node dist/cli.js` after building.

`sharp` (image post-processing) is imported **lazily**, so `plan`, `validate`, `wire`,
and `status` work without it; only `generate` and `repost` need it installed.

API keys load from the process environment; a `.env` in the working directory is read
automatically. Never print or commit keys.

## The commands

| command | makes API calls? | what it does |
| --- | --- | --- |
| `init` | no | scaffold a starter `commission.json` (refuses to overwrite) |
| `validate` | no | structural + referential checks; throws a full error list |
| `plan` | no | resolve the selection, print rows + rough cost — **preview only** |
| `generate` (alias `gen`) | **yes** | generate the selection; provider's batch path by default |
| `repost` | no | re-run local post from kept raws — **$0** |
| `wire` | no | scan disk → write the manifest (`--ts` also emits a typed module) |
| `status` | no | coverage per group / channel; lists what's still missing |
| `models` | yes (read) | list image models the current key can actually call |

Global flag: `--file=commission.json` (default `./commission.json`; may be `.json` or a
`.mjs`/`.cjs`/`.js` module that default-exports the same shape).

### Selection — shared by plan / generate / repost / status

Selection turns flags into a concrete, ordered row set. Assets are pre-sorted by
**priority desc, then group, then id**, which makes `--top` and batch slicing deterministic.

- `--id=a,b` — explicit ids. **Wins outright**: ignores all filters, includes
  `enabled:false` rows, and also matches an asset if you name one of its derivations.
- `--group=g` / `--tag=t` / `--kind=k` / `--channel=c` — filters (comma-separated = OR;
  an asset matches a `--tag` list if it has *any* of them).
- `--top=N` — keep the N highest-priority rows after filtering.
- `--limit=N` — hard cap after everything else.
- `--include-disabled` — include `enabled:false` rows in filter-based selections.
- `--batch-size=N --batch=I` — deterministic, non-overlapping slice `I` of size `N` over
  the filtered pool (for sharding a large catalogue across separate runs).

### Generation flags (see `references/providers.md` for provider specifics)

`--provider=` `--model=` override the resolved provider/model. `--sync` = full-price
per-request (default is the batch path where one exists). `--force` regenerates even if
the file exists. `--concurrency=N` (sync worker count, default 2). `--poll-secs=N` (batch
poll interval, default 15). `--ref-dir=DIR` probes `DIR/<group>/<id>.png` then `DIR/<id>.png`
as composition references. `--size=1K|2K` provider size hint. `--aspect=W:H` forces one
aspect for every request. `--no-derive` skips derivations. `--no-downscale` keeps native
resolution (cutout still runs). `--plan` makes `generate` behave like `plan`.

## Authoring the commission file — the highest-frequency task

This is what you'll edit most. The full field-by-field reference is
**`references/commission-file.md`** — read it before writing a non-trivial file or when
unsure of a field. The essentials:

- **The file describes assets, not prompts.** Shared look (palette, lighting, negatives)
  lives once in `style`; each asset's `prompt` is the **subject only**. The tool wraps
  every subject:
  `style.prefix + prompt + [chroma-key clause] + style.suffix + style.negative + asset.negative`,
  plus a `refSuffix`/`anchorSuffix` when a reference image is attached. Do **not** repeat
  style words or negatives in each asset prompt — that's what `style` is for.
- **`kind` decides what happens to the pixels** (`cutout` | `plate` | `tile` | `still`, or
  your own). This is the single most important per-asset choice — get it right and post
  "just works". Full semantics in **`references/post-and-kinds.md`**; the short version:

  | kind | key clause in prompt? | post | final size |
  | --- | --- | --- | --- |
  | `cutout` (default) | yes | chroma-key → alpha → de-spill → trim → fit **contain** | `px × pxScale` |
  | `plate` | no | fit **cover** | exact `px` |
  | `tile` | no | fit **cover** + palette **quantize** | exact `px` |
  | `still` | no | none (native model resolution) | engine scales it |

- **`out`** is the shipped path (relative to `assetRoot`); **`channel` + `key`** are how the
  game looks the asset up in the manifest (default channel `"art"`, default key = `id`).
- **`px`** `[w,h]` is required unless the kind's fit is `none` (i.e. every kind except `still`).
- **Derivations** (`derive: [...]`) are companions made by **editing the freshly generated
  base image** — broken states, wear tiers, recolours. They inherit the base as their
  reference so they read as the same object, run synchronously right after the base lands,
  and are one level deep (a derivation can't have derivations).
- **Style anchors** (`styleAnchor: "<other-id>"`) hold one look across a set: the anchor
  generates first, then each member generates with the anchor's output attached as a style
  reference. Anchors are one level deep and can't reference themselves.

A minimal, correct asset:

```jsonc
{
  "id": "crate",
  "kind": "cutout",
  "prompt": "A single worn wooden supply crate, iron-banded corners, standing upright.",
  "px": [32, 32],
  "out": "art/props/crate.png",
  "channel": "PROP_ART",
  "group": "props",
  "derive": [
    { "id": "crate_broken",
      "prompt": "Smash this crate into a low pile of broken debris on the ground — same materials, same palette, nothing standing. Keep it centered.",
      "out": "art/props/crate_broken.png" }
  ]
}
```

**Always run `validate` after editing.** It catches duplicate ids, two assets writing the
same `out`, two assets claiming the same `channel`+`key`, missing `px`, `quantize` without a
palette, unknown providers/kinds, and broken/self-referential/too-deep style anchors — with
actionable messages. `config.ts` is the real source of truth; `schema/commission.schema.json`
is only for editor autocomplete.

## The transparency contract — the subtle, critical bit

Image models **cannot emit PNG alpha**. Asked for "transparent", they paint a fake
checkerboard. So transparency here is a *contract*, not a request:

1. For `cutout` assets the tool auto-appends a **key clause** to the prompt demanding one
   flat, palette-foreign backdrop colour (default `#ff00ff` magenta) covering every
   non-subject pixel, and forbidding the subject from containing that colour.
2. Local post then **chroma-keys** that backdrop into real alpha. The clear is **global**
   (not a border flood-fill) so it reaches enclosed holes — the gap under a well's roof —
   that a flood fill can't; then de-spill removes the key's colour cast from cut edges.
3. If the model **ignored the key** (fewer than half the border pixels match), post refuses
   to clear — it writes the image untouched and warns loudly (`backdrop is not the chroma
   key … wrote as-is`) rather than shipping an opaque prop. The fix is to strengthen/adjust
   the subject prompt and regenerate with `--force`, or raise `chromaTolerance`, then
   `repost` (tolerance changes are free).

Never tell a model to "make the background transparent". Let the tool own the key clause.

## Wiring the manifest into a game

`wire` scans the output tree and writes **one JSON manifest** mapping `channel → key → path`,
containing **only files that exist on disk** and **only enabled assets**. Flipping an asset
to `enabled: false` unwires it on the next `wire` even if its PNG still exists — that's how
you descope a class of art in one flag.

The intended game-side pattern is a **guarded lookup with a code-drawn fallback**, which keeps
generated art strictly additive (the game runs with zero PNGs present):

```ts
import manifest from './data/artManifest.json';
const src = manifest.channels.PROP_ART?.[propId];
if (src) loadImage(key, src);   // procured art present
else drawProcedural(propId);    // permanent code-drawn fallback
```

`wire --ts` additionally emits a typed `.ts` module (one `export const <CHANNEL>: Record<string,
string>` per channel) for engines that prefer an import over JSON.

## Common tasks — quick recipes

- **"Generate everything."** `plan` (confirm cost) → `generate` (batch, Gemini) → `wire`.
- **"Just try one asset / test the look."** `generate --id=<id> --sync` → `wire` → look → widen.
- **"Regenerate this one, it looks wrong."** `generate --id=<id> --force` (`--sync` for a fast
  single image). Only `--force` re-buys.
- **"The cutouts have a magenta fringe / wrong size / aren't palette-clean."** That's post, not
  generation → edit `chromaTolerance`/`px`/`palette`/`post`, then `repost` ($0). Reach for
  `generate --force` only if the raw itself is wrong.
- **"Add a broken/damaged variant."** Add a `derive` entry to the parent asset; re-run
  `generate` (fills the missing derivation from the existing base, no base re-buy).
- **"Keep a sequence on one look."** Give the members `styleAnchor: "<one-member-id>"`.
- **"Which models can this key use?"** `art-commission models` (Gemini lists live; trust it over
  any docs — a 404 on generate means the id is wrong for *this* key, not a broken tool).
- **"Smoke the whole pipeline with no key / no spend."** `generate --provider=mock` — deterministic
  local placeholders (cutout requests are painted on the real chroma key so post has real work).
  Land the whole catalogue as placeholders in-engine before spending a cent.
- **"Shard a huge catalogue."** `generate --batch-size=50 --batch=0`, `--batch=1`, … deterministic
  non-overlapping slices.

## Reference files (read on demand)

- **`references/commission-file.md`** — every field of the commission file, defaults, prompt
  assembly, `paths`, `style`, custom `kinds`, derivations, anchors, and validation rules.
- **`references/post-and-kinds.md`** — the post pipeline (keyCutout, fitContain/Cover, quantize),
  the four built-in kinds, `pxScale`, and how to define your own kind.
- **`references/providers.md`** — Gemini (sync + batch), Retro Diffusion, Scenario, mock: env
  vars, cost model, capabilities (`supportsBatch`/`supportsEdits`), and how generation is
  orchestrated (anchor phase → member phase → derivations).
- **`references/programmatic-api.md`** — using the package as a library (everything the CLI does
  is exported), and the "exporter" pattern for data-driven games.

## Repository map (for extending the tool)

```
src/types.ts          the format, precisely typed (start here to understand the data)
src/config.ts         load + validate + resolve — the source of truth for defaults
src/select.ts         the selection/batching language
src/generate.ts       orchestration: anchors → members → derivations
src/pipeline.ts       raw retention + post application + ref probing
src/post.ts           keyCutout / fitContain / fitCover / quantize (sharp)
src/repost.ts         zero-cost reprocessing from raws
src/wire.ts           manifest emission (JSON + optional .ts)
src/providers/        gemini (sync+batch) · retrodiffusion · scenario · mock · types · index
src/cli.ts            the CLI surface
examples/minimal/     a four-asset example exercising cutout, tile, still, derive, anchor
test/                 node:test suite — the whole loop runs offline via mock
```

`bun run test` builds and runs the suite with no keys, no network, no spend. If you extend the
tool, keep that true: the mock provider must remain able to exercise the whole pipeline.

# The commission file — full reference

One file describes everything the tool procures. It is JSON, or a `.mjs`/`.cjs`/`.js`
module that `export default`s (or sets `module.exports` / exports `commission`) the same
object shape — the module form is what makes a **data-driven catalogue** possible (a script
walks your game's real data and emits the file). Relative paths inside resolve against the
**file's own directory**. The typed shape lives in `src/types.ts`; validation + defaults in
`src/config.ts` (the real source of truth). `schema/commission.schema.json` exists only for
editor autocomplete via `$schema`.

## Table of contents

- [Top-level fields](#top-level-fields)
- [`paths`](#paths)
- [`style` and prompt assembly](#style-and-prompt-assembly)
- [`palette`, `chromaKey`, `chromaTolerance`, `pxScale`](#palette-chromakey-chromatolerance-pxscale)
- [`providers`](#providers)
- [`kinds` (custom)](#kinds-custom)
- [Asset fields](#asset-fields)
- [Derivations](#derivations)
- [Style anchors](#style-anchors)
- [Validation rules](#validation-rules)

## Top-level fields

```jsonc
{
  "$schema": "./node_modules/art-commission/schema/commission.schema.json", // optional, editor-only
  "version": 1,                 // REQUIRED, must be exactly 1
  "name": "my-game",            // display name for logs; default "commission"
  "paths": { ... },
  "style": { ... },
  "palette": ["#rrggbb", ...],  // enables quantize posts
  "chromaKey": "#ff00ff",       // cutout backdrop colour; default #ff00ff
  "chromaTolerance": 110,       // squared-distance key tolerance; default 110
  "pxScale": 2,                 // stored-size multiplier for SCALED kinds; default 1
  "providers": { ... },
  "kinds": { ... },             // optional custom kind presets / overrides
  "assets": [ ... ]             // REQUIRED, non-empty
}
```

## `paths`

All relative to the commission file's directory.

| field | default | meaning |
| --- | --- | --- |
| `assetRoot` | `"."` | root that every asset `out` path is written under (the game-visible tree) |
| `rawRoot` | `".art-raw"` | where untouched model originals are mirrored (by `out` path). **Gitignore this.** It's what makes `repost` free. |
| `manifest` | `"art-manifest.json"` | path `wire` writes the manifest to |

The raw for an asset is `rawRoot/<out>`; the shipped file is `assetRoot/<out>`. Keeping raws is
non-negotiable to the design — deleting `rawRoot` means future post tweaks cost a full regenerate.

## `style` and prompt assembly

`style` holds the shared look **once** so asset prompts stay subject-only. Every field is
optional; each asset's final prompt is assembled (whitespace-collapsed) as:

```
style.prefix + asset.prompt + [key clause]      // key clause only for cutout kinds with keyClause
             + style.suffix + style.negative + asset.negative
             + [style.refSuffix    when a ref/--ref-dir image is attached]
             + [style.anchorSuffix when a styleAnchor output is attached]
```

| field | meaning |
| --- | --- |
| `prefix` | prepended to every prompt (a global STYLE block) |
| `suffix` | appended after subject + key clause (palette / lighting / mood / rendering) |
| `negative` | global negative clauses, appended last. Negatives ride **inside** the prompt — that works on every backend; providers with a separate negative field may split it out themselves. |
| `refSuffix` | appended when an img2img `ref` (or `--ref-dir` hit) is attached. Has a battle-tested default (redraw the reference at higher fidelity, keep composition/silhouette/palette). |
| `anchorSuffix` | appended when a `styleAnchor` output is attached. Default tells the model to match the reference's look but NOT copy its composition/subject. |

The **key clause** is auto-built from `chromaKey` — never hand-write "transparent background"
or a backdrop instruction into a prompt; the tool owns it. Its default text demands one solid
uniform fill covering every non-subject pixel, no checkerboard/gradient/scene/shadow, and that
the subject itself contains none of the key colour.

## `palette`, `chromaKey`, `chromaTolerance`, `pxScale`

- **`palette`** — array of `#rrggbb` hexes. Presence enables the `quantize` post (hard-lock every
  opaque pixel to the nearest palette colour). `tile` quantizes by default; any asset can opt in
  via `post.quantize`. `quantize` with no palette is a validation error.
- **`chromaKey`** — the cutout backdrop colour (`#rrggbb`, default `#ff00ff`). Pick a
  **palette-foreign** colour the art never contains. The de-spill step is written for a
  magenta-family key (R and B above G) — which is also the sane choice — and simply skips the
  colour-cast correction for other keys.
- **`chromaTolerance`** — squared-distance threshold for "is this pixel the key". Default `110`.
  Raise it if a slightly-off backdrop isn't fully clearing; lower it if key-adjacent subject
  detail is being eaten. Tuning it and `repost`-ing is free.
- **`pxScale`** — multiplies the **stored** size for *scaled* kinds only (`cutout`), giving detail
  headroom since display is size-driven. Surfaces baked at exact game px (`plate`/`tile`) are
  `scaled: false` and ignore it — extra resamples there read as mud. Default `1`.

## `providers`

```jsonc
"providers": {
  "default": "gemini",                                  // which provider `generate` uses; default "gemini"
  "gemini": { "model": "gemini-3.1-flash-image" },      // per-provider config (object, or a bare string = model)
  "retrodiffusion": { "options": { "prompt_style": "rd_fast__game_asset" } }
}
```

Each provider entry (`ProviderConfig`) accepts: `model`, `apiKeyEnv` (string or array; overrides
the default env var names), `baseUrl`, `imageSize`, `costPerImage: { sync?, batch? }` (override the
built-in cost guess for `plan`), and `options` (provider-specific defaults merged under every
request). See `providers.md` for per-provider env vars and knobs. A bare string value is shorthand
for `{ "model": "<string>" }`.

## `kinds` (custom)

A kind is just a named preset of post behaviour + two generation-side flags. Define new ones or
override the built-ins under top-level `kinds`; per-asset `post` still wins over the kind. A full
`KindSpec` is a `PostSpec` (`cutout`, `trim`, `fit`, `quantize`, `kernel`) plus:

- `scaled` — does `pxScale` multiply the stored size? (true for contain-fit sprites, false for
  exact-px surfaces)
- `keyClause` — append the auto-built chroma-key clause to prompts of this kind?

```jsonc
"kinds": {
  "decal": { "cutout": true, "trim": true, "fit": "contain", "quantize": true,
             "kernel": "nearest", "scaled": true, "keyClause": true },
  "cutout": { "kernel": "lanczos3" }   // override just one field of a built-in
}
```

Built-in kinds and post fields are documented in `post-and-kinds.md`.

## Asset fields

```jsonc
{
  "id": "urn",                    // REQUIRED, unique across the whole file (assets AND derives)
  "kind": "cutout",               // preset; default "cutout"
  "prompt": "A cracked ceremonial urn on a stone plinth.",  // REQUIRED — SUBJECT ONLY
  "negative": "no gold leaf",     // extra negatives for this asset (after style.negative)
  "px": [20, 36],                 // [w,h] final game px; REQUIRED unless the kind's fit is "none"
  "out": "skins/castle/urn.png",  // REQUIRED, relative to assetRoot; must be unique
  "channel": "PROP_ART",          // manifest map; default "art"
  "key": "urn",                   // lookup key within the channel; default = id
  "group": "castle",              // free-form grouping; filterable, and the --ref-dir subfolder
  "tags": ["breakable"],          // free-form labels; filterable via --tag
  "priority": 40,                 // higher = generated sooner under --top; default 0
  "enabled": true,                // false = catalogued but not generated (without --id/--include-disabled) nor wired; default true
  "ref": "renders/urn.png",       // img2img COMPOSITION anchor (path rel. to the file); triggers refSuffix
  "styleAnchor": "urn-anchor",    // id of ANOTHER asset whose output is a STYLE reference; triggers anchorSuffix
  "aspect": "2:3",                // aspect hint "W:H"; default snapped from px by the provider
  "seed": 7,                      // deterministic seed, for providers that honour one
  "model": "gemini-3-pro-image",  // per-asset model override
  "provider": "retrodiffusion",   // per-asset provider override (a run may span providers)
  "providerOptions": { "strength": 0.4 }, // opaque provider-specific params, passed through verbatim
  "post": { "quantize": true },   // per-asset PostSpec overrides on top of the kind
  "derive": [ ... ]               // companions edited from the fresh base (see below)
}
```

Notes on the two reference mechanisms — they are different tools:

- **`ref`** (composition anchor, img2img): attaches *your own* image (e.g. the game's procedural
  render) so the model **redraws that exact composition** at higher fidelity. Carries layout +
  palette. `--ref-dir=DIR` is the bulk form: it probes `DIR/<group>/<id>.png` then `DIR/<id>.png`
  for each row, so you can drop a folder of renders next to a catalogue without editing the file.
- **`styleAnchor`** (style anchor): names *another asset in this file*; that asset's generated
  output is attached only to transfer **look** (palette, pixel density, outline weight), explicitly
  NOT composition. This is how a set holds one style without one plate's content bleeding into all.

Both attach only if the provider `supportsEdits`; on a provider that doesn't (Scenario), refs are
dropped with a warning and derivations are skipped.

## Derivations

```jsonc
"derive": [
  { "id": "urn_broken",           // REQUIRED, unique; also the default manifest key
    "prompt": "Smash this urn into a low pile of broken debris — same materials, same palette, nothing standing.",
    "out": "skins/castle/urn_broken.png",  // REQUIRED, unique
    "px": [20, 36],               // defaults to the parent's px
    "channel": "PROP_ART",        // defaults to the parent's channel
    "key": "urn_broken",          // defaults to the derive id
    "post": { "trim": false } }   // defaults to the parent's resolved post
]
```

A derivation is generated by **editing the freshly generated base image** (the base is attached as
the reference), so the companion shares silhouette/palette and reads as the same object. Use for
broken/debris states, wear tiers, damage variants, recolours. They run **synchronously right after
the base lands** — including after a batch job — and are **one level deep** (base → companions; a
derivation cannot itself have `derive`). The key clause is auto-appended to a derivation prompt when
its post cuts out. A missing derivation is filled in from an existing base without re-buying the base.

## Style anchors

Give several assets `styleAnchor: "<id>"` pointing at one of them. During `generate` the anchor is
run **first** (and is pulled into the run automatically from the full catalogue if it's referenced
but not itself selected and missing on disk), then each member generates with the anchor's output
attached. A member whose anchor has no output on disk is **skipped rather than generated off-style**.
Separate sequences should use separate anchors so a warm set can't bleed its palette into a cold one.
Anchors are one level deep: the anchor asset itself must not have a `styleAnchor`.

## Validation rules

`validate` (and every load) enforces, with actionable messages:

- `version` is exactly `1`; `assets` is a non-empty array.
- `id` present and **unique across all assets and derivations**.
- `prompt` and `out` present on every asset and derivation.
- No two assets/derives write the same `out`.
- No two assets/derives claim the same `channel` + `key` pair.
- `px` `[w,h]` present when the resolved kind's `fit` is not `none`.
- `post.quantize` requires a non-empty top-level `palette`.
- `chromaKey` and every `palette` entry match `#rrggbb`; `pxScale` is a positive number.
- `provider` / `providers.default` is one of `gemini`, `retrodiffusion`, `scenario`, `mock`.
- `kind` exists (built-in or defined in `kinds`).
- `styleAnchor` references a **different**, existing asset that is **not itself anchored**.

Assets are then sorted **priority desc → group → id** so `--top` and batch slicing are deterministic.

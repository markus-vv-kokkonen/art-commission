# Post-processing & kinds

Every generation is two halves: the provider returns raw bytes, then **local post**
(the `sharp` library — no network, no paid edit tools) turns them into the shipped file.
`repost` is *only* the second half, replayed from the kept raw original for $0. Post code
lives in `src/post.ts`; it's applied via `src/pipeline.ts`. `sharp` is imported lazily, so
non-generating commands don't need it installed.

## PostSpec — the five knobs

A `kind` is a named bundle of these; per-asset `post` overrides individual fields.

| field | values | meaning |
| --- | --- | --- |
| `cutout` | bool | chroma-key the prompted backdrop into real PNG alpha, then de-spill |
| `trim` | bool | trim fully-transparent margins (only meaningful **after** a cutout) |
| `fit` | `contain` \| `inside` \| `cover` \| `none` | how the image meets the target px (below) |
| `quantize` | bool | hard-lock every opaque pixel to the nearest `palette` colour |
| `kernel` | `nearest` \| `lanczos3` | resample kernel — `nearest` keeps pixel-art crispness; `lanczos3` suits painterly/HD art |

`fit` in detail:

- **`contain`** — scale to fit **inside** target px, never cropping, padding the remainder with
  transparency. The subject arrives whole at its in-game size whatever aspect the model returned.
  Used by `cutout` (an un-cut opaque image is *not* trimmed, because `trim` keys off the corner
  colour and would misbehave without alpha).
- **`inside`** — as `contain`, but **without the padding**: the stored PNG's own dimensions are
  the artwork's, so `px` is a resolution *budget* and not a frame. Choose it when the consumer
  positions by the ART rather than by the frame. A rig part is the case that forced it: the rig
  draws the whole PNG into a bone-sized box, so a transparent margin shrinks the art inside that
  box — and since each part is trimmed then fitted independently, every part shrinks by a
  different amount (Podge's `torso_core` filled 77% of its width, `foreleg_lower_l` just 38%).
  The cost is that stored dimensions vary per asset, so anything that needs an exact frame —
  a wrapping tile, a parallax band — must stay on `contain`/`cover`.
- **`cover`** — scale to **fill** the target exactly (for full-bleed sources you prompted at the
  same aspect). Used by `plate`/`tile`.
- **`none`** — keep the model's native resolution untouched. Used by `still`; the engine scales it.

## The four built-in kinds

Resolved values from `src/config.ts` (`BUILTIN_KINDS`):

| kind | cutout | trim | fit | quantize | kernel | scaled | keyClause |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `cutout` | ✅ | ✅ | contain | ❌ | nearest | ✅ | ✅ |
| `plate` | ❌ | ❌ | cover | ❌ | nearest | ❌ | ❌ |
| `tile` | ❌ | ❌ | cover | ✅ | nearest | ❌ | ❌ |
| `still` | ❌ | ❌ | none | ❌ | nearest | ❌ | ❌ |

Two extra flags, `scaled` and `keyClause`, are kind-level (not per-asset `post`):

- **`scaled`** — whether `pxScale` multiplies the **stored** size. True for contain-fit sprites
  (storing at 2× gives free detail headroom; on-screen size is size-driven anyway). False for
  surfaces baked at exact game px, where an extra resample reads as mud.
- **`keyClause`** — whether the auto-built chroma-key clause is appended to prompts of this kind
  (so the model paints the keyable backdrop). Tied to `cutout` in practice.

Choosing a kind:

- **Isolated object** that needs a transparent background (prop, icon, weapon plate, decal,
  breakable) → **`cutout`**.
- **Full-frame scene** shown at an exact size (room plate, floor centrepiece, background) → **`plate`**.
- **Seamless repeating texture** at exact px that must match limited-palette art (tiling floor,
  terrain) → **`tile`** (needs a `palette`).
- **Key art** the engine scales itself (cutscene / story / title backdrop) → **`still`**.

Anything else: define a custom kind under top-level `kinds`, or start from a built-in and override
specific `post` fields per asset.

## The cutout pipeline (the transparency contract)

Image models cannot output alpha — asked for "transparent" they paint a fake checkerboard. So:

1. **Prompt side:** cutout kinds get a key clause appended demanding one flat, uniform `chromaKey`
   fill on every non-subject pixel (no checkerboard, gradient, scene, floor, or cast shadow), and
   that the subject contains none of that colour.
2. **`keyCutout`:** measures what fraction of the **border** is the key colour. If **< 50%** the
   model ignored the key → it returns the input **untouched** with a low `borderKeyFrac` and
   `clearedFrac: 0`, and the caller warns (`backdrop is not the chroma key (border match NN%) —
   wrote as-is`). Otherwise it does a **global** clear (every key-matching pixel → alpha 0), which
   reaches enclosed backdrop holes (the gap under a well's roof) that a border flood-fill can't.
3. **De-spill:** subject pixels touching the cut have the key's colour cast pulled out (magenta-family
   keys only; others skip this).
4. **`trim`** transparent margins → **`fitContain`** into `px × pxScale`.

**Debugging a bad cutout:**
- *Opaque prop / "wrote as-is" warning* → the model didn't paint the key. Strengthen the subject
  prompt (or lower the subject's tendency to fill the frame), regenerate with `--force`. Raising
  `chromaTolerance` only helps if the backdrop is *close* to the key.
- *Magenta fringe on edges* → de-spill didn't fully catch it; nudge `chromaTolerance` up and
  `repost`. (Ensure the key is magenta-family so de-spill runs at all.)
- *Subject detail eaten* → tolerance too high, or the subject contains a near-key colour. Lower
  `chromaTolerance` (or change `chromaKey` to something more foreign) and `repost`.
- *Wrong size / padding* → that's `fit`/`px`/`pxScale`; fix and `repost`. Free.

Because steps 2–4 are all local, **every one of these fixes except "the model painted the wrong
thing" is a `repost`, not a `generate`.**

## quantize (palette lock)

Models emit soft, many-shade dithering that reads as mud next to clean limited-palette procedural
art. `quantizePalette` snaps every opaque pixel (alpha ≥ 8) to the nearest `palette` colour by
squared RGB distance. `tile` does this by default; enable it on any asset via `post.quantize` (a
`palette` must exist). Transparent pixels are left alone.

## `--no-downscale`

Skips the resize step for a run (the cutout still runs), writing the native-resolution result.
Useful to inspect full-detail output or to keep raws large; `repost` without the flag re-fits later.

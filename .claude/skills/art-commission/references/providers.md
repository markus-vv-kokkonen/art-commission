# Providers

Everything above the provider line (selection, prompt assembly, post, wiring) is
provider-agnostic; a provider owns only auth, request shape, polling, and the batch protocol.
The interface is `src/providers/types.ts`; the registry is `src/providers/index.ts`. A row's
provider is `asset.provider ?? --provider ?? providers.default` (default `gemini`), so a single
run can span providers — `generate` groups rows by provider and runs each group.

## Capability matrix

| | gemini | retrodiffusion | scenario | mock |
| --- | --- | --- | --- | --- |
| `supportsBatch` (discounted async job) | ✅ | ❌ | ❌ | ❌ |
| `supportsEdits` (refs / anchors / derivations) | ✅ | ✅ (img2img) | ❌ | ✅ (accepts, ignores) |
| `listModels` (the `models` command) | ✅ | ❌ | ❌ | ❌ |
| default cost/image for `plan` | ~$0.067 sync / ~$0.033 batch (pro: ~$0.25) | formula (≈$0.015–0.18) | unknown (null) | $0 |

`supportsEdits` matters: on a provider without it (Scenario), attached `ref`/`styleAnchor` images
are dropped with a warning and derivations are skipped. `supportsBatch` matters: `--sync` is only
meaningful where batch exists (Gemini); elsewhere generation is already per-request.

## gemini — the primary path

REST against `generativelanguage.googleapis.com`. The **sync** path returns the image inline; the
**Batch API** path runs the *same* models at ~half price (async, <24h SLA, usually minutes) and is
the **default** unless `--sync`. One body builder is shared by both, so a batch line is byte-for-byte
the sync request — look/framing can't drift between them.

- **Env:** `GEMINI_API_KEY` (or `GOOGLE_API_KEY`). Override names via `providers.gemini.apiKeyEnv`.
  Base URL via `providers.gemini.baseUrl` or `GEMINI_API_BASE`; default model via
  `providers.gemini.model` or `GEMINI_MODEL` (`gemini-3.1-flash-image`).
- **Batch behaviour:** uploads a JSONL of requests, creates a job, polls (`--poll-secs`, default 15).
  It prints the **job name** on submit and runs **server-side even if you stop** — already-generated
  files are skipped on the next run, so a killed batch is resumable. One job per model (rows are
  grouped by model). `imageSize` is set via `--size=1K|2K` or `providers.gemini.imageSize`; aspect is
  `--aspect`/`asset.aspect`, else snapped from `px` to the nearest supported ratio.
- **Model ids drift between API revisions.** Trust `art-commission models` over any docs list — it
  asks the live API what *your* key can call. A **404 on generate means the id is wrong for your
  key/tier**, not a broken tool; a 429/5xx is retried with backoff, a 400/401/403 is not.
- **Cost:** `estimateUSD` guesses ~$0.067/image sync (~$0.25 for a `*pro*` model), batch = half.
  Override precisely with `providers.gemini.costPerImage: { sync, batch }`.

## retrodiffusion — pixel-art-native

Synchronous `POST /v1/inferences` against `api.retrodiffusion.ai`. Pixel-art-native diffusion; its
"model" is a **`prompt_style`** (default `rd_fast__game_asset`). RD-specific knobs pass through
verbatim via `providerOptions` (per asset) or `providers.retrodiffusion.options` (defaults):
`prompt_style`, `input_palette`, `strength`, `remove_bg`, explicit `width`/`height`, etc. — anything
the API accepts is reachable without code changes.

- **Env:** `RETRODIFFUSION_API_KEY` (or `RD_API_KEY`).
- **img2img:** the first attached reference image anchors composition + palette (`strength` default
  0.5). Generates on a coarse grid (multiples of 8, 64–512 px), so target px are snapped to fit.
- **Cost:** local `rdEstimate` mirrors the API's published per-style formulas.

## scenario — train on your own art

Async `txt2img` job + poll + asset download against `api.cloud.scenario.com`. Scenario's whole draw
is **training a model on your art bible**, so the look comes from the trained model, not prompt
discipline or post. Set the trained model id via `providers.scenario.model` or `SCENARIO_MODEL_ID`.

- **Env:** `SCENARIO_API_KEY` **and** `SCENARIO_API_SECRET` (HTTP Basic).
- **No edits:** `supportsEdits: false` — img2img needs a pre-uploaded asset id that isn't wired here,
  so refs/anchors/derivations don't apply. Cost is unknown to the estimator (`null`) unless you set
  `providers.scenario.costPerImage.sync`.

## mock — offline, free, deterministic

Local placeholder generator: zero network, zero spend, deterministic per request id. **Cutout
requests are painted on the real `chromaKey`** with a smaller subject shape inside, so `keyCutout`
has genuine work — the whole pipeline (prompt assembly, cutout, fit, quantize, derivations, anchor
chains, wiring) is exercised. Two big uses:

1. **CI / tests** run the entire loop with no key (`npm test` uses it).
2. **Placeholder-first development:** commission the whole catalogue as placeholders, watch every
   asset land in-engine at the right size, then re-run against a real provider with **identical
   selection flags**. `generate --provider=mock` then swap `--provider=gemini`.

`supportsEdits` is true (refs accepted and ignored) so edit/derive/anchor flows stay testable.

## How a generate run is orchestrated (`src/generate.ts`)

Per provider group:

1. **Split into phases.** Style anchors go first; any anchor that's *referenced* by a selected member
   but missing on disk is pulled into the run from the full catalogue (a member never generates
   off-style silently). Members follow.
2. **Batch providers** (Gemini, no `--sync`): each phase is one job — anchors as job 1/2, members as
   2/2. Rows already on disk are skipped; derive-only rows are held for the synchronous derive pass.
3. **Sync providers** (or `--sync`): a small worker pool (`--concurrency`, default 2) processes the
   phase; an auth error (`40x`, "api key", "unauthor") or a 404 model error aborts the phase early
   with a pointed message.
4. **Derivations** always run **synchronously after each base lands** (even under batch), editing the
   fresh base image. `--no-derive` skips them.
5. Every write stores the raw original first, then post-processes and writes the shipped file. Key
   misses warn but still write (as-is), so you notice instead of shipping an opaque prop.

## Adding a provider

Implement the small `Provider` interface in `src/providers/types.ts` — `name`, `supportsBatch`,
`supportsEdits`, `defaultModel`, `generate(req) → bytes`, optional `generateBatch` / `listModels`,
and `estimateUSD(model, batch)` — then register the factory in `src/providers/index.ts` **and** add
the name to `KNOWN_PROVIDERS` in `src/config.ts` so validation accepts it. Keep negatives inside
`prompt` (works everywhere); read the API key via the `envKey` helper so `apiKeyEnv` overrides work.
Mirror `mock.ts` for the simplest possible shape.

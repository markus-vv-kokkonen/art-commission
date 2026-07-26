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
export {};

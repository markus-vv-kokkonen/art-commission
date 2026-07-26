/**
 * Programmatic API — everything the CLI does is callable as a library, so a
 * game's own build scripts can embed the pipeline (or add bespoke steps)
 * without shelling out.
 */
export * from './types.js';
export { loadCommission, loadCommissionFile, resolveCommission, validateCommission, keyClause, BUILTIN_KINDS, KNOWN_PROVIDERS, DEFAULT_REF_SUFFIX, DEFAULT_ANCHOR_SUFFIX, DEFAULT_CHROMA_KEY, } from './config.js';
export { parseSelectionArgs, resolveSelection, describeSelection, unknownIds, } from './select.js';
export { runGenerate, countTodo, splitPhases, effectiveProvider, } from './generate.js';
export { runRepost } from './repost.js';
export { buildManifest, writeManifest, renderTsModule } from './wire.js';
export { keyCutout, fitContain, fitInside, fitCover, quantizePalette, applyPost, hexToRgb } from './post.js';
export { processAndWrite, loadImageRef, probeRefDir, writeBytes } from './pipeline.js';
export { createProvider, providerNames } from './providers/index.js';

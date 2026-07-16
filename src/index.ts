/**
 * Programmatic API — everything the CLI does is callable as a library, so a
 * game's own build scripts can embed the pipeline (or add bespoke steps)
 * without shelling out.
 */

export * from './types.js';
export {
  loadCommission, loadCommissionFile, resolveCommission, validateCommission,
  keyClause, BUILTIN_KINDS, KNOWN_PROVIDERS,
  DEFAULT_REF_SUFFIX, DEFAULT_ANCHOR_SUFFIX, DEFAULT_CHROMA_KEY,
} from './config.js';
export {
  parseSelectionArgs, resolveSelection, describeSelection, unknownIds,
  type Selection, type SelectionArgs,
} from './select.js';
export {
  runGenerate, countTodo, splitPhases, effectiveProvider,
  type GenerateFlags, type GenerateSummary, type Outcome,
} from './generate.js';
export { runRepost, type RepostFlags, type RepostSummary } from './repost.js';
export { buildManifest, writeManifest, renderTsModule, type ArtManifest, type WireScan } from './wire.js';
export { keyCutout, fitContain, fitCover, quantizePalette, applyPost, hexToRgb } from './post.js';
export { processAndWrite, loadImageRef, probeRefDir, writeBytes } from './pipeline.js';
export { createProvider, providerNames } from './providers/index.js';
export type { Provider, GenRequest, ImageRef, ModelInfo, BatchHooks } from './providers/types.js';

/**
 * Repost — re-run post-processing from the kept raw originals. ZERO API cost.
 *
 * Key-tolerance tweaks, target-size changes, palette-lock fixes: none of them
 * should ever mean paying for regeneration. Every generation stored the
 * model's untouched output under rawRoot; this redoes the second half.
 */
import type { ResolvedAsset, ResolvedCommission } from './types.js';
export interface RepostFlags {
    noDownscale?: boolean;
}
export interface RepostSummary {
    reprocessed: number;
    noRaw: number;
}
export declare function runRepost(c: ResolvedCommission, rows: ResolvedAsset[], flags?: RepostFlags, log?: (s: string) => void): Promise<RepostSummary>;

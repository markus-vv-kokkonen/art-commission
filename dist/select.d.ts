/**
 * The selection language — turn CLI flags into a concrete, ordered list of
 * assets to act on. Shared by plan / generate / repost / status / wire.
 *
 *   --id=a,b            explicit ids (wins outright; matches derives' parents too)
 *   --group=castle      one or more groups
 *   --tag=prop,floor    one or more tags (an asset matches if it has ANY)
 *   --kind=cutout       one or more kinds
 *   --channel=FLOOR_ART one or more manifest channels
 *   --top=N             keep the N highest-priority rows after filtering
 *   --limit=N           hard cap after everything else
 *   --include-disabled  include enabled:false rows
 *   --batch-size=50 --batch=0   deterministic slicing over the filtered pool
 */
import type { ResolvedAsset, ResolvedCommission } from './types.js';
export interface SelectionArgs {
    ids?: string[];
    groups?: string[];
    tags?: string[];
    kinds?: string[];
    channels?: string[];
    top?: number;
    limit?: number;
    batchSize?: number;
    batchIndex?: number;
    includeDisabled: boolean;
}
export interface Selection {
    rows: ResolvedAsset[];
    /** size of the filtered pool before batch slicing. */
    poolSize: number;
    batchCount: number;
}
export declare function parseSelectionArgs(get: (k: string) => string | undefined, has: (k: string) => boolean): SelectionArgs;
export declare function resolveSelection(c: ResolvedCommission, args: SelectionArgs): Selection;
/** Unknown ids passed via --id (typo guard). */
export declare function unknownIds(c: ResolvedCommission, args: SelectionArgs): string[];
/** One-line human summary for --plan / dry runs. */
export declare function describeSelection(args: SelectionArgs, s: Selection): string;

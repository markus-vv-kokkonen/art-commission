/**
 * The generation runner — provider-agnostic orchestration of a selected set
 * of assets, honouring the spend-safe rules the format encodes:
 *
 *   - files already on disk are SKIPPED unless --force (resumable by default;
 *     a missing derivation is still filled in from the existing base)
 *   - style anchors generate FIRST, then members with the anchor's output
 *     attached as a style reference (two batch jobs on batch providers)
 *   - derivations are EDITS of the fresh base image, run synchronously after
 *     the base lands (they need the base as their reference)
 *   - every raw original is kept for zero-cost `repost`
 */
import type { ResolvedAsset, ResolvedCommission } from './types.js';
export interface GenerateFlags {
    provider?: string;
    model?: string;
    /** Per-request mode at full price; default is the provider's batch path when it has one. */
    sync?: boolean;
    force?: boolean;
    concurrency?: number;
    pollSecs?: number;
    refDir?: string;
    noDerive?: boolean;
    noDownscale?: boolean;
    /** Provider size hint override (e.g. Gemini imageSize). */
    size?: string;
    /** Force one aspect for every request. */
    aspect?: string;
}
export interface Outcome {
    id: string;
    ok: boolean;
    skipped?: boolean;
    refUsed?: boolean;
    anchored?: boolean;
    derived?: number;
    error?: string;
}
export interface GenerateSummary {
    outcomes: Outcome[];
    generated: number;
    skipped: number;
    failed: Outcome[];
}
type Log = (line: string) => void;
/** Which provider a row rides on. */
export declare const effectiveProvider: (row: ResolvedAsset, c: ResolvedCommission, flags: GenerateFlags) => string;
/** Count of images a run would actually pay for (bases + derivations). */
export declare function countTodo(rows: ResolvedAsset[], flags: GenerateFlags): {
    bases: number;
    derives: number;
};
/**
 * Split the to-generate set into anchor phase and member phase. Anchors that
 * are merely REFERENCED (not selected) but missing on disk are pulled in from
 * the full catalogue — a member must never generate off-style silently.
 */
export declare function splitPhases(rows: ResolvedAsset[], c: ResolvedCommission, force: boolean): {
    anchors: ResolvedAsset[];
    members: ResolvedAsset[];
};
/** Generate a selected set of rows. Rows may span providers. */
export declare function runGenerate(c: ResolvedCommission, rows: ResolvedAsset[], flags: GenerateFlags, log?: Log): Promise<GenerateSummary>;
export {};

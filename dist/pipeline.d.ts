/**
 * Shared file/post plumbing for generate + repost.
 *
 * The spend-safety invariant lives here: EVERY generation writes the model's
 * untouched native-res original under rawRoot before post-processing writes
 * the shipped file — so post tweaks (key tolerance, target size, palette
 * lock) are re-runnable for free, forever, via `repost`.
 */
import type { PostSpec, ResolvedCommission } from './types.js';
import type { ImageRef } from './providers/types.js';
export interface PostTarget {
    id: string;
    outAbs: string;
    rawAbs: string;
    post: PostSpec;
    storePx?: [number, number];
}
export declare function writeBytes(path: string, bytes: Uint8Array): Promise<void>;
export declare function loadImageRef(path: string): Promise<ImageRef>;
export interface ProcessOptions {
    /** Skip the resize step this run (cutout still runs). */
    noDownscale?: boolean;
    /** Skip writing the raw original (used by repost, whose input IS the raw). */
    skipRaw?: boolean;
    onKeyMiss?: (id: string, borderKeyFrac: number) => void;
}
/** Post-process raw model bytes for a target and write both raw + final. */
export declare function processAndWrite(c: ResolvedCommission, t: PostTarget, rawBytes: Uint8Array, o?: ProcessOptions): Promise<void>;
/** Probe --ref-dir for a composition reference: DIR/<group>/<id>.png, DIR/<id>.png. */
export declare function probeRefDir(refDir: string | undefined, group: string | undefined, id: string): string | undefined;

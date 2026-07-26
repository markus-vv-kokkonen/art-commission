/**
 * Wire — emit the asset manifest the game consumes.
 *
 * Scans the output tree for files that exist, then writes ONE JSON manifest
 * mapping channel → key → path (paths relative to assetRoot, forward
 * slashes). The intended game-side pattern is a guarded lookup per channel:
 * key present → load the procured file, key absent → code-drawn fallback.
 * That keeps every generated asset strictly additive.
 *
 * Only enabled assets wire — flipping an asset to enabled:false unwires it on
 * the next run even if its PNG still exists (descoping a class is one flag).
 *
 * `--ts` additionally emits a TypeScript module (same path, .ts) with one
 * exported const per channel, for engines that prefer a typed import.
 */
import type { ResolvedCommission } from './types.js';
export interface ManifestAssetEntry {
    out: string;
    channel: string;
    key: string;
    kind?: string;
    group?: string;
    px?: [number, number];
}
export interface ArtManifest {
    $generator: 'art-commission';
    version: 1;
    name: string;
    counts: {
        catalogued: number;
        wired: number;
    };
    /** channel → key → out path (relative to assetRoot). */
    channels: Record<string, Record<string, string>>;
    /** every wired id, with its metadata. */
    assets: Record<string, ManifestAssetEntry>;
}
export interface WireScan {
    manifest: ArtManifest;
    /** enabled ids (assets + derives) with no file on disk. */
    missing: string[];
    catalogued: number;
}
export declare function buildManifest(c: ResolvedCommission): WireScan;
/** Render the optional TypeScript companion module. */
export declare function renderTsModule(m: ArtManifest): string;
export declare function writeManifest(c: ResolvedCommission, opts?: {
    ts?: boolean;
}): Promise<WireScan>;

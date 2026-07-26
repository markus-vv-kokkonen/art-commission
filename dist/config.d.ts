/**
 * Load, validate and resolve a commission file.
 *
 * Validation is hand-rolled (no schema-library dependency) and aims for
 * actionable messages; schema/commission.schema.json exists for editor
 * tooling, but THIS is the source of truth.
 */
import type { CommissionFile, KindSpec, ResolvedCommission } from './types.js';
export declare const DEFAULT_CHROMA_KEY = "#ff00ff";
export declare const DEFAULT_CHROMA_TOLERANCE = 110;
/** Appended when an img2img `ref` image is attached (composition anchor). */
export declare const DEFAULT_REF_SUFFIX = " Redraw the reference image at higher fidelity, keeping its exact composition, silhouette and palette.";
/** Appended when a `styleAnchor` output is attached (style anchor). */
export declare const DEFAULT_ANCHOR_SUFFIX: string;
/**
 * The chroma-key half of the transparency contract. Image models cannot emit
 * PNG alpha — asked for "transparent", they PAINT a checkerboard — so cutout
 * prompts demand one exact palette-foreign backdrop and post cuts it locally.
 */
export declare function keyClause(hex: string): string;
export declare const BUILTIN_KINDS: Record<string, KindSpec>;
/** Provider names the CLI can instantiate (see providers/index.ts). */
export declare const KNOWN_PROVIDERS: string[];
/** Load the raw commission object from JSON, or from a JS module whose default
 *  export (or module.exports) is the same shape. */
export declare function loadCommissionFile(file: string): Promise<CommissionFile>;
/** Structural + referential validation. Returns [] when the file is sound. */
export declare function validateCommission(raw: CommissionFile): string[];
/** Fold every default into every asset. Throws on validation errors. */
export declare function resolveCommission(raw: CommissionFile, file: string): ResolvedCommission;
/** Convenience: load + resolve. */
export declare function loadCommission(file: string): Promise<ResolvedCommission>;

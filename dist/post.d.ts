/**
 * Local post-processing (sharp) — the second half of every generation, and
 * the whole of `repost`. No paid edit-tools, no network.
 *
 *   keyCutout       chroma-key the prompted backdrop → real PNG alpha (+ de-spill)
 *   fitContain      resize into exact target px WITHOUT cropping (pads alpha)
 *   fitCover        resize filling the frame (same-aspect full-bleed sources)
 *   quantizePalette hard-lock opaque pixels to the nearest palette colour
 *
 * Why keyCutout exists: image models cannot emit PNG alpha (they *paint* a
 * fake checkerboard when asked for "transparent"), so cutout prompts demand
 * one exact palette-foreign backdrop colour and this clears it locally.
 * Why the clear is GLOBAL once the border confirms the key: backdrops show
 * through enclosed holes too (the gap under a well's roof), which a
 * border flood-fill can never reach.
 *
 * sharp is imported lazily so `plan` / `validate` / `wire` run without it.
 */
import type { PostSpec } from './types.js';
export interface CutoutResult {
    bytes: Uint8Array;
    /** fraction of border pixels that matched the key (~1 = the model honoured it). */
    borderKeyFrac: number;
    /** fraction of all pixels cleared (0 = key not honoured; input returned untouched). */
    clearedFrac: number;
}
/**
 * Remove the prompted chroma backdrop. If the model ignored the key (too few
 * border pixels match), the input is returned untouched with a low
 * `borderKeyFrac` so the caller can warn instead of shipping an opaque prop.
 */
export declare function keyCutout(input: Uint8Array, keyRgb: [number, number, number], tolerance?: number): Promise<CutoutResult>;
/**
 * Optionally trim fully-transparent margins, then scale to FIT INSIDE target
 * px (never cropping), padding with transparency. The subject arrives whole
 * at its in-game size whatever aspect the model returned.
 */
export declare function fitContain(input: Uint8Array, w: number, h: number, kernel?: 'nearest' | 'lanczos3', trim?: boolean): Promise<Uint8Array>;
/**
 * Trim, then scale to fit inside target px — and DO NOT pad. The stored PNG's own
 * dimensions are the artwork's, so `px` is a resolution budget rather than a frame.
 *
 * Why this exists, when `contain` already fits inside: a padded sprite is fine for a
 * consumer that positions by the frame, and wrong for one that positions by the art.
 * A rig part is the second kind. The rig draws the whole PNG into a bone-sized box, so
 * a transparent margin silently shrinks the art inside that box — and because each part
 * is trimmed then contained independently, every part shrinks by a DIFFERENT amount
 * (measured on Podge: `torso_core` filled 77% of its width, `foreleg_lower_l` just 38%).
 * No amount of tuning the rig's numbers fixes that; the padding has to not be there.
 */
export declare function fitInside(input: Uint8Array, w: number, h: number, kernel?: 'nearest' | 'lanczos3', trim?: boolean): Promise<Uint8Array>;
/** Resize filling the exact target (full-bleed sources prompted at the same aspect). */
export declare function fitCover(input: Uint8Array, w: number, h: number, kernel?: 'nearest' | 'lanczos3'): Promise<Uint8Array>;
/**
 * Hard-lock every opaque pixel to the nearest palette colour. Models emit
 * soft many-shade dithering that reads as MUD next to clean limited-palette
 * procedural art — tiling surfaces get quantized so they match.
 */
export declare function quantizePalette(input: Uint8Array, paletteRgb: Array<[number, number, number]>): Promise<Uint8Array>;
export declare const hexToRgb: (hex: string) => [number, number, number];
export interface ApplyPostOptions {
    keyRgb: [number, number, number];
    tolerance: number;
    paletteRgb: Array<[number, number, number]>;
    /** Skip the resize step (keep native px) — the cutout still runs. */
    noDownscale?: boolean;
    /** Called when a cutout post found the key was not honoured. */
    onKeyMiss?: (borderKeyFrac: number) => void;
}
/** Run one PostSpec over raw model bytes. */
export declare function applyPost(input: Uint8Array, post: PostSpec, storePx: [number, number] | undefined, o: ApplyPostOptions): Promise<Uint8Array>;

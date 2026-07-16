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

type Sharp = typeof import('sharp').default;
let _sharp: Sharp | undefined;
async function sharpMod(): Promise<Sharp> {
  if (!_sharp) {
    try {
      _sharp = (await import('sharp')).default;
    } catch {
      throw new Error('post-processing needs the "sharp" package — npm install sharp');
    }
  }
  return _sharp;
}

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
export async function keyCutout(
  input: Uint8Array,
  keyRgb: [number, number, number],
  tolerance = 110,
): Promise<CutoutResult> {
  const sharp = await sharpMod();
  const { data, info } = await sharp(Buffer.from(input))
    .ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const w = info.width, h = info.height;
  const tol2 = tolerance * tolerance;
  const isKey = (o: number): boolean => {
    const dr = data[o] - keyRgb[0], dg = data[o + 1] - keyRgb[1], db = data[o + 2] - keyRgb[2];
    return dr * dr + dg * dg + db * db < tol2;
  };

  // how much of the border is actually the key colour?
  let borderKey = 0, borderTotal = 0;
  const border: Array<[number, number]> = [];
  for (let x = 0; x < w; x++) border.push([x, 0], [x, h - 1]);
  for (let y = 1; y < h - 1; y++) border.push([0, y], [w - 1, y]);
  for (const [x, y] of border) {
    borderTotal++;
    if (isKey((y * w + x) * 4)) borderKey++;
  }
  const borderKeyFrac = borderKey / Math.max(1, borderTotal);
  if (borderKeyFrac < 0.5) {
    return { bytes: input, borderKeyFrac, clearedFrac: 0 };
  }

  // global key clear — reaches enclosed backdrop holes a flood fill cannot
  const cleared = new Uint8Array(w * h);
  let clearedCount = 0;
  for (let i = 0; i < w * h; i++) {
    const o = i * 4;
    if (isKey(o)) { cleared[i] = 1; data[o + 3] = 0; clearedCount++; }
  }

  // de-spill: object pixels touching the cut get the key's cast pulled out.
  // (Written for a magenta-family key — R and B above G — which is also the
  // sane choice of key for game art; other keys simply skip the correction.)
  const magentaish = keyRgb[0] > keyRgb[1] && keyRgb[2] > keyRgb[1];
  if (magentaish) {
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (cleared[i]) continue;
      const nearCut =
        (x > 0 && cleared[i - 1]) || (x < w - 1 && cleared[i + 1]) ||
        (y > 0 && cleared[i - w]) || (y < h - 1 && cleared[i + w]);
      if (!nearCut) continue;
      const o = i * 4;
      const r = data[o], g = data[o + 1], b = data[o + 2];
      if (r > g && b > g) {
        const e = Math.min(r, b) - g;
        data[o] = r - e; data[o + 2] = b - e;
      }
    }
  }

  const bytes = new Uint8Array(await sharp(Buffer.from(data.buffer, data.byteOffset, data.byteLength), {
    raw: { width: w, height: h, channels: 4 },
  }).png().toBuffer());
  return { bytes, borderKeyFrac, clearedFrac: clearedCount / (w * h) };
}

/**
 * Optionally trim fully-transparent margins, then scale to FIT INSIDE target
 * px (never cropping), padding with transparency. The subject arrives whole
 * at its in-game size whatever aspect the model returned.
 */
export async function fitContain(
  input: Uint8Array, w: number, h: number,
  kernel: 'nearest' | 'lanczos3' = 'nearest', trim = true,
): Promise<Uint8Array> {
  const sharp = await sharpMod();
  let buf = Buffer.from(input);
  if (trim) {
    // trim() on a fully-opaque image trims by corner colour — only safe post-cutout
    buf = await sharp(buf).trim({ threshold: 8 }).png().toBuffer().catch(() => Buffer.from(input));
  }
  return new Uint8Array(await sharp(buf)
    .resize(w, h, { kernel, fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png().toBuffer());
}

/** Resize filling the exact target (full-bleed sources prompted at the same aspect). */
export async function fitCover(
  input: Uint8Array, w: number, h: number,
  kernel: 'nearest' | 'lanczos3' = 'nearest',
): Promise<Uint8Array> {
  const sharp = await sharpMod();
  return new Uint8Array(await sharp(Buffer.from(input))
    .resize(w, h, { kernel, fit: 'cover' })
    .png().toBuffer());
}

/**
 * Hard-lock every opaque pixel to the nearest palette colour. Models emit
 * soft many-shade dithering that reads as MUD next to clean limited-palette
 * procedural art — tiling surfaces get quantized so they match.
 */
export async function quantizePalette(
  input: Uint8Array,
  paletteRgb: Array<[number, number, number]>,
): Promise<Uint8Array> {
  if (paletteRgb.length === 0) return input;
  const sharp = await sharpMod();
  const { data, info } = await sharp(Buffer.from(input))
    .ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const cache = new Map<number, number>();
  for (let o = 0; o < data.length; o += 4) {
    if (data[o + 3] < 8) continue;
    const key = (data[o] << 16) | (data[o + 1] << 8) | data[o + 2];
    let best = cache.get(key);
    if (best === undefined) {
      let bd = Infinity;
      best = 0;
      for (let i = 0; i < paletteRgb.length; i++) {
        const [r, g, b] = paletteRgb[i];
        const d = (data[o] - r) ** 2 + (data[o + 1] - g) ** 2 + (data[o + 2] - b) ** 2;
        if (d < bd) { bd = d; best = i; }
      }
      cache.set(key, best);
    }
    const [r, g, b] = paletteRgb[best];
    data[o] = r; data[o + 1] = g; data[o + 2] = b;
  }
  return new Uint8Array(await sharp(Buffer.from(data.buffer, data.byteOffset, data.byteLength), {
    raw: { width: info.width, height: info.height, channels: 4 },
  }).png().toBuffer());
}

export const hexToRgb = (hex: string): [number, number, number] => {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
};

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
export async function applyPost(
  input: Uint8Array,
  post: PostSpec,
  storePx: [number, number] | undefined,
  o: ApplyPostOptions,
): Promise<Uint8Array> {
  let bytes = input;
  let cutOk = false;
  if (post.cutout) {
    const cut = await keyCutout(bytes, o.keyRgb, o.tolerance);
    if (cut.clearedFrac === 0) o.onKeyMiss?.(cut.borderKeyFrac);
    else { bytes = cut.bytes; cutOk = true; }
  }
  if (!o.noDownscale && storePx && post.fit !== 'none') {
    if (post.fit === 'contain') {
      // an un-cut opaque image must not be trimmed (trim keys off corner colour)
      if (!post.cutout || cutOk) bytes = await fitContain(bytes, storePx[0], storePx[1], post.kernel, post.trim);
    } else {
      bytes = await fitCover(bytes, storePx[0], storePx[1], post.kernel);
    }
  }
  if (post.quantize) bytes = await quantizePalette(bytes, o.paletteRgb);
  return bytes;
}

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
/** How many pixel rings outward from the cut the de-spill/de-fringe pass walks. The halo a
 *  generated image leaves around a chroma backdrop runs 2-3px; one ring is not enough. */
const FRINGE_PASSES = 3;
/** Key cast (min(R,B) - G) at which a near-cut pixel is judged backdrop bleed rather than
 *  subject, and is made transparent instead of merely de-spilled. Measured fringe pixels
 *  carried 54-66; genuine warm subject colour has B below G and never reaches this test. */
const FRINGE_CLEAR = 40;
let _sharp;
async function sharpMod() {
    if (!_sharp) {
        try {
            _sharp = (await import('sharp')).default;
        }
        catch {
            throw new Error('post-processing needs the "sharp" package — npm install sharp');
        }
    }
    return _sharp;
}
/**
 * Remove the prompted chroma backdrop. If the model ignored the key (too few
 * border pixels match), the input is returned untouched with a low
 * `borderKeyFrac` so the caller can warn instead of shipping an opaque prop.
 */
export async function keyCutout(input, keyRgb, tolerance = 110) {
    const sharp = await sharpMod();
    const { data, info } = await sharp(Buffer.from(input))
        .ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const w = info.width, h = info.height;
    const tol2 = tolerance * tolerance;
    const isKey = (o) => {
        const dr = data[o] - keyRgb[0], dg = data[o + 1] - keyRgb[1], db = data[o + 2] - keyRgb[2];
        return dr * dr + dg * dg + db * db < tol2;
    };
    // how much of the border is actually the key colour?
    let borderKey = 0, borderTotal = 0;
    const border = [];
    for (let x = 0; x < w; x++)
        border.push([x, 0], [x, h - 1]);
    for (let y = 1; y < h - 1; y++)
        border.push([0, y], [w - 1, y]);
    for (const [x, y] of border) {
        borderTotal++;
        if (isKey((y * w + x) * 4))
            borderKey++;
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
        if (isKey(o)) {
            cleared[i] = 1;
            data[o + 3] = 0;
            clearedCount++;
        }
    }
    // De-spill AND de-fringe, walking outward from the cut.
    //
    // The key does not stop at the tolerance boundary: the model's own soft edges plus
    // generation/compression ringing leave a 2-3px halo carrying the backdrop's cast — too
    // far from the key colour to be cleared above, too magenta to keep. This used to run as a
    // SINGLE 4-adjacent ring, so it corrected the innermost pixel and shipped the rest: a
    // magenta outline on essentially every cutout in the catalogue, invisible until an
    // asset's edge happened to land on screen. (It did — the parallax frieze's top edge.)
    //
    // So walk out FRINGE_PASSES rings. A pixel still carrying a strong cast is backdrop bleed
    // and becomes transparent; a weakly-cast one keeps its alpha and just has the cast pulled
    // out, which preserves the soft edge. Both are gated on adjacency to the cut, so colour
    // that is legitimately magenta INSIDE a subject is never touched.
    //
    // (Written for a magenta-family key — R and B above G — which is also the
    // sane choice of key for game art; other keys simply skip the correction.)
    const magentaish = keyRgb[0] > keyRgb[1] && keyRgb[2] > keyRgb[1];
    if (magentaish) {
        for (let pass = 0; pass < FRINGE_PASSES; pass++) {
            const drop = [];
            for (let y = 0; y < h; y++)
                for (let x = 0; x < w; x++) {
                    const i = y * w + x;
                    if (cleared[i])
                        continue;
                    const nearCut = (x > 0 && cleared[i - 1]) || (x < w - 1 && cleared[i + 1]) ||
                        (y > 0 && cleared[i - w]) || (y < h - 1 && cleared[i + w]);
                    if (!nearCut)
                        continue;
                    const o = i * 4;
                    const r = data[o], g = data[o + 1], b = data[o + 2];
                    if (!(r > g && b > g))
                        continue;
                    const cast = Math.min(r, b) - g; // how much key this pixel is still carrying
                    if (cast >= FRINGE_CLEAR)
                        drop.push(i);
                    else {
                        data[o] = r - cast;
                        data[o + 2] = b - cast;
                    }
                }
            if (drop.length === 0)
                break; // frontier is clean — nothing left to erode
            for (const i of drop) {
                data[i * 4 + 3] = 0;
                cleared[i] = 1;
                clearedCount++;
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
export async function fitContain(input, w, h, kernel = 'nearest', trim = true) {
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
export async function fitInside(input, w, h, kernel = 'nearest', trim = true) {
    const sharp = await sharpMod();
    let buf = Buffer.from(input);
    if (trim) {
        // trim() on a fully-opaque image trims by corner colour — only safe post-cutout
        buf = await sharp(buf).trim({ threshold: 8 }).png().toBuffer().catch(() => Buffer.from(input));
    }
    return new Uint8Array(await sharp(buf)
        .resize(w, h, { kernel, fit: 'inside' })
        .png().toBuffer());
}
/** Resize filling the exact target (full-bleed sources prompted at the same aspect). */
export async function fitCover(input, w, h, kernel = 'nearest') {
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
export async function quantizePalette(input, paletteRgb) {
    if (paletteRgb.length === 0)
        return input;
    const sharp = await sharpMod();
    const { data, info } = await sharp(Buffer.from(input))
        .ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const cache = new Map();
    for (let o = 0; o < data.length; o += 4) {
        if (data[o + 3] < 8)
            continue;
        const key = (data[o] << 16) | (data[o + 1] << 8) | data[o + 2];
        let best = cache.get(key);
        if (best === undefined) {
            let bd = Infinity;
            best = 0;
            for (let i = 0; i < paletteRgb.length; i++) {
                const [r, g, b] = paletteRgb[i];
                const d = (data[o] - r) ** 2 + (data[o + 1] - g) ** 2 + (data[o + 2] - b) ** 2;
                if (d < bd) {
                    bd = d;
                    best = i;
                }
            }
            cache.set(key, best);
        }
        const [r, g, b] = paletteRgb[best];
        data[o] = r;
        data[o + 1] = g;
        data[o + 2] = b;
    }
    return new Uint8Array(await sharp(Buffer.from(data.buffer, data.byteOffset, data.byteLength), {
        raw: { width: info.width, height: info.height, channels: 4 },
    }).png().toBuffer());
}
export const hexToRgb = (hex) => {
    const n = parseInt(hex.replace('#', ''), 16);
    return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
};
/** Run one PostSpec over raw model bytes. */
export async function applyPost(input, post, storePx, o) {
    let bytes = input;
    let cutOk = false;
    if (post.cutout) {
        const cut = await keyCutout(bytes, o.keyRgb, o.tolerance);
        if (cut.clearedFrac === 0)
            o.onKeyMiss?.(cut.borderKeyFrac);
        else {
            bytes = cut.bytes;
            cutOk = true;
        }
    }
    if (!o.noDownscale && storePx && post.fit !== 'none') {
        if (post.fit === 'contain' || post.fit === 'inside') {
            // an un-cut opaque image must not be trimmed (trim keys off corner colour)
            const fit = post.fit === 'inside' ? fitInside : fitContain;
            if (!post.cutout || cutOk)
                bytes = await fit(bytes, storePx[0], storePx[1], post.kernel, post.trim);
        }
        else {
            bytes = await fitCover(bytes, storePx[0], storePx[1], post.kernel);
        }
    }
    if (post.quantize)
        bytes = await quantizePalette(bytes, o.paletteRgb);
    return bytes;
}

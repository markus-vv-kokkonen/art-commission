/**
 * Shared file/post plumbing for generate + repost.
 *
 * The spend-safety invariant lives here: EVERY generation writes the model's
 * untouched native-res original under rawRoot before post-processing writes
 * the shipped file — so post tweaks (key tolerance, target size, palette
 * lock) are re-runnable for free, forever, via `repost`.
 */
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { applyPost } from './post.js';
export async function writeBytes(path, bytes) {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, bytes);
}
export async function loadImageRef(path) {
    const data = (await readFile(path)).toString('base64');
    const mimeType = /\.jpe?g$/i.test(path) ? 'image/jpeg' : /\.webp$/i.test(path) ? 'image/webp' : 'image/png';
    return { mimeType, data };
}
/** Post-process raw model bytes for a target and write both raw + final. */
export async function processAndWrite(c, t, rawBytes, o = {}) {
    if (!o.skipRaw)
        await writeBytes(t.rawAbs, rawBytes);
    const paletteRgb = c.palette.map((hex) => {
        const n = parseInt(hex.slice(1), 16);
        return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
    });
    const finalBytes = await applyPost(rawBytes, t.post, t.storePx, {
        keyRgb: c.chromaKeyRgb,
        tolerance: c.chromaTolerance,
        paletteRgb,
        noDownscale: o.noDownscale,
        onKeyMiss: (frac) => o.onKeyMiss?.(t.id, frac),
    });
    await writeBytes(t.outAbs, finalBytes);
}
/** Probe --ref-dir for a composition reference: DIR/<group>/<id>.png, DIR/<id>.png. */
export function probeRefDir(refDir, group, id) {
    if (!refDir)
        return undefined;
    const candidates = group ? [`${refDir}/${group}/${id}.png`, `${refDir}/${id}.png`] : [`${refDir}/${id}.png`];
    return candidates.find((p) => existsSync(p));
}

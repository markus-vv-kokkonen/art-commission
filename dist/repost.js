/**
 * Repost — re-run post-processing from the kept raw originals. ZERO API cost.
 *
 * Key-tolerance tweaks, target-size changes, palette-lock fixes: none of them
 * should ever mean paying for regeneration. Every generation stored the
 * model's untouched output under rawRoot; this redoes the second half.
 */
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { processAndWrite } from './pipeline.js';
export async function runRepost(c, rows, flags = {}, log = console.log) {
    let reprocessed = 0, noRaw = 0;
    const onKeyMiss = (id, frac) => log(`  ⚠ ${id}: raw backdrop is not the chroma key (border match ${(frac * 100).toFixed(0)}%) — wrote as-is`);
    const one = async (t) => {
        if (!existsSync(t.rawAbs)) {
            noRaw++;
            return;
        }
        const raw = new Uint8Array(await readFile(t.rawAbs));
        await processAndWrite(c, t, raw, { skipRaw: true, noDownscale: flags.noDownscale, onKeyMiss });
        reprocessed++;
    };
    for (const row of rows) {
        await one(row);
        for (const d of row.derive)
            await one(d);
    }
    return { reprocessed, noRaw };
}

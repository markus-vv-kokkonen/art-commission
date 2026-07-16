/**
 * Mock provider — deterministic local placeholders, zero network, zero spend.
 *
 * Why it exists:
 *   - CI / tests can exercise the ENTIRE pipeline (prompt assembly, key
 *     cutout, fit, quantize, derivations, anchor chains, wiring) with no key.
 *   - A game can commission its whole catalogue as placeholders first, see
 *     every asset land in-engine at the right size, then re-run against a
 *     real provider with identical selection flags.
 *
 * Cutout-kind requests (req.chromaKey set) are painted on that exact backdrop
 * with a smaller subject shape inside — so keyCutout has real work to do.
 * The subject colour is a deterministic hash of the request id.
 */

import type { ProviderConfig } from '../types.js';
import type { GenRequest, Provider } from './types.js';

function hashHue(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0) % 360;
}

function hsl(h: number, s: number, l: number): string {
  return `hsl(${h}, ${s}%, ${l}%)`;
}

export function createMockProvider(cfg: ProviderConfig): Provider {
  async function generate(req: GenRequest): Promise<Uint8Array> {
    const sharp = (await import('sharp')).default;
    // native-ish output size: honour the requested shape at a model-like scale
    const w = Math.max(64, Math.min(1024, req.width ?? 512));
    const h = Math.max(64, Math.min(1024, req.height ?? 512));
    const hue = hashHue(req.id);
    const backdrop = req.chromaKey ?? hsl((hue + 180) % 360, 20, 12);
    // subject: an inset rounded block + a "highlight" bar, deterministic per id
    const iw = Math.round(w * 0.6), ih = Math.round(h * 0.6);
    const ix = Math.round((w - iw) / 2), iy = Math.round((h - ih) / 2);
    const svg = `<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">
      <rect width="${w}" height="${h}" fill="${backdrop}"/>
      <rect x="${ix}" y="${iy}" width="${iw}" height="${ih}" rx="${Math.round(Math.min(iw, ih) * 0.15)}" fill="${hsl(hue, 45, 40)}"/>
      <rect x="${ix + Math.round(iw * 0.15)}" y="${iy + Math.round(ih * 0.15)}" width="${Math.round(iw * 0.7)}" height="${Math.round(ih * 0.2)}" fill="${hsl(hue, 55, 60)}"/>
    </svg>`;
    return new Uint8Array(await sharp(Buffer.from(svg)).png().toBuffer());
  }

  return {
    name: 'mock',
    supportsBatch: false,
    supportsEdits: true, // refs accepted (and ignored) so edit flows are testable
    defaultModel: cfg.model ?? 'mock-1',
    generate,
    estimateUSD() { return 0; },
  };
}

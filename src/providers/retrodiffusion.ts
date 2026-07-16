/**
 * Retro Diffusion provider — pixel-art-native diffusion (api.retrodiffusion.ai).
 *
 * Synchronous POST /v1/inferences. The RD-specific knobs (prompt_style,
 * input_palette, strength, remove_bg…) ride in `providerOptions` / the
 * provider config's `options` and are passed through verbatim, so anything
 * the API accepts is reachable without this file changing.
 *
 * Env: RETRODIFFUSION_API_KEY (or RD_API_KEY).
 * Docs: https://github.com/Retro-Diffusion/api-examples
 */

import type { ProviderConfig } from '../types.js';
import { envKey, sleep, type GenRequest, type Provider } from './types.js';

const DEFAULT_BASE = 'https://api.retrodiffusion.ai/v1';
const DEFAULT_STYLE = 'rd_fast__game_asset';
/** RD generates on a coarse grid with hard size limits. */
const GRID = 8;
const MAX_PX = 512;
const MIN_PX = 64;

interface InferenceResult { base64_images: string[]; balance_cost: number; }

/** Local cost estimate (mirrors the API's published formulas). */
export function rdEstimate(style: string, w: number, h: number): number {
  const area = w * h;
  const lowRes = /mc_texture|mc_item|low_res|classic|topdown_item|skill_icon|single_tile|tile_variation|tile_object/;
  let c: number;
  if (style.startsWith('rd_pro')) c = 0.18;
  else if (lowRes.test(style)) c = Math.max(0.02, (area + 13700) / 600000);
  else if (style.startsWith('rd_plus')) c = Math.max(0.025, (area + 50000) / 2000000);
  else c = Math.max(0.015, (area + 100000) / 6000000); // rd_fast + default
  return Math.round(c * 1000) / 1000;
}

/** Fit a target shape onto RD's generation grid (multiples of 8, clamped). */
export function rdGenSize(w?: number, h?: number): [number, number] {
  if (!w || !h) return [256, 256];
  const scale = Math.min(1, MAX_PX / Math.max(w, h));
  const snap = (n: number) => Math.max(MIN_PX, Math.min(MAX_PX, Math.round((n * scale) / GRID) * GRID));
  return [snap(w), snap(h)];
}

export function createRetroDiffusionProvider(cfg: ProviderConfig): Provider {
  const BASE = cfg.baseUrl ?? DEFAULT_BASE;
  const key = () => envKey(cfg, ['RETRODIFFUSION_API_KEY', 'RD_API_KEY'], 'retrodiffusion.ai → API key');

  async function generate(req: GenRequest, tries = 4): Promise<Uint8Array> {
    const [w, h] = rdGenSize(req.width, req.height);
    const opts = { ...cfg.options, ...req.options } as Record<string, unknown>;
    const payload: Record<string, unknown> = {
      num_images: 1,
      prompt_style: DEFAULT_STYLE,
      ...opts,
      prompt: req.prompt,
      width: opts.width ?? w,
      height: opts.height ?? h,
      ...(req.seed !== undefined ? { seed: req.seed } : {}),
      // img2img: the first reference image anchors composition + palette
      ...(req.refImages?.length
        ? { input_image: req.refImages[0].data, strength: opts.strength ?? 0.5 }
        : {}),
    };

    let last: unknown;
    for (let i = 0; i < tries; i++) {
      let res: Response;
      try {
        res = await fetch(`${BASE}/inferences`, {
          method: 'POST',
          headers: { 'X-RD-Token': key(), 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
      } catch (e) { last = e; await sleep(800 * (i + 1)); continue; }
      if (res.ok) {
        const data = (await res.json()) as InferenceResult;
        const b64 = data.base64_images?.[0];
        if (!b64) throw new Error('retrodiffusion: no image in response');
        return new Uint8Array(Buffer.from(b64, 'base64'));
      }
      const text = await res.text().catch(() => '');
      if (res.status >= 500) { last = new Error(`retrodiffusion ${res.status}: ${text}`); await sleep(1000 * (i + 1)); continue; }
      throw new Error(`retrodiffusion ${res.status}: ${text}`); // 4xx — bad input / auth / balance
    }
    throw last instanceof Error ? last : new Error(String(last));
  }

  return {
    name: 'retrodiffusion',
    supportsBatch: false,
    supportsEdits: true,
    defaultModel: cfg.model ?? DEFAULT_STYLE, // RD's "model" is its prompt_style
    generate,
    estimateUSD(model) {
      if (cfg.costPerImage?.sync !== undefined) return cfg.costPerImage.sync;
      return rdEstimate(model, 256, 256);
    },
  };
}

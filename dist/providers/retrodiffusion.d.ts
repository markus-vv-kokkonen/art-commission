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
import { type Provider } from './types.js';
/** Local cost estimate (mirrors the API's published formulas). */
export declare function rdEstimate(style: string, w: number, h: number): number;
/** Fit a target shape onto RD's generation grid (multiples of 8, clamped). */
export declare function rdGenSize(w?: number, h?: number): [number, number];
export declare function createRetroDiffusionProvider(cfg: ProviderConfig): Provider;

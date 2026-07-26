/**
 * The provider plugin interface — one small surface every image backend
 * implements. Everything above it (selection, prompts, post, wiring) is
 * provider-agnostic; everything below it (auth, request shape, polling,
 * batch protocol) is the provider's own business.
 */
import type { ProviderConfig } from '../types.js';
/** A base64 image attachment (no data: prefix). */
export interface ImageRef {
    mimeType: string;
    data: string;
}
/** One generation request. Negatives ride inside `prompt` — that works on
 *  every backend; providers with a separate negative field may split it out
 *  themselves if they wish. */
export interface GenRequest {
    /** Correlation key (the asset id). */
    id: string;
    prompt: string;
    /** Desired stored size, when known. Providers that take explicit px use it
     *  (rounded/clamped to their grid); prompt-only providers ignore it. */
    width?: number;
    height?: number;
    /** Aspect hint "W:H". Providers snap to their supported set. */
    aspect?: string;
    /** Reference images: composition anchors (img2img) and/or style anchors. */
    refImages?: ImageRef[];
    seed?: number;
    /** Resolved model id (row override → CLI → provider config → default). */
    model: string;
    /** Provider-specific size hint (e.g. Gemini imageSize "1K"/"2K"). */
    imageSize?: string;
    /** The commission's chroma key, when this request expects a keyed backdrop
     *  (providers may use it — the mock paints it; real models get it via the
     *  prompt clause). */
    chromaKey?: string;
    /** Merged provider options: provider config `options` + asset `providerOptions`. */
    options?: Record<string, unknown>;
}
export interface BatchHooks {
    pollMs?: number;
    onName?: (name: string) => void;
    onPoll?: (p: {
        name: string;
        state: string;
        polls: number;
    }) => void;
}
export interface ModelInfo {
    name: string;
    description?: string;
}
export interface Provider {
    readonly name: string;
    /** Has a discounted async batch path (generateBatch). */
    readonly supportsBatch: boolean;
    /** Accepts reference images (img2img edits, style anchors, derivations). */
    readonly supportsEdits: boolean;
    readonly defaultModel: string;
    /** Generate one image; resolves to raw image bytes (usually PNG). */
    generate(req: GenRequest): Promise<Uint8Array>;
    /** Run many requests as one discounted job; returns id → bytes for every
     *  request that produced an image (missing ids = that request failed). */
    generateBatch?(reqs: GenRequest[], hooks?: BatchHooks): Promise<Map<string, Uint8Array>>;
    /** Ask the live API which models this key can call. */
    listModels?(): Promise<ModelInfo[]>;
    /** Rough per-image USD for spend previews; null = unknown. */
    estimateUSD(model: string, batch: boolean): number | null;
}
export type ProviderFactory = (cfg: ProviderConfig) => Provider;
export declare const sleep: (ms: number) => Promise<void>;
/** Resolve an API key from the configured env var(s); throws with a set-up hint. */
export declare function envKey(cfg: ProviderConfig, fallbacks: string[], what: string): string;
/** Snap a target shape to the nearest of a provider's supported aspect strings. */
export declare function snapAspect(w: number, h: number, supported: Array<[string, number]>): string;

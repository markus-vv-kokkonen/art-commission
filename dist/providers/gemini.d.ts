/**
 * Google Gemini image provider ("nano banana") — the primary backend.
 *
 * REST against generativelanguage.googleapis.com; the synchronous path returns
 * the image inline as base64, and the Batch API path runs the SAME models at
 * ~half the per-image price (async, <24h SLA, usually minutes). One request
 * body builder is shared by both so a batch line is byte-for-byte the sync
 * request — look and framing can never drift between the two.
 *
 * Model ids drift between API revisions — `listModels` asks the live API what
 * YOUR key can call; trust that over any list in docs. A 404 on generate means
 * the id is wrong for your key/tier, not that the tool is broken.
 *
 * Env: GEMINI_API_KEY (or GOOGLE_API_KEY); override via providers.gemini.apiKeyEnv.
 */
import type { ProviderConfig } from '../types.js';
import { type ImageRef, type Provider } from './types.js';
export declare const GEMINI_DEFAULT_MODEL = "gemini-3.1-flash-image";
/** The GenerateContentRequest body shared by the sync path AND each batch line. */
export declare function buildGenerateBody(o: {
    prompt: string;
    refImages?: ImageRef[];
    aspectRatio?: string;
    imageSize?: string;
}): Record<string, unknown>;
export declare function createGeminiProvider(cfg: ProviderConfig): Provider;

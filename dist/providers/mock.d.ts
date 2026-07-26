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
import type { Provider } from './types.js';
export declare function createMockProvider(cfg: ProviderConfig): Provider;

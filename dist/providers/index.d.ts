/**
 * Provider registry. Adding a backend = one factory + one entry here
 * (plus its name in config.ts KNOWN_PROVIDERS so validation accepts it).
 */
import type { ProviderConfig } from '../types.js';
import type { Provider } from './types.js';
export declare function createProvider(name: string, cfg?: ProviderConfig): Provider;
export declare const providerNames: () => string[];
export * from './types.js';

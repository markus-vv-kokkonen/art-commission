/**
 * Provider registry. Adding a backend = one factory + one entry here
 * (plus its name in config.ts KNOWN_PROVIDERS so validation accepts it).
 */
import { createGeminiProvider } from './gemini.js';
import { createRetroDiffusionProvider } from './retrodiffusion.js';
import { createScenarioProvider } from './scenario.js';
import { createMockProvider } from './mock.js';
const FACTORIES = {
    gemini: createGeminiProvider,
    retrodiffusion: createRetroDiffusionProvider,
    scenario: createScenarioProvider,
    mock: createMockProvider,
};
export function createProvider(name, cfg = {}) {
    const factory = FACTORIES[name];
    if (!factory) {
        throw new Error(`unknown provider "${name}" (available: ${Object.keys(FACTORIES).join(', ')})`);
    }
    return factory(cfg);
}
export const providerNames = () => Object.keys(FACTORIES);
export * from './types.js';

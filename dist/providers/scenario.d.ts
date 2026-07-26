/**
 * Scenario provider (app.scenario.com) — async txt2img job + poll + download.
 *
 * The draw of Scenario is TRAINING a model on your own art bible, then
 * generating on that modelId — the look comes from the model, not from
 * prompt discipline or post-processing. Configure the trained model via
 * providers.scenario.model (or SCENARIO_MODEL_ID).
 *
 * Env: SCENARIO_API_KEY + SCENARIO_API_SECRET (Basic auth).
 * Docs: https://docs.scenario.com/docs/text-to-image
 */
import type { ProviderConfig } from '../types.js';
import { type Provider } from './types.js';
export declare function createScenarioProvider(cfg: ProviderConfig): Provider;

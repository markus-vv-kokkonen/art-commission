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
import { sleep, type GenRequest, type Provider } from './types.js';

const DEFAULT_BASE = 'https://api.cloud.scenario.com/v1';

/* eslint-disable @typescript-eslint/no-explicit-any */
export function createScenarioProvider(cfg: ProviderConfig): Provider {
  const BASE = cfg.baseUrl ?? process.env.SCENARIO_API_BASE ?? DEFAULT_BASE;

  function headers(): Record<string, string> {
    const k = process.env.SCENARIO_API_KEY;
    const s = process.env.SCENARIO_API_SECRET;
    if (!k || !s) throw new Error('Set SCENARIO_API_KEY and SCENARIO_API_SECRET in your environment / .env');
    return {
      'Content-Type': 'application/json',
      Authorization: `Basic ${Buffer.from(`${k}:${s}`).toString('base64')}`,
    };
  }

  const snap = (n: number | undefined, fallback: number): number => {
    const v = n ?? fallback;
    return Math.max(128, Math.min(1024, Math.round(v / 8) * 8));
  };

  async function generate(req: GenRequest): Promise<Uint8Array> {
    const opts = { ...cfg.options, ...req.options } as Record<string, unknown>;
    const body = {
      numSamples: 1,
      ...opts,
      prompt: req.prompt,
      modelId: req.model,
      width: snap(req.width, 512),
      height: snap(req.height, 512),
      ...(req.seed !== undefined ? { seed: req.seed } : {}),
    };
    const res = await fetch(`${BASE}/generate/txt2img`, { method: 'POST', headers: headers(), body: JSON.stringify(body) });
    if (!res.ok) throw new Error(`scenario txt2img ${res.status}: ${await res.text().catch(() => '')}`);
    const jobId = ((await res.json()) as any)?.job?.jobId;
    if (!jobId) throw new Error('scenario: no jobId in response');

    // poll
    const t0 = Date.now();
    let assetIds: string[] = [];
    for (;;) {
      const jr = await fetch(`${BASE}/jobs/${jobId}`, { headers: headers() });
      if (!jr.ok) throw new Error(`scenario job ${jr.status}: ${await jr.text().catch(() => '')}`);
      const job = ((await jr.json()) as any)?.job;
      if (job?.status === 'success') { assetIds = job?.metadata?.assetIds ?? []; break; }
      if (job?.status === 'failure' || job?.status === 'canceled') throw new Error(`scenario job ${job.status}`);
      if (Date.now() - t0 > 240000) throw new Error(`scenario job timeout (id ${jobId})`);
      await sleep(3000);
    }
    if (!assetIds.length) throw new Error('scenario: job succeeded but returned no assets');

    // download
    const ar = await fetch(`${BASE}/assets/${assetIds[0]}`, { headers: headers() });
    if (!ar.ok) throw new Error(`scenario asset ${ar.status}: ${await ar.text().catch(() => '')}`);
    const data: any = await ar.json();
    const url = data?.asset?.url || data?.url || data?.asset?.downloadUrl || data?.asset?.image;
    if (!url) throw new Error('scenario: no asset URL on record — ' + JSON.stringify(data).slice(0, 200));
    const img = await fetch(url);
    if (!img.ok) throw new Error(`scenario asset download ${img.status}`);
    return new Uint8Array(await img.arrayBuffer());
  }

  return {
    name: 'scenario',
    supportsBatch: false,
    supportsEdits: false, // img2img needs a pre-uploaded asset id — not wired here
    defaultModel: cfg.model ?? process.env.SCENARIO_MODEL_ID ?? '',
    generate,
    estimateUSD() { return cfg.costPerImage?.sync ?? null; },
  };
}

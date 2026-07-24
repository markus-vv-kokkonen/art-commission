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
import {
  envKey, sleep, snapAspect,
  type BatchHooks, type GenRequest, type ImageRef, type ModelInfo, type Provider,
} from './types.js';

const DEFAULT_BASE = 'https://generativelanguage.googleapis.com/v1beta';
export const GEMINI_DEFAULT_MODEL = 'gemini-3.1-flash-image';

/** Aspect ratios the Gemini image models accept. */
const API_ASPECTS: Array<[string, number]> = [
  ['1:1', 1], ['2:3', 2 / 3], ['3:2', 3 / 2], ['3:4', 3 / 4], ['4:3', 4 / 3],
  ['4:5', 4 / 5], ['5:4', 5 / 4], ['9:16', 9 / 16], ['16:9', 16 / 9], ['21:9', 21 / 9],
];

/** The GenerateContentRequest body shared by the sync path AND each batch line. */
export function buildGenerateBody(o: {
  prompt: string; refImages?: ImageRef[]; aspectRatio?: string; imageSize?: string;
}): Record<string, unknown> {
  const parts: unknown[] = [{ text: o.prompt }];
  for (const r of o.refImages ?? []) parts.push({ inlineData: { mimeType: r.mimeType, data: r.data } });
  const imageConfig: Record<string, string> = {};
  if (o.aspectRatio) imageConfig.aspectRatio = o.aspectRatio;
  if (o.imageSize) imageConfig.imageSize = o.imageSize;
  return {
    contents: [{ role: 'user', parts }],
    generationConfig: {
      // MUST include both — image-only modality is rejected by these models.
      responseModalities: ['TEXT', 'IMAGE'],
      ...(Object.keys(imageConfig).length ? { imageConfig } : {}),
    },
  };
}

/* eslint-disable @typescript-eslint/no-explicit-any */
/** Pull the first inline image out of a response candidate (sync or batch). */
function extractImage(cand: any): Uint8Array | null {
  const outParts = cand?.content?.parts ?? [];
  const img = outParts.find((p: any) => p?.inlineData?.data);
  return img ? new Uint8Array(Buffer.from(img.inlineData.data, 'base64')) : null;
}

export function createGeminiProvider(cfg: ProviderConfig): Provider {
  const BASE = cfg.baseUrl ?? process.env.GEMINI_API_BASE ?? DEFAULT_BASE;
  const ORIGIN = BASE.replace(/\/v1beta\/?$/, '');
  const key = () => envKey(cfg, ['GEMINI_API_KEY', 'GOOGLE_API_KEY'], 'Google AI Studio → Get API key');
  const auth = (extra: Record<string, string> = {}) => ({ 'x-goog-api-key': key(), ...extra });

  const bodyFor = (req: GenRequest) => buildGenerateBody({
    prompt: req.prompt,
    refImages: req.refImages,
    aspectRatio: req.aspect ?? (req.width && req.height ? snapAspect(req.width, req.height, API_ASPECTS) : undefined),
    imageSize: req.imageSize ?? cfg.imageSize,
  });

  async function generate(req: GenRequest, tries = 3): Promise<Uint8Array> {
    const body = bodyFor(req);
    let last: unknown;
    for (let i = 0; i < tries; i++) {
      let res: Response;
      try {
        res = await fetch(`${BASE}/models/${req.model}:generateContent`, {
          method: 'POST',
          headers: auth({ 'Content-Type': 'application/json' }),
          body: JSON.stringify(body),
        });
      } catch (e) { last = e; await sleep(800 * (i + 1)); continue; }

      if (res.ok) {
        const data: any = await res.json();
        const cand = data?.candidates?.[0];
        const img = extractImage(cand);
        if (img) return img;
        const reason = cand?.finishReason || data?.promptFeedback?.blockReason || 'no image part';
        throw new Error(`gemini: no image (${reason}) — ${JSON.stringify(data).slice(0, 180)}`);
      }
      const text = await res.text().catch(() => '');
      if (res.status === 429 || res.status >= 500) { last = new Error(`gemini ${res.status}: ${text}`); await sleep(1500 * (i + 1)); continue; }
      throw new Error(`gemini ${res.status}: ${text}`); // 400/401/403 — don't retry
    }
    throw last instanceof Error ? last : new Error(String(last));
  }

  // ------------------------------------------------------- Batch API (~50% off)

  async function ok(res: Response, what: string): Promise<any> {
    if (!res.ok) throw new Error(`gemini batch ${what} ${res.status}: ${(await res.text().catch(() => '')).slice(0, 300)}`);
    const t = await res.text();
    return t ? JSON.parse(t) : {};
  }

  async function uploadJsonl(jsonl: string, displayName: string): Promise<string> {
    const bytes = new TextEncoder().encode(jsonl);
    const start = await fetch(`${ORIGIN}/upload/v1beta/files`, {
      method: 'POST',
      headers: auth({
        'X-Goog-Upload-Protocol': 'resumable',
        'X-Goog-Upload-Command': 'start',
        'X-Goog-Upload-Header-Content-Length': String(bytes.length),
        'X-Goog-Upload-Header-Content-Type': 'application/jsonl',
        'Content-Type': 'application/json',
      }),
      body: JSON.stringify({ file: { display_name: displayName } }),
    });
    const uploadUrl = start.headers.get('x-goog-upload-url');
    if (!start.ok || !uploadUrl) throw new Error(`gemini batch upload-start ${start.status}: ${(await start.text().catch(() => '')).slice(0, 200)}`);
    const fin = await fetch(uploadUrl, {
      method: 'POST',
      headers: auth({ 'X-Goog-Upload-Command': 'upload, finalize', 'X-Goog-Upload-Offset': '0', 'Content-Length': String(bytes.length) }),
      body: bytes,
    });
    const data = await ok(fin, 'upload');
    const name = data?.file?.name ?? data?.name;
    if (!name) throw new Error('gemini batch upload: no file name in response');
    return name;
  }

  async function createBatch(model: string, fileName: string, displayName: string): Promise<string> {
    const res = await fetch(`${BASE}/models/${model}:batchGenerateContent`, {
      method: 'POST',
      headers: auth({ 'Content-Type': 'application/json' }),
      // input_config.file_name is the relative `files/<id>` resource name (id ≤ 40 chars);
      // a fully-qualified URL is rejected with INVALID_ARGUMENT (file id too long).
      body: JSON.stringify({ batch: { display_name: displayName, input_config: { file_name: fileName } } }),
    });
    // A bare FAILED_PRECONDITION here — no field, no violation list — means the key's project
    // isn't entitled to the Batch API (it needs billing/paid tier). The request itself is fine,
    // so say what's actually wrong instead of echoing an opaque error.
    if (res.status === 400) {
      const body = await res.text().catch(() => '');
      if (body.includes('FAILED_PRECONDITION')) {
        throw new Error(
          'gemini batch create 400 FAILED_PRECONDITION — the Batch API requires a billing-enabled ' +
            "(paid-tier) project. Enable billing for this API key's project, or re-run with --sync " +
            `(per-request, ~2x price). Raw: ${body.slice(0, 200)}`,
        );
      }
      throw new Error(`gemini batch create 400: ${body.slice(0, 300)}`);
    }
    const data = await ok(res, 'create');
    const name = data?.name ?? data?.metadata?.batch?.name;
    if (!name) throw new Error(`gemini batch create: no job name — ${JSON.stringify(data).slice(0, 200)}`);
    return name;
  }

  /** Normalise the many state spellings across API revisions. */
  function batchState(job: any): 'pending' | 'succeeded' | 'failed' {
    const s = String(job?.metadata?.state ?? job?.state?.name ?? job?.state ?? (job?.done ? 'DONE' : '')).toUpperCase();
    if (/SUCCEED|SUCCESS|DONE/.test(s) && !job?.error) return 'succeeded';
    if (/FAIL|CANCEL|EXPIRE|ERROR/.test(s) || job?.error) return 'failed';
    return 'pending';
  }

  async function collectResults(job: any): Promise<Map<string, Uint8Array>> {
    const out = new Map<string, Uint8Array>();
    const take = (k: string | undefined, cand: any) => {
      const img = extractImage(cand);
      if (k && img) out.set(k, img);
    };
    // (a) result file — the usual path for large batches; its name has moved around.
    const dest = job?.dest ?? job?.response ?? job?.metadata?.output ?? {};
    const fileName =
      dest?.file_name ?? dest?.fileName ?? dest?.responsesFile ?? dest?.responses_file ??
      job?.response?.responsesFile ?? job?.output?.responsesFile;
    if (fileName) {
      const res = await fetch(`${ORIGIN}/download/v1beta/${fileName}:download?alt=media`, { headers: auth() });
      if (!res.ok) throw new Error(`gemini batch download ${res.status}`);
      for (const rawLine of (await res.text()).split('\n')) {
        const line = rawLine.trim();
        if (!line) continue;
        const obj = JSON.parse(line);
        take(obj?.key ?? obj?.metadata?.key, obj?.response?.candidates?.[0] ?? obj?.candidates?.[0]);
      }
      return out;
    }
    // (b) inlined responses — small batches.
    const inlined = dest?.inlined_responses ?? dest?.inlinedResponses ?? job?.response?.inlinedResponses ?? [];
    for (const r of inlined) take(r?.key ?? r?.metadata?.key, (r?.response ?? r)?.candidates?.[0]);
    return out;
  }

  async function generateBatch(reqs: GenRequest[], hooks?: BatchHooks): Promise<Map<string, Uint8Array>> {
    if (reqs.length === 0) return new Map();
    // one job per model — group, run sequentially, merge
    const byModel = new Map<string, GenRequest[]>();
    for (const r of reqs) {
      const list = byModel.get(r.model) ?? [];
      list.push(r);
      byModel.set(r.model, list);
    }
    const all = new Map<string, Uint8Array>();
    for (const [model, group] of byModel) {
      const jsonl = group.map((r) => JSON.stringify({ key: r.id, request: bodyFor(r) })).join('\n') + '\n';
      const displayName = `art-commission-${model}-${group.length}`;
      const fileName = await uploadJsonl(jsonl, displayName);
      const name = await createBatch(model, fileName, displayName);
      hooks?.onName?.(name);
      const pollMs = hooks?.pollMs ?? 15000;
      for (let polls = 1; ; polls++) {
        const job = await ok(await fetch(`${BASE}/${name}`, { headers: auth() }), 'get');
        const state = batchState(job);
        hooks?.onPoll?.({ name, state, polls });
        if (state === 'succeeded') {
          for (const [k, v] of await collectResults(job)) all.set(k, v);
          break;
        }
        if (state === 'failed') throw new Error(`gemini batch failed: ${JSON.stringify(job?.error ?? job?.metadata?.state ?? job).slice(0, 300)}`);
        await sleep(pollMs);
      }
    }
    return all;
  }

  async function listModels(): Promise<ModelInfo[]> {
    const out: ModelInfo[] = [];
    let page: string | undefined;
    do {
      const url = `${BASE}/models?pageSize=200${page ? `&pageToken=${page}` : ''}`;
      const res = await fetch(url, { headers: auth() });
      if (!res.ok) throw new Error(`gemini models ${res.status}: ${await res.text().catch(() => '')}`);
      const data: any = await res.json();
      for (const m of data?.models ?? []) {
        const name: string = m?.name ?? '';
        const methods: string[] = m?.supportedGenerationMethods ?? [];
        if (/image/i.test(name) && methods.includes('generateContent')) {
          out.push({ name, description: m?.description });
        }
      }
      page = data?.nextPageToken;
    } while (page);
    return out.sort((a, b) => a.name.localeCompare(b.name));
  }

  return {
    name: 'gemini',
    supportsBatch: true,
    supportsEdits: true,
    defaultModel: cfg.model ?? process.env.GEMINI_MODEL ?? GEMINI_DEFAULT_MODEL,
    generate,
    generateBatch,
    listModels,
    estimateUSD(model, batch) {
      const sync = cfg.costPerImage?.sync ?? (/pro/.test(model) ? 0.25 : 0.067);
      const batched = cfg.costPerImage?.batch ?? sync / 2;
      return batch ? batched : sync;
    },
  };
}

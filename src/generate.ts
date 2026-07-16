/**
 * The generation runner — provider-agnostic orchestration of a selected set
 * of assets, honouring the spend-safe rules the format encodes:
 *
 *   - files already on disk are SKIPPED unless --force (resumable by default;
 *     a missing derivation is still filled in from the existing base)
 *   - style anchors generate FIRST, then members with the anchor's output
 *     attached as a style reference (two batch jobs on batch providers)
 *   - derivations are EDITS of the fresh base image, run synchronously after
 *     the base lands (they need the base as their reference)
 *   - every raw original is kept for zero-cost `repost`
 */

import { existsSync } from 'node:fs';
import type { ResolvedAsset, ResolvedCommission } from './types.js';
import type { GenRequest, ImageRef, Provider } from './providers/types.js';
import { createProvider } from './providers/index.js';
import { loadImageRef, probeRefDir, processAndWrite } from './pipeline.js';

export interface GenerateFlags {
  provider?: string;
  model?: string;
  /** Per-request mode at full price; default is the provider's batch path when it has one. */
  sync?: boolean;
  force?: boolean;
  concurrency?: number;
  pollSecs?: number;
  refDir?: string;
  noDerive?: boolean;
  noDownscale?: boolean;
  /** Provider size hint override (e.g. Gemini imageSize). */
  size?: string;
  /** Force one aspect for every request. */
  aspect?: string;
}

export interface Outcome {
  id: string;
  ok: boolean;
  skipped?: boolean;
  refUsed?: boolean;
  anchored?: boolean;
  derived?: number;
  error?: string;
}

export interface GenerateSummary {
  outcomes: Outcome[];
  generated: number;
  skipped: number;
  failed: Outcome[];
}

type Log = (line: string) => void;

/** Which provider a row rides on. */
export const effectiveProvider = (row: ResolvedAsset, c: ResolvedCommission, flags: GenerateFlags): string =>
  row.provider ?? flags.provider ?? c.defaultProvider;

const needsBase = (row: ResolvedAsset, force: boolean): boolean => force || !existsSync(row.outAbs);
const needsDerive = (row: ResolvedAsset, force: boolean, noDerive: boolean): boolean =>
  !noDerive && row.derive.some((d) => force || !existsSync(d.outAbs));

/** Count of images a run would actually pay for (bases + derivations). */
export function countTodo(rows: ResolvedAsset[], flags: GenerateFlags): { bases: number; derives: number } {
  let bases = 0, derives = 0;
  for (const r of rows) {
    if (needsBase(r, !!flags.force)) bases++;
    if (!flags.noDerive) for (const d of r.derive) if (flags.force || !existsSync(d.outAbs)) derives++;
  }
  return { bases, derives };
}

interface BuiltRequest { req: GenRequest; refUsed: boolean; anchored: boolean; }

async function buildRequest(
  row: ResolvedAsset, c: ResolvedCommission, flags: GenerateFlags, provider: Provider,
  log: Log, warnedNoEdits: { v: boolean },
): Promise<BuiltRequest> {
  let prompt = row.prompt;
  const refs: ImageRef[] = [];
  let refUsed = false, anchored = false;

  const refPath = row.refAbs && existsSync(row.refAbs) ? row.refAbs : probeRefDir(flags.refDir, row.group, row.id);
  if (refPath) { refs.push(await loadImageRef(refPath)); prompt += c.style.refSuffix; refUsed = true; }

  if (row.styleAnchor) {
    const anchor = c.assets.find((a) => a.id === row.styleAnchor);
    if (anchor && existsSync(anchor.outAbs)) {
      refs.push(await loadImageRef(anchor.outAbs));
      prompt += c.style.anchorSuffix;
      anchored = true;
    }
  }

  if (refs.length && !provider.supportsEdits) {
    if (!warnedNoEdits.v) { log(`  ⚠ provider "${provider.name}" does not accept reference images — refs dropped`); warnedNoEdits.v = true; }
    refs.length = 0;
  }

  const px = row.storePx ?? row.px;
  return {
    refUsed, anchored,
    req: {
      id: row.id,
      prompt: prompt.replace(/\s+/g, ' ').trim(),
      width: px?.[0], height: px?.[1],
      aspect: flags.aspect ?? row.aspect,
      refImages: refs.length ? refs : undefined,
      seed: row.seed,
      model: row.model ?? flags.model ?? provider.defaultModel,
      imageSize: flags.size,
      chromaKey: row.post.cutout ? c.chromaKey : undefined,
      options: row.providerOptions,
    },
  };
}

/** Derivations: edit the fresh base image into each companion. */
async function runDerives(
  row: ResolvedAsset, c: ResolvedCommission, flags: GenerateFlags, provider: Provider, log: Log,
): Promise<number> {
  if (flags.noDerive || row.derive.length === 0) return 0;
  if (!existsSync(row.outAbs)) return 0; // no base to edit from
  if (!provider.supportsEdits) {
    log(`  ⚠ ${row.id}: derivations need reference-image support; "${provider.name}" has none — skipped`);
    return 0;
  }
  let done = 0;
  for (const d of row.derive) {
    if (!flags.force && existsSync(d.outAbs)) continue;
    const base = await loadImageRef(row.outAbs);
    const px = d.storePx ?? d.px;
    const bytes = await provider.generate({
      id: d.id,
      prompt: d.prompt,
      refImages: [base],
      width: px?.[0], height: px?.[1],
      aspect: flags.aspect ?? row.aspect,
      seed: row.seed,
      model: row.model ?? flags.model ?? provider.defaultModel,
      imageSize: flags.size,
      chromaKey: d.post.cutout ? c.chromaKey : undefined,
      options: row.providerOptions,
    });
    await processAndWrite(c, d, bytes, {
      noDownscale: flags.noDownscale,
      onKeyMiss: (id, frac) => log(`  ⚠ ${id}: backdrop is not the chroma key (border match ${(frac * 100).toFixed(0)}%) — wrote as-is`),
    });
    done++;
  }
  return done;
}

/**
 * Split the to-generate set into anchor phase and member phase. Anchors that
 * are merely REFERENCED (not selected) but missing on disk are pulled in from
 * the full catalogue — a member must never generate off-style silently.
 */
export function splitPhases(rows: ResolvedAsset[], c: ResolvedCommission, force: boolean): {
  anchors: ResolvedAsset[]; members: ResolvedAsset[];
} {
  const todo = rows.filter((r) => needsBase(r, force) || needsDerive(r, force, false));
  const referenced = new Set<string>();
  for (const r of todo) if (r.styleAnchor && needsBase(r, force)) referenced.add(r.styleAnchor);

  const inRun = new Set(todo.map((r) => r.id));
  const anchors: ResolvedAsset[] = [];
  for (const id of referenced) {
    const anchor = c.assets.find((a) => a.id === id);
    if (!anchor) continue;
    if (inRun.has(id) || !existsSync(anchor.outAbs)) anchors.push(anchor);
  }
  const anchorIds = new Set(anchors.map((a) => a.id));
  const members = todo.filter((r) => !anchorIds.has(r.id));
  return { anchors, members };
}

const AUTH_RE = /40[013]\b|api key|permission|unauthor/i;
const NOT_FOUND_RE = /\b404\b|not found/i;

/** Run generation for one provider group of rows. */
async function runProviderGroup(
  providerName: string, rows: ResolvedAsset[],
  c: ResolvedCommission, flags: GenerateFlags, log: Log,
): Promise<Outcome[]> {
  const provider = createProvider(providerName, c.providers[providerName] ?? {});
  const outcomes: Outcome[] = [];
  const warnedNoEdits = { v: false };
  const keyMiss = (id: string, frac: number) =>
    log(`  ⚠ ${id}: backdrop is not the chroma key (border match ${(frac * 100).toFixed(0)}%) — wrote as-is; regenerate with --force`);

  const { anchors, members } = splitPhases(rows, c, !!flags.force);
  const skippedRows = rows.filter((r) => !anchors.includes(r) && !members.includes(r));
  for (const r of skippedRows) outcomes.push({ id: r.id, ok: true, skipped: true });

  const useBatch = !flags.sync && provider.supportsBatch && !!provider.generateBatch;

  async function generateOne(row: ResolvedAsset): Promise<Outcome> {
    // base done — but a missing derivation can still be filled in
    if (!flags.force && existsSync(row.outAbs)) {
      try {
        const derived = await runDerives(row, c, flags, provider, log);
        return { id: row.id, ok: true, skipped: derived === 0, derived };
      } catch (e) {
        return { id: row.id, ok: false, error: `derive: ${e instanceof Error ? e.message : String(e)}` };
      }
    }
    try {
      const { req, refUsed, anchored } = await buildRequest(row, c, flags, provider, log, warnedNoEdits);
      if (row.styleAnchor && !anchored) {
        return { id: row.id, ok: false, error: `style anchor "${row.styleAnchor}" has no output on disk — skipping rather than generating off-style` };
      }
      const bytes = await provider.generate(req);
      await processAndWrite(c, row, bytes, { noDownscale: flags.noDownscale, onKeyMiss: keyMiss });
      const derived = await runDerives(row, c, flags, provider, log);
      return { id: row.id, ok: true, refUsed, anchored, derived };
    } catch (e) {
      return { id: row.id, ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }

  async function runSyncPhase(phase: ResolvedAsset[]): Promise<boolean> {
    let cursor = 0, done = 0, abort = false;
    const n = Math.max(1, flags.concurrency ?? 2);
    async function worker() {
      while (cursor < phase.length && !abort) {
        const row = phase[cursor++];
        const o = await generateOne(row);
        outcomes.push(o); done++;
        const tag = o.skipped ? 'skip' : o.ok ? (o.anchored ? 'ok+anchor' : o.refUsed ? 'ok+ref' : 'ok') + (o.derived ? `+${o.derived}drv` : '') : 'FAIL';
        log(`  [${String(done).padStart(3)}/${phase.length}] ${tag.padEnd(12)} ${row.id}${o.error ? '  — ' + o.error : ''}`);
        if (!o.ok && AUTH_RE.test(o.error ?? '')) { log('\n✗ aborting: auth error — check the provider API key.'); abort = true; }
        if (!o.ok && NOT_FOUND_RE.test(o.error ?? '')) { log(`\n✗ model not found — run the "models" command to see what your key can use.`); abort = true; }
      }
    }
    await Promise.all(Array.from({ length: n }, worker));
    return !abort;
  }

  async function runBatchPhase(phase: ResolvedAsset[], label: string): Promise<void> {
    const todo = phase.filter((r) => needsBase(r, !!flags.force));
    const holdovers = phase.filter((r) => !todo.includes(r)); // derive-only rows
    if (todo.length) {
      const byId = new Map<string, ResolvedAsset>();
      const built = new Map<string, BuiltRequest>();
      const lines: GenRequest[] = [];
      for (const row of todo) {
        const b = await buildRequest(row, c, flags, provider, log, warnedNoEdits);
        if (row.styleAnchor && !b.anchored) {
          outcomes.push({ id: row.id, ok: false, error: `style anchor "${row.styleAnchor}" has no output on disk` });
          continue;
        }
        lines.push(b.req); byId.set(row.id, row); built.set(row.id, b);
      }
      if (lines.length) {
        log(`  batch ${label} — ${lines.length} request(s)…`);
        const results = await provider.generateBatch!(lines, {
          pollMs: Math.max(5, flags.pollSecs ?? 15) * 1000,
          onName: (name) => log(`  job: ${name}  (resumable — runs server-side even if you stop)`),
          onPoll: ({ state, polls }) => { if (polls === 1 || polls % 4 === 0) log(`  [poll ${polls}] ${state}…`); },
        });
        for (const row of byId.values()) {
          const bytes = results.get(row.id);
          if (!bytes) { outcomes.push({ id: row.id, ok: false, error: 'batch returned no image' }); continue; }
          await processAndWrite(c, row, bytes, { noDownscale: flags.noDownscale, onKeyMiss: keyMiss });
          const b = built.get(row.id)!;
          outcomes.push({ id: row.id, ok: true, refUsed: b.refUsed, anchored: b.anchored });
          log(`  ✓ ${row.id}`);
        }
      }
    }
    // derivations (and derive-only holdovers) run synchronously — they edit fresh bases
    for (const row of phase) {
      if (flags.noDerive || row.derive.length === 0) continue;
      try {
        const derived = await runDerives(row, c, flags, provider, log);
        if (derived) {
          const prev = outcomes.find((o) => o.id === row.id);
          if (prev) prev.derived = (prev.derived ?? 0) + derived;
          else outcomes.push({ id: row.id, ok: true, skipped: !todo.includes(row), derived });
          log(`  ✓ ${row.id} +${derived} derivation(s)`);
        } else if (holdovers.includes(row) && !outcomes.some((o) => o.id === row.id)) {
          outcomes.push({ id: row.id, ok: true, skipped: true });
        }
      } catch (e) {
        outcomes.push({ id: row.id, ok: false, error: `derive: ${e instanceof Error ? e.message : String(e)}` });
      }
    }
  }

  if (useBatch) {
    if (anchors.length) await runBatchPhase(anchors, `1/2 (anchors: ${anchors.map((a) => a.id).join(', ')})`);
    await runBatchPhase(members, anchors.length ? '2/2 (members)' : '1/1');
  } else {
    if (anchors.length) {
      log(`  anchors first: ${anchors.map((a) => a.id).join(', ')}`);
      const okToContinue = await runSyncPhase(anchors);
      if (!okToContinue) return outcomes;
    }
    await runSyncPhase(members);
  }
  return outcomes;
}

/** Generate a selected set of rows. Rows may span providers. */
export async function runGenerate(
  c: ResolvedCommission, rows: ResolvedAsset[], flags: GenerateFlags, log: Log = console.log,
): Promise<GenerateSummary> {
  const byProvider = new Map<string, ResolvedAsset[]>();
  for (const row of rows) {
    const p = effectiveProvider(row, c, flags);
    const list = byProvider.get(p) ?? [];
    list.push(row);
    byProvider.set(p, list);
  }
  const outcomes: Outcome[] = [];
  for (const [name, group] of byProvider) {
    if (byProvider.size > 1) log(`\n▪ provider ${name} — ${group.length} asset(s)`);
    outcomes.push(...await runProviderGroup(name, group, c, flags, log));
  }
  const failed = outcomes.filter((o) => !o.ok);
  return {
    outcomes,
    generated: outcomes.filter((o) => o.ok && !o.skipped).length,
    skipped: outcomes.filter((o) => o.skipped).length,
    failed,
  };
}

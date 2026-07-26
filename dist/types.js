/**
 * The commission-file format — the standard, engine-agnostic data contract for
 * commissioning AI-generated game art.
 *
 * A game exports ONE file (JSON, or a JS module default-exporting the same
 * shape) describing every asset it wants procured: what to draw (prompt), how
 * to treat the pixels afterwards (kind/post), where the file lands (out), and
 * how the game will look it up (channel/key). The CLI consumes this file for
 * everything — cost planning, generation, reprocessing, and manifest emission.
 *
 * Design rules carried over from the pipeline this generalizes:
 *   - Generation is resumable and spend-safe: files on disk are skipped,
 *     every raw original is kept, and post-processing is re-runnable for free.
 *   - Image models cannot emit PNG alpha — transparency is a *contract*:
 *     the prompt demands one exact chroma-key backdrop and local post cuts it.
 *   - Every generated asset should have a code-drawn fallback in the game;
 *     the emitted manifest is guarded (missing file = absent key = fallback).
 */
export {};

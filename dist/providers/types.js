/**
 * The provider plugin interface — one small surface every image backend
 * implements. Everything above it (selection, prompts, post, wiring) is
 * provider-agnostic; everything below it (auth, request shape, polling,
 * batch protocol) is the provider's own business.
 */
// ------------------------------------------------------------------- helpers
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** Resolve an API key from the configured env var(s); throws with a set-up hint. */
export function envKey(cfg, fallbacks, what) {
    const names = cfg.apiKeyEnv ? [].concat(cfg.apiKeyEnv) : fallbacks;
    for (const n of names) {
        const v = process.env[n];
        if (v)
            return v;
    }
    throw new Error(`Set ${names.join(' or ')} in your environment / .env (${what})`);
}
/** Snap a target shape to the nearest of a provider's supported aspect strings. */
export function snapAspect(w, h, supported) {
    const r = w / h;
    let best = supported[0];
    for (const cand of supported) {
        if (Math.abs(Math.log(cand[1] / r)) < Math.abs(Math.log(best[1] / r)))
            best = cand;
    }
    return best[0];
}

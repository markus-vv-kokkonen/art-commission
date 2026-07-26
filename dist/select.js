/**
 * The selection language — turn CLI flags into a concrete, ordered list of
 * assets to act on. Shared by plan / generate / repost / status / wire.
 *
 *   --id=a,b            explicit ids (wins outright; matches derives' parents too)
 *   --group=castle      one or more groups
 *   --tag=prop,floor    one or more tags (an asset matches if it has ANY)
 *   --kind=cutout       one or more kinds
 *   --channel=FLOOR_ART one or more manifest channels
 *   --top=N             keep the N highest-priority rows after filtering
 *   --limit=N           hard cap after everything else
 *   --include-disabled  include enabled:false rows
 *   --batch-size=50 --batch=0   deterministic slicing over the filtered pool
 */
export function parseSelectionArgs(get, has) {
    const list = (k) => {
        const v = get(k);
        return v ? v.split(',').map((s) => s.trim()).filter(Boolean) : undefined;
    };
    const num = (k) => {
        const v = get(k);
        return v === undefined ? undefined : Number(v);
    };
    return {
        ids: list('id'),
        groups: list('group'),
        tags: list('tag'),
        kinds: list('kind'),
        channels: list('channel'),
        top: num('top'),
        limit: num('limit'),
        batchSize: num('batch-size'),
        batchIndex: num('batch'),
        includeDisabled: has('include-disabled'),
    };
}
export function resolveSelection(c, args) {
    // explicit ids win outright (and may name disabled rows deliberately)
    if (args.ids?.length) {
        const want = new Set(args.ids);
        const rows = c.assets.filter((a) => want.has(a.id) || a.derive.some((d) => want.has(d.id)));
        return { rows, poolSize: rows.length, batchCount: 1 };
    }
    let pool = args.includeDisabled ? c.assets : c.assets.filter((a) => a.enabled);
    if (args.groups)
        pool = pool.filter((a) => a.group !== undefined && args.groups.includes(a.group));
    if (args.tags)
        pool = pool.filter((a) => a.tags.some((t) => args.tags.includes(t)));
    if (args.kinds)
        pool = pool.filter((a) => args.kinds.includes(a.kind));
    if (args.channels)
        pool = pool.filter((a) => args.channels.includes(a.channel));
    if (args.top !== undefined)
        pool = pool.slice(0, args.top); // assets are priority-sorted
    if (args.limit !== undefined)
        pool = pool.slice(0, args.limit);
    const poolSize = pool.length;
    const size = args.batchSize && args.batchSize > 0 ? args.batchSize : poolSize || 1;
    const batchCount = Math.max(1, Math.ceil(poolSize / size));
    let rows = pool;
    if (args.batchSize && args.batchIndex !== undefined) {
        const start = args.batchIndex * size;
        rows = pool.slice(start, start + size);
    }
    return { rows, poolSize, batchCount };
}
/** Unknown ids passed via --id (typo guard). */
export function unknownIds(c, args) {
    if (!args.ids?.length)
        return [];
    const known = new Set();
    for (const a of c.assets) {
        known.add(a.id);
        for (const d of a.derive)
            known.add(d.id);
    }
    return args.ids.filter((id) => !known.has(id));
}
/** One-line human summary for --plan / dry runs. */
export function describeSelection(args, s) {
    const bits = [];
    if (args.ids)
        bits.push(`id=${args.ids.join(',')}`);
    if (args.groups)
        bits.push(`group=${args.groups.join(',')}`);
    if (args.tags)
        bits.push(`tag=${args.tags.join(',')}`);
    if (args.kinds)
        bits.push(`kind=${args.kinds.join(',')}`);
    if (args.channels)
        bits.push(`channel=${args.channels.join(',')}`);
    if (args.top !== undefined)
        bits.push(`top=${args.top}`);
    if (args.limit !== undefined)
        bits.push(`limit=${args.limit}`);
    if (args.includeDisabled)
        bits.push('include-disabled');
    if (args.batchSize)
        bits.push(`batch ${args.batchIndex ?? 0}/${s.batchCount - 1} of ${args.batchSize}`);
    if (bits.length === 0)
        bits.push('all enabled');
    return `${bits.join('  ')}  →  ${s.rows.length} of ${s.poolSize} asset(s)`;
}

// The folders holding accelerator packs, relative to the repository root: the only place that
// names them (spec 005, 4.2), so nttdata/ can move to a private repository without code changes.
// The release build embeds every pack under them; run from source, they are read from disk.
export const PACK_ROOTS = ["packages/accelerators", "nttdata/accelerators"] as const;

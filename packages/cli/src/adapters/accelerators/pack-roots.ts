// The folders in this repository holding accelerator packs that ship with snagentic, relative to
// the repository root: the only place that names them. The release build embeds every pack under
// them; run from source, they are read from disk. NTT DATA's packs live in their own repository
// and are read from a workspace's pack paths (ADR-0038, item 7).
export const PACK_ROOTS = ["packages/accelerators"] as const;

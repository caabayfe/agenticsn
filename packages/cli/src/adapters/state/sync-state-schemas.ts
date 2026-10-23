import type { CatalogData, PullCheckpoint, SyncState } from "@snagentic/core";
import { z } from "zod";

// The shapes of the files in .snagentic/<name>/, as JsonSyncStateStore writes them. Fields
// added after a file format first shipped are optional, so older files keep loading. Each file
// keeps fields it doesn't know (z.looseObject), so a file a newer version wrote survives being
// read and written back by an older one, after `upgrade --to`.
const TextMap = z.record(z.string(), z.string());

const Fingerprints = z.record(
  z.string(),
  z.object({ count: z.number(), maxUpdatedOn: z.string().nullable() }),
);

export const CatalogFile: z.ZodType<CatalogData> = z.looseObject({
  parents: z.record(z.string(), z.string().nullable()),
  scopes: TextMap,
  typedFields: z.record(z.string(), TextMap),
});

export const CheckpointFile: z.ZodType<PullCheckpoint> = z.looseObject({
  startedAt: z.string(),
  completedClasses: z.array(z.string()),
  records: z.number(),
  fingerprints: Fingerprints.exactOptional(),
  inventory: TextMap.exactOptional(),
  redactionVersion: z.number().exactOptional(),
});

export const SyncStateFile: z.ZodType<SyncState> = z.looseObject({
  watermark: z.string(),
  lastFullPull: z.string(),
  fingerprints: Fingerprints.exactOptional(),
  inventory: TextMap.exactOptional(),
  unreadable: z.array(z.string()).exactOptional(),
  hiddenCounts: z.record(z.string(), z.number()).exactOptional(),
  redactionVersion: z.number().exactOptional(),
});

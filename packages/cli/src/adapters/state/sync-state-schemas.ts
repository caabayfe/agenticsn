import type { CatalogData, PullCheckpoint, SyncState } from "@snagentic/core";
import { z } from "zod";

// The shapes of the files in .snagentic/<name>/, as JsonSyncStateStore writes them. Fields
// added after a file format first shipped are optional, so older files keep loading.
const TextMap = z.record(z.string(), z.string());

const Fingerprints = z.record(
  z.string(),
  z.object({ count: z.number(), maxUpdatedOn: z.string().nullable() }),
);

export const CatalogFile: z.ZodType<CatalogData> = z.object({
  parents: z.record(z.string(), z.string().nullable()),
  scopes: TextMap,
  typedFields: z.record(z.string(), TextMap),
});

export const CheckpointFile: z.ZodType<PullCheckpoint> = z.object({
  startedAt: z.string(),
  completedClasses: z.array(z.string()),
  records: z.number(),
  fingerprints: Fingerprints.exactOptional(),
  inventory: TextMap.exactOptional(),
  redactionVersion: z.number().exactOptional(),
});

export const SyncStateFile: z.ZodType<SyncState> = z.object({
  watermark: z.string(),
  lastFullPull: z.string(),
  fingerprints: Fingerprints.exactOptional(),
  inventory: TextMap.exactOptional(),
  unreadable: z.array(z.string()).exactOptional(),
  hiddenCounts: z.record(z.string(), z.number()).exactOptional(),
  redactionVersion: z.number().exactOptional(),
});

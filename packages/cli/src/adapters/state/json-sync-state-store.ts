import { existsSync } from "node:fs";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { CatalogData, PullCheckpoint, SyncState, SyncStateStore } from "@snagentic/core";
import type { z } from "zod";
import { serialQueue } from "../serial-queue";
import { parseStateFile } from "./state-file";
import { CatalogFile, CheckpointFile, SyncStateFile } from "./sync-state-schemas";

const FILES = {
  catalog: "catalog.json",
  checkpoint: "pull-checkpoint.json",
  state: "sync-state.json",
} as const;

// Removing the file loses nothing that a pull can't rebuild.
const REBUILD = "run snagentic pull --full to rebuild it";

// JSON files in the instance's local state folder (.snagentic/<name>/). Written through a
// temporary file and a rename, so an interrupted write never leaves half a checkpoint.
export class JsonSyncStateStore implements SyncStateStore {
  // Pull workers checkpoint concurrently; writes are applied one at a time, in order.
  private readonly writes = serialQueue();
  private sequence = 0;

  constructor(private readonly directory: string) {}

  readCatalog(): Promise<CatalogData | null> {
    return this.read(FILES.catalog, CatalogFile, REBUILD);
  }

  writeCatalog(data: CatalogData): Promise<void> {
    return this.write(FILES.catalog, data);
  }

  readCheckpoint(): Promise<PullCheckpoint | null> {
    return this.read(
      FILES.checkpoint,
      CheckpointFile,
      `delete ${join(this.directory, FILES.checkpoint)}: the next pull starts again instead of resuming`,
    );
  }

  writeCheckpoint(checkpoint: PullCheckpoint): Promise<void> {
    return this.write(FILES.checkpoint, checkpoint);
  }

  clearCheckpoint(): Promise<void> {
    return this.writes.run(() => rm(join(this.directory, FILES.checkpoint), { force: true }));
  }

  readState(): Promise<SyncState | null> {
    return this.read(FILES.state, SyncStateFile, REBUILD);
  }

  writeState(state: SyncState): Promise<void> {
    return this.write(FILES.state, state);
  }

  private async read<T>(name: string, schema: z.ZodType<T>, hint: string): Promise<T | null> {
    const path = join(this.directory, name);
    return existsSync(path)
      ? parseStateFile(path, await readFile(path, "utf8"), schema, hint)
      : null;
  }

  private write(name: string, value: unknown): Promise<void> {
    const content = `${JSON.stringify(value)}\n`;
    return this.writes.run(async () => {
      await mkdir(this.directory, { recursive: true });
      const path = join(this.directory, name);
      this.sequence += 1;
      const temporary = `${path}.${process.pid}.${this.sequence}.tmp`;
      await writeFile(temporary, content);
      await rename(temporary, path);
    });
  }
}

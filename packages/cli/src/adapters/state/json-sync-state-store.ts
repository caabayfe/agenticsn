import { existsSync } from "node:fs";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { CatalogData, PullCheckpoint, SyncState, SyncStateStore } from "@snagentic/core";

const FILES = {
  catalog: "catalog.json",
  checkpoint: "pull-checkpoint.json",
  state: "sync-state.json",
} as const;

// JSON files in the instance's local state folder (.snagentic/<name>/). Written through a
// temporary file and a rename, so an interrupted write never leaves half a checkpoint.
export class JsonSyncStateStore implements SyncStateStore {
  constructor(private readonly directory: string) {}

  readCatalog(): Promise<CatalogData | null> {
    return this.read<CatalogData>(FILES.catalog);
  }

  writeCatalog(data: CatalogData): Promise<void> {
    return this.write(FILES.catalog, data);
  }

  readCheckpoint(): Promise<PullCheckpoint | null> {
    return this.read<PullCheckpoint>(FILES.checkpoint);
  }

  writeCheckpoint(checkpoint: PullCheckpoint): Promise<void> {
    return this.write(FILES.checkpoint, checkpoint);
  }

  async clearCheckpoint(): Promise<void> {
    await rm(join(this.directory, FILES.checkpoint), { force: true });
  }

  readState(): Promise<SyncState | null> {
    return this.read<SyncState>(FILES.state);
  }

  writeState(state: SyncState): Promise<void> {
    return this.write(FILES.state, state);
  }

  private async read<T>(name: string): Promise<T | null> {
    const path = join(this.directory, name);
    return existsSync(path) ? (JSON.parse(await readFile(path, "utf8")) as T) : null;
  }

  private async write(name: string, value: unknown): Promise<void> {
    await mkdir(this.directory, { recursive: true });
    const path = join(this.directory, name);
    await writeFile(`${path}.tmp`, `${JSON.stringify(value)}\n`);
    await rename(`${path}.tmp`, path);
  }
}

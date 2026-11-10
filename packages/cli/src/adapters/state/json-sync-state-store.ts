import { existsSync } from "node:fs";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { CatalogData, LocalTrust, PullCheckpoint, SyncState } from "@snagentic/core";
import type { z } from "zod";
import { serialQueue } from "../serial-queue";
import { parseStateFile } from "./state-file";
import {
  CatalogFile,
  type CheckNote,
  CheckNoteFile,
  CheckpointFile,
  SyncStateFile,
  TrustFile,
} from "./sync-state-schemas";

const FILES = {
  catalog: "catalog.json",
  checkpoint: "pull-checkpoint.json",
  note: "pull-check.json",
  state: "sync-state.json",
  trust: "trust.json",
} as const;

// Removing the file loses nothing that a pull can't rebuild.
const REBUILD = "run snagentic pull --full to rebuild it";

// JSON files in the instance's local state folder (.snagentic/<name>/): the checkpoint of an
// interrupted pull, the note of the last check that found nothing new, what this clone verified
// itself (trust.json, spec 014 SEC2-03), and the state and catalog
// an earlier version kept here before the mirror carried them (ADR-0052). Written through a
// temporary file and a rename, so an interrupted write never leaves half a checkpoint.
export class JsonSyncStateStore {
  // Pull workers checkpoint concurrently; writes are applied one at a time, in order.
  private readonly writes = serialQueue();
  private sequence = 0;

  constructor(private readonly directory: string) {}

  readLegacyCatalog(): Promise<CatalogData | null> {
    return this.read(FILES.catalog, CatalogFile, REBUILD);
  }

  readLegacyState(): Promise<SyncState | null> {
    return this.read(FILES.state, SyncStateFile, REBUILD);
  }

  hasLegacyState(): boolean {
    return existsSync(join(this.directory, FILES.state));
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
    return this.remove(FILES.checkpoint);
  }

  readNote(): Promise<CheckNote | null> {
    return this.read(FILES.note, CheckNoteFile, `delete ${join(this.directory, FILES.note)}`);
  }

  writeNote(note: CheckNote): Promise<void> {
    return this.write(FILES.note, note);
  }

  async readTrust(): Promise<LocalTrust> {
    return (
      (await this.read(FILES.trust, TrustFile, `delete ${join(this.directory, FILES.trust)}`)) ?? {}
    );
  }

  // Read and written inside one queued step, so concurrent notes never lose each other's part.
  noteTrust(trust: LocalTrust): Promise<void> {
    return this.writes.run(async () => {
      const merged = { ...(await this.readTrust()), ...trust };
      await this.writeNow(FILES.trust, merged);
    });
  }

  async forgetLegacy(): Promise<void> {
    await this.remove(FILES.state);
    await this.remove(FILES.catalog);
    await this.remove(FILES.note);
  }

  private remove(name: string): Promise<void> {
    return this.writes.run(() => rm(join(this.directory, name), { force: true }));
  }

  private async read<T>(name: string, schema: z.ZodType<T>, hint: string): Promise<T | null> {
    const path = join(this.directory, name);
    return existsSync(path)
      ? parseStateFile(path, await readFile(path, "utf8"), schema, hint)
      : null;
  }

  private write(name: string, value: unknown): Promise<void> {
    return this.writes.run(() => this.writeNow(name, value));
  }

  private async writeNow(name: string, value: unknown): Promise<void> {
    await mkdir(this.directory, { recursive: true });
    const path = join(this.directory, name);
    this.sequence += 1;
    const temporary = `${path}.${process.pid}.${this.sequence}.tmp`;
    await writeFile(temporary, `${JSON.stringify(value)}\n`);
    await rename(temporary, path);
  }
}

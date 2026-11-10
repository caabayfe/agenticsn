import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { InstallJournal, InstallRecord } from "@snagentic/core";
import { z } from "zod";
import { parseStateFile, readStateText } from "./state-file";

// Fields it doesn't know are kept, for a journal a newer version wrote.
const InstallFile: z.ZodType<InstallRecord> = z.looseObject({
  planId: z.string(),
  startedAt: z.string(),
  steps: z.array(
    z.object({
      step: z.string(),
      outcome: z.enum(["done", "skipped", "stopped"]),
      detail: z.string(),
      seconds: z.number(),
      progressId: z.string().exactOptional(),
    }),
  ),
  // Absent from journals written by 2.19 and earlier: the install then refuses to resume them
  // (spec 014, F7).
  approved: z
    .object({
      pack: z.string(),
      version: z.string(),
      modules: z.array(z.string()),
      content: z.string(),
    })
    .exactOptional(),
});

// .snagentic/<name>/install.json, replaced atomically like the push journal (ADR-0038, item
// 2.5). The workspace lock keeps two installs from running on one instance at once.
export class JsonInstallJournal implements InstallJournal {
  private readonly path: string;

  constructor(private readonly directory: string) {
    this.path = join(directory, "install.json");
  }

  async read(): Promise<InstallRecord | null> {
    const text = await readStateText(this.path);
    return text === null
      ? null
      : parseStateFile(
          this.path,
          text,
          InstallFile,
          `delete ${this.path}, then install again: the install starts over from a new plan`,
        );
  }

  async write(record: InstallRecord): Promise<void> {
    await mkdir(this.directory, { recursive: true });
    const temporary = `${this.path}.tmp`;
    await writeFile(temporary, `${JSON.stringify(record, null, 2)}\n`);
    await rename(temporary, this.path);
  }

  async clear(): Promise<void> {
    await rm(this.path, { force: true });
  }
}

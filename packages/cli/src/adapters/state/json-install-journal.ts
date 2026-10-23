import { mkdir, open, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { InstallJournal, InstallRecord } from "@snagentic/core";
import { z } from "zod";
import { parseStateFile } from "./state-file";

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
    }),
  ),
});

// .snagentic/<name>/install.json, replaced atomically like the push journal, and
// .snagentic/<name>/install.lock, created exclusively so two installs never run on one
// instance at once (ADR-0038, item 2.5).
export class JsonInstallJournal implements InstallJournal {
  private readonly path: string;
  private readonly lockPath: string;

  constructor(private readonly directory: string) {
    this.path = join(directory, "install.json");
    this.lockPath = join(directory, "install.lock");
  }

  async read(): Promise<InstallRecord | null> {
    const text = await readFile(this.path, "utf8").catch(() => null);
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

  async lock(): Promise<boolean> {
    await mkdir(this.directory, { recursive: true });
    try {
      const handle = await open(this.lockPath, "wx");
      await handle.writeFile(`${process.pid}\n`);
      await handle.close();
      return true;
    } catch {
      return false;
    }
  }

  async unlock(): Promise<void> {
    await rm(this.lockPath, { force: true });
  }
}

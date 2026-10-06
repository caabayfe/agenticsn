import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { PushJournal, PushJournalStore } from "@snagentic/core";

// .snagentic/<name>/push-journal.json, replaced atomically (a temporary file and a rename),
// so an interrupted write never leaves half a journal.
export class JsonPushJournalStore implements PushJournalStore {
  private readonly path: string;

  constructor(private readonly directory: string) {
    this.path = join(directory, "push-journal.json");
  }

  async read(): Promise<PushJournal | null> {
    const text = await readFile(this.path, "utf8").catch(() => null);
    return text === null ? null : JSON.parse(text);
  }

  async write(journal: PushJournal): Promise<void> {
    await mkdir(this.directory, { recursive: true });
    const temporary = `${this.path}.tmp`;
    await writeFile(temporary, `${JSON.stringify(journal, null, 2)}\n`);
    await rename(temporary, this.path);
  }

  async clear(): Promise<void> {
    await rm(this.path, { force: true });
  }
}

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

  // Journals written before 1.5 hold one preference, without its user.
  async read(): Promise<PushJournal | null> {
    const text = await readFile(this.path, "utf8").catch(() => null);
    if (text === null) {
      return null;
    }
    const { preference, preferences, ...journal } = JSON.parse(text);
    return {
      ...journal,
      preferences: preferences ?? (preference ? [{ user: "", ...preference }] : []),
    };
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

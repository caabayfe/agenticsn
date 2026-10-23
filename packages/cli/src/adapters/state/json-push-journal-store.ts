import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { PushJournal, PushJournalStore } from "@snagentic/core";
import { z } from "zod";
import { parseStateFile } from "./state-file";

const Preference = z.object({
  sysId: z.string(),
  user: z.string(),
  name: z.string(),
  previousValue: z.string(),
});

// Journals written before 1.5 hold one preference, without its user. Fields it doesn't know are
// kept, for a journal a newer version wrote.
const PushJournalFile: z.ZodType<PushJournal> = z
  .looseObject({
    planId: z.string(),
    mirrorCommit: z.string(),
    startedAt: z.string(),
    preferences: z.array(Preference).exactOptional(),
    preference: Preference.omit({ user: true }).nullable().exactOptional(),
    steps: z.array(
      z.object({
        operation: z.string(),
        table: z.string(),
        sysId: z.string(),
        state: z.enum(["sending", "written"]),
      }),
    ),
  })
  .transform(({ preference, preferences, ...journal }) => ({
    ...journal,
    preferences: preferences ?? (preference ? [{ user: "", ...preference }] : []),
  }));

// .snagentic/<name>/push-journal.json, replaced atomically (a temporary file and a rename),
// so an interrupted write never leaves half a journal.
export class JsonPushJournalStore implements PushJournalStore {
  private readonly path: string;

  constructor(private readonly directory: string) {
    this.path = join(directory, "push-journal.json");
  }

  async read(): Promise<PushJournal | null> {
    const text = await readFile(this.path, "utf8").catch(() => null);
    // The journal is what recovers an interrupted push, so removing it is a person's decision.
    return text === null
      ? null
      : parseStateFile(
          this.path,
          text,
          PushJournalFile,
          `an interrupted push left it: check the update set and your current application on the instance, then delete ${this.path}`,
        );
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

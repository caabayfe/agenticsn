import { describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { JsonPushJournalStore } from "../../../src/adapters/state/json-push-journal-store";

const folder = () => {
  const directory = join(mkdtempSync(join(tmpdir(), "push-journal-")), "pdi");
  mkdirSync(directory, { recursive: true });
  return directory;
};

const journal = {
  planId: "p1",
  mirrorCommit: "abc",
  startedAt: "2026-10-23T05:00:00.000Z",
  preferences: [{ sysId: "s1", user: "u1", name: "sys_update_set", previousValue: "v0" }],
  steps: [{ operation: "update", table: "sys_script", sysId: "r1", state: "written" as const }],
};

describe("the push journal", () => {
  it("keeps a journal until it is cleared", async () => {
    const store = new JsonPushJournalStore(folder());
    expect(await store.read()).toBeNull();
    await store.write(journal);
    expect(await store.read()).toEqual(journal);
    await store.clear();
    expect(await store.read()).toBeNull();
  });

  it("keeps fields a newer version wrote", async () => {
    const directory = folder();
    writeFileSync(
      join(directory, "push-journal.json"),
      JSON.stringify({ ...journal, addedLater: 1 }),
    );
    expect(await new JsonPushJournalStore(directory).read()).toMatchObject({ addedLater: 1 });
  });

  it("reads a journal from before 1.5, which held one preference without its user", async () => {
    const directory = folder();
    const { preferences, ...rest } = journal;
    const old = {
      ...rest,
      preference: { sysId: "s1", name: "sys_update_set", previousValue: "v0" },
    };
    writeFileSync(join(directory, "push-journal.json"), JSON.stringify(old));
    expect(await new JsonPushJournalStore(directory).read()).toEqual({
      ...rest,
      preferences: [{ user: "", sysId: "s1", name: "sys_update_set", previousValue: "v0" }],
    });
  });

  it("refuses a damaged journal, saying what to check before removing it", async () => {
    const directory = folder();
    writeFileSync(
      join(directory, "push-journal.json"),
      JSON.stringify({ ...journal, steps: [{ ...journal.steps[0], state: "maybe" }] }),
    );
    const error = await new JsonPushJournalStore(directory)
      .read()
      .catch((caught: unknown) => caught);
    expect(error).toMatchObject({ code: "invalid-state-file", category: "precondition" });
    expect(String(error)).toContain("steps.0.state");
    expect(Reflect.get(Object(error), "hint")).toContain("update set");
  });
});

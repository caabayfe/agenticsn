import { describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { JsonInstallJournal } from "../../../src/adapters/state/json-install-journal";

const fresh = () => new JsonInstallJournal(join(mkdtempSync(join(tmpdir(), "install-")), "pdi"));

describe("the install journal and lock (ADR-0038, item 2.5)", () => {
  it("keeps an install's record until it is cleared", async () => {
    const journal = fresh();
    expect(await journal.read()).toBeNull();
    const record = {
      planId: "6c3f87f40b359577",
      startedAt: "2026-10-18T12:00:00.000Z",
      steps: [
        { step: "module foundation", outcome: "done" as const, detail: "5 units", seconds: 2 },
      ],
    };
    await journal.write(record);
    expect(await journal.read()).toEqual(record);
    await journal.clear();
    expect(await journal.read()).toBeNull();
  });

  it("keeps fields a newer version wrote", async () => {
    const directory = join(mkdtempSync(join(tmpdir(), "install-")), "pdi");
    mkdirSync(directory, { recursive: true });
    const record = { planId: "p", startedAt: "s", steps: [], addedLater: 1 };
    writeFileSync(join(directory, "install.json"), JSON.stringify(record));
    expect(await new JsonInstallJournal(directory).read()).toMatchObject({ addedLater: 1 });
  });

  it("lets one install hold an instance at a time", async () => {
    const journal = fresh();
    expect(await journal.lock()).toBe(true);
    expect(await journal.lock()).toBe(false);
    await journal.unlock();
    expect(await journal.lock()).toBe(true);
  });

  it("refuses a journal that is not an install record, naming the file and what to do", async () => {
    const directory = join(mkdtempSync(join(tmpdir(), "install-")), "pdi");
    mkdirSync(directory, { recursive: true });
    const journal = new JsonInstallJournal(directory);
    writeFileSync(join(directory, "install.json"), JSON.stringify({ planId: 7, steps: [] }));
    const error = await journal.read().catch((caught: unknown) => caught);
    expect(error).toMatchObject({ code: "invalid-state-file", category: "precondition" });
    expect(String(error)).toContain("install.json");
    expect(Reflect.get(Object(error), "hint")).toContain("install.json");
    writeFileSync(join(directory, "install.json"), "not json");
    await expect(journal.read()).rejects.toMatchObject({ code: "invalid-state-file" });
  });
});

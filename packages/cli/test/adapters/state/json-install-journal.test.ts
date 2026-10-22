import { describe, expect, it } from "bun:test";
import { mkdtempSync } from "node:fs";
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

  it("lets one install hold an instance at a time", async () => {
    const journal = fresh();
    expect(await journal.lock()).toBe(true);
    expect(await journal.lock()).toBe(false);
    await journal.unlock();
    expect(await journal.lock()).toBe(true);
  });
});

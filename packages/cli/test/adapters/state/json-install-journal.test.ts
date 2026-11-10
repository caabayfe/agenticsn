import { describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { JsonInstallJournal } from "../../../src/adapters/state/json-install-journal";

const fresh = () => new JsonInstallJournal(join(mkdtempSync(join(tmpdir(), "install-")), "pdi"));

describe("the install journal (ADR-0038, item 2.5)", () => {
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

  it("keeps the progress of a component change whose outcome was lost (spec 011, I3 c)", async () => {
    const journal = fresh();
    const lost = {
      step: "install sn_dex 5.3.2",
      outcome: "stopped" as const,
      detail: "the state of sn_dex's install is unknown: socket hang up",
      seconds: 60,
      progressId: "prog9",
    };
    await journal.write({ planId: "p", startedAt: "s", steps: [lost] });
    expect((await journal.read())?.steps[0]).toEqual(lost);
  });

  it("keeps the approved pack, version, modules and content hash a resume checks (spec 014, F7)", async () => {
    const journal = fresh();
    const approved = {
      pack: "itsm",
      version: "0.17.2",
      modules: ["foundation", "incident"],
      content: "a".repeat(64),
    };
    await journal.write({ planId: "p", startedAt: "s", steps: [], approved });
    expect((await journal.read())?.approved).toEqual(approved);
  });

  it("reads a journal an older version wrote, without the approved pack", async () => {
    const directory = join(mkdtempSync(join(tmpdir(), "install-")), "pdi");
    mkdirSync(directory, { recursive: true });
    writeFileSync(
      join(directory, "install.json"),
      JSON.stringify({ planId: "p", startedAt: "s", steps: [] }),
    );
    const record = await new JsonInstallJournal(directory).read();
    expect(record?.planId).toBe("p");
    expect(record?.approved).toBeUndefined();
  });

  it("refuses a journal whose approved pack is malformed", async () => {
    const directory = join(mkdtempSync(join(tmpdir(), "install-")), "pdi");
    mkdirSync(directory, { recursive: true });
    const record = { planId: "p", startedAt: "s", steps: [], approved: { pack: "itsm" } };
    writeFileSync(join(directory, "install.json"), JSON.stringify(record));
    await expect(new JsonInstallJournal(directory).read()).rejects.toThrow();
  });

  it("keeps fields a newer version wrote", async () => {
    const directory = join(mkdtempSync(join(tmpdir(), "install-")), "pdi");
    mkdirSync(directory, { recursive: true });
    const record = { planId: "p", startedAt: "s", steps: [], addedLater: 1 };
    writeFileSync(join(directory, "install.json"), JSON.stringify(record));
    expect(await new JsonInstallJournal(directory).read()).toMatchObject({ addedLater: 1 });
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

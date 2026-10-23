import { afterEach, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { JsonSyncStateStore } from "../../../src/adapters/state/json-sync-state-store";

const temporary: string[] = [];
afterEach(async () => {
  await Promise.all(temporary.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

async function store(): Promise<{ store: JsonSyncStateStore; directory: string }> {
  const base = await mkdtemp(join(tmpdir(), "snagentic-state-"));
  temporary.push(base);
  const directory = join(base, ".snagentic", "pdi");
  return { store: new JsonSyncStateStore(directory), directory };
}

describe("JsonSyncStateStore", () => {
  it("returns nothing before anything was saved", async () => {
    const { store: state } = await store();
    expect([
      await state.readCatalog(),
      await state.readCheckpoint(),
      await state.readState(),
    ]).toEqual([null, null, null]);
  });

  it("saves and reads back the catalog, the checkpoint and the sync state", async () => {
    const { store: state } = await store();
    const catalog = { parents: { a: null }, scopes: {}, typedFields: {} };
    const checkpoint = {
      startedAt: "2026-10-05 12:00:00",
      completedClasses: ["sys_script"],
      records: 3,
    };
    await state.writeCatalog(catalog);
    await state.writeCheckpoint(checkpoint);
    await state.writeState({
      watermark: "2026-10-05 12:00:00",
      lastFullPull: "2026-10-05 12:00:00",
    });
    expect(await state.readCatalog()).toEqual(catalog);
    expect(await state.readCheckpoint()).toEqual(checkpoint);
    expect((await state.readState())?.watermark).toBe("2026-10-05 12:00:00");
  });

  it("clears the checkpoint and leaves no temporary files behind", async () => {
    const { store: state, directory } = await store();
    await state.writeCheckpoint({ startedAt: "x", completedClasses: [], records: 0 });
    await state.clearCheckpoint();
    expect(await state.readCheckpoint()).toBeNull();
    expect((await readdir(directory)).filter((name) => name.endsWith(".tmp"))).toEqual([]);
  });

  it("handles many concurrent checkpoint writes, keeping the last one", async () => {
    const { store: state, directory } = await store();
    await Promise.all(
      Array.from({ length: 25 }, (_, index) =>
        state.writeCheckpoint({ startedAt: "x", completedClasses: [`c${index}`], records: index }),
      ),
    );
    expect((await state.readCheckpoint())?.records).toBe(24);
    expect((await readdir(directory)).filter((name) => name.endsWith(".tmp"))).toEqual([]);
  });

  it("reads a sync state written before the optional fields existed", async () => {
    const { store: state, directory } = await store();
    await mkdir(directory, { recursive: true });
    const old = { watermark: "2026-10-01 00:00:00", lastFullPull: "2026-10-01 00:00:00" };
    await writeFile(join(directory, "sync-state.json"), `${JSON.stringify(old)}\n`);
    expect(await state.readState()).toEqual(old);
  });

  it("refuses a state file that is not JSON, naming the file and what to do", async () => {
    const { store: state, directory } = await store();
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, "sync-state.json"), "{ half a file");
    const error = await state.readState().catch((caught: unknown) => caught);
    expect(error).toMatchObject({ code: "invalid-state-file", category: "precondition" });
    expect(String(error)).toContain("sync-state.json");
    expect(Reflect.get(Object(error), "hint")).toContain("pull --full");
  });

  it("refuses a checkpoint whose fields have the wrong types", async () => {
    const { store: state, directory } = await store();
    await mkdir(directory, { recursive: true });
    const bad = { startedAt: "x", completedClasses: "sys_script", records: "3" };
    await writeFile(join(directory, "pull-checkpoint.json"), JSON.stringify(bad));
    const error = await state.readCheckpoint().catch((caught: unknown) => caught);
    expect(error).toMatchObject({ code: "invalid-state-file" });
    expect(String(error)).toContain("completedClasses");
    expect(Reflect.get(Object(error), "hint")).toContain("pull-checkpoint.json");
  });

  it("refuses a catalog with a table field map that is not text", async () => {
    const { store: state, directory } = await store();
    await mkdir(directory, { recursive: true });
    const bad = { parents: { a: null }, scopes: {}, typedFields: { a: { b: 1 } } };
    await writeFile(join(directory, "catalog.json"), JSON.stringify(bad));
    await expect(state.readCatalog()).rejects.toMatchObject({ code: "invalid-state-file" });
  });
});

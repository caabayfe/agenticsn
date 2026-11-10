import { afterEach, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
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
      await state.readLegacyCatalog(),
      await state.readCheckpoint(),
      await state.readLegacyState(),
      await state.readNote(),
    ]).toEqual([null, null, null, null]);
    expect(state.hasLegacyState()).toBe(false);
  });

  it("saves and reads back the checkpoint and the note of a check", async () => {
    const { store: state } = await store();
    const checkpoint = {
      startedAt: "2026-10-05 12:00:00",
      completedClasses: ["sys_script"],
      records: 3,
      secretScanVersion: 1,
      secretRedactions: [{ path: "instances/pdi/a.yaml", patterns: ["jwt" as const] }],
    };
    await state.writeCheckpoint(checkpoint);
    const note = {
      commit: "abc",
      state: { watermark: "2026-10-05 12:00:00", lastFullPull: "x", pulledBy: "admin" },
    };
    await state.writeNote(note);
    expect(await state.readCheckpoint()).toEqual(checkpoint);
    expect(await state.readNote()).toEqual(note);
  });

  // Spec 014, SEC2-03: what this clone verified itself stays in this clone, past a pull commit.
  it("keeps what this clone verified itself, apart from the state a commit carries", async () => {
    const { store: state, directory } = await store();
    expect(await state.readTrust()).toEqual({});
    await Promise.all([state.noteTrust({ catalogDigest: "a" }), state.noteTrust({})]);
    expect(await state.readTrust()).toEqual({ catalogDigest: "a" });
    await state.forgetLegacy();
    expect(await state.readTrust()).toEqual({ catalogDigest: "a" });
    expect(await readdir(directory)).toEqual(["trust.json"]);
  });

  it("forgets the state and catalog an earlier version kept here", async () => {
    const { store: state, directory } = await store();
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, "sync-state.json"), '{"watermark":"w","lastFullPull":"l"}');
    await writeFile(join(directory, "catalog.json"), '{"parents":{},"scopes":{},"typedFields":{}}');
    expect(state.hasLegacyState()).toBe(true);
    await state.forgetLegacy();
    expect(await readdir(directory)).toEqual([]);
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
    expect(await state.readLegacyState()).toEqual(old);
  });

  it("keeps fields a newer version wrote when it reads and writes a checkpoint back", async () => {
    const { store: state, directory } = await store();
    await mkdir(directory, { recursive: true });
    const newer = { addedLater: { kept: true } };
    const content = { startedAt: "s", completedClasses: [], records: 0, ...newer };
    await writeFile(join(directory, "pull-checkpoint.json"), `${JSON.stringify(content)}\n`);
    const checkpoint = await state.readCheckpoint();
    if (checkpoint === null) throw new Error("not read");
    await state.writeCheckpoint(checkpoint);
    const written = await readFile(join(directory, "pull-checkpoint.json"), "utf8");
    expect(JSON.parse(written)).toMatchObject(newer);
    expect(await state.readLegacyState()).toBeNull();
  });

  it("refuses a state file that is not JSON, naming the file and what to do", async () => {
    const { store: state, directory } = await store();
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, "sync-state.json"), "{ half a file");
    const error = await state.readLegacyState().catch((caught: unknown) => caught);
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
    await expect(state.readLegacyCatalog()).rejects.toMatchObject({ code: "invalid-state-file" });
  });
});

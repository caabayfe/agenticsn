import { afterEach, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { InstanceName } from "@snagentic/core";
import { GitMirror } from "../../../src/adapters/git/git-mirror";
import { runGitOrThrow } from "../../../src/adapters/git/run-git";
import { syncStateStore } from "../../../src/adapters/state/mirror-sync-state-store";

const temporary: string[] = [];
afterEach(async () => {
  await Promise.all(temporary.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

const NAME = InstanceName.parse("pdi");
const STATE = {
  watermark: "2026-10-05 12:00:00",
  lastFullPull: "2026-10-05 12:00:00",
  fingerprints: { sys_metadata: { count: 3, maxUpdatedOn: null } },
  pulledBy: "admin",
};
const CATALOG = {
  parents: { sys_script: "sys_metadata", "123": null },
  scopes: {},
  typedFields: {},
};

async function repository() {
  const repo = await mkdtemp(join(tmpdir(), "snagentic-mirror-state-"));
  temporary.push(repo);
  await runGitOrThrow(["init", "-q", "-b", "main"], repo);
  return repo;
}

async function commitPullFiles(repo: string, files: Record<string, unknown>) {
  const mirror = await GitMirror.open(repo, NAME, "fresh");
  for (const [path, document] of Object.entries(files)) {
    await mirror.writeDocument("instances/pdi", path, document);
  }
  return (await mirror.finish("pull")).commit;
}

async function legacyFiles(repo: string) {
  const directory = join(repo, ".snagentic", "pdi");
  await mkdir(directory, { recursive: true });
  await writeFile(
    join(directory, "sync-state.json"),
    JSON.stringify({ ...STATE, pulledBy: "old" }),
  );
  await writeFile(join(directory, "catalog.json"), JSON.stringify(CATALOG));
}

describe("MirrorSyncStateStore", () => {
  it("reads the state and catalog the mirror's tip was pulled with", async () => {
    const repo = await repository();
    await commitPullFiles(repo, { "pull/state.yaml": STATE, "pull/catalog.yaml": CATALOG });
    const store = syncStateStore(repo, NAME);
    expect(await store.readState()).toEqual(STATE);
    expect(await store.readCatalog()).toEqual(CATALOG);
    expect(await store.heldLocally()).toBe(false);
  });

  it("reads an earlier version's local state until a pull commit carries it", async () => {
    const repo = await repository();
    const store = syncStateStore(repo, NAME);
    expect(await store.readState()).toBeNull();
    await legacyFiles(repo);
    expect(await store.readState()).toMatchObject({ pulledBy: "old" });
    expect(await store.readCatalog()).toEqual(CATALOG);
    expect(await store.heldLocally()).toBe(true);
    await commitPullFiles(repo, { "pull/state.yaml": STATE, "pull/catalog.yaml": CATALOG });
    expect(await store.readState()).toMatchObject({ pulledBy: "admin" });
    expect(await store.heldLocally()).toBe(false);
    await store.forgetLocalState();
    expect(await store.readState()).toMatchObject({ pulledBy: "admin" });
  });

  it("uses this clone's note of a check only while the mirror stays at that commit", async () => {
    const repo = await repository();
    await commitPullFiles(repo, { "pull/state.yaml": STATE, "pull/catalog.yaml": CATALOG });
    const store = syncStateStore(repo, NAME);
    await store.noteUnchanged({ ...STATE, watermark: "2026-10-05 13:00:00" });
    expect((await store.readState())?.watermark).toBe("2026-10-05 13:00:00");
    await commitPullFiles(repo, {
      "pull/state.yaml": { ...STATE, watermark: "2026-10-05 12:30:00" },
    });
    expect((await store.readState())?.watermark).toBe("2026-10-05 12:30:00");
  });

  it("refuses a pull state in the mirror that is not what a pull writes", async () => {
    const repo = await repository();
    await commitPullFiles(repo, {
      "pull/state.yaml": { watermark: ["not", "text"], lastFullPull: "x" },
      "pull/catalog.yaml": { parents: "none" },
    });
    const store = syncStateStore(repo, NAME);
    const error = await store.readState().catch((caught: unknown) => caught);
    expect(error).toMatchObject({ code: "invalid-state-file" });
    expect(String(error)).toContain("instances/pdi/pull/state.yaml");
    expect(Reflect.get(Object(error), "hint")).toContain("snagentic pull pdi --full");
    await expect(store.readCatalog()).rejects.toMatchObject({ code: "invalid-state-file" });
  });
});

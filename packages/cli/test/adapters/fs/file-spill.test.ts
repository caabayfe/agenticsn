import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { KeyedSpill } from "@snagentic/core";
import { fileSpills } from "../../../src/adapters/fs/file-spill";

async function collect<T>(spill: KeyedSpill<T>): Promise<Map<string, readonly T[]>> {
  const groups = new Map<string, readonly T[]>();
  for await (const [key, values] of spill.groups()) {
    expect(groups.has(key)).toBe(false);
    groups.set(key, values);
  }
  return groups;
}

describe("file spill (PERF-07)", () => {
  let parent = "";
  beforeEach(async () => {
    parent = await mkdtemp(join(tmpdir(), "snagentic-spill-test-"));
  });
  afterEach(async () => {
    await rm(parent, { recursive: true, force: true });
  });

  it("gives back each key once, with its values in the order they were added", async () => {
    const spill = await fileSpills(parent).open<{ id: string; text: string }>();
    await spill.add("owner-b", { id: "2", text: "line\nbreak" });
    await spill.add("owner-a", { id: "1", text: "ünïcode" });
    await spill.add("owner-b", { id: "3", text: "" });
    const groups = await collect(spill);
    expect(groups).toEqual(
      new Map([
        [
          "owner-b",
          [
            { id: "2", text: "line\nbreak" },
            { id: "3", text: "" },
          ],
        ],
        ["owner-a", [{ id: "1", text: "ünïcode" }]],
      ]),
    );
    await spill.close();
  });

  it("splits a bucket larger than its limit and still groups every key whole", async () => {
    const spill = await fileSpills(parent, { bucketBytes: 4096 }).open<number>();
    for (let index = 0; index < 20_000; index += 1) {
      await spill.add(`owner-${index % 700}`, index);
    }
    const groups = await collect(spill);
    expect(groups.size).toBe(700);
    for (const [key, values] of groups) {
      const owner = Number(key.slice("owner-".length));
      expect(values).toEqual(values.map((_, at) => owner + at * 700));
    }
    await spill.close();
  });

  it("keeps one key whole when its values alone exceed the limit", async () => {
    const spill = await fileSpills(parent, { bucketBytes: 1024 }).open<string>();
    for (let index = 0; index < 2000; index += 1) {
      await spill.add("one-owner", `row ${index}`);
    }
    const groups = await collect(spill);
    expect(groups.get("one-owner")?.length).toBe(2000);
    await spill.close();
  });

  it("writes private files and removes them all when closed", async () => {
    const spill = await fileSpills(parent).open<string>();
    await spill.add("owner", "row");
    const [directory] = await readdir(parent);
    expect(directory).toBeDefined();
    const folder = join(parent, directory ?? "");
    for await (const _ of spill.groups()) {
      // Reading a bucket removes it.
    }
    await spill.add("again", "row");
    const another = await fileSpills(parent).open<string>();
    await another.add("owner", "row");
    await another.close();
    await spill.close();
    await spill.close();
    expect(await readdir(parent)).toEqual([]);
    await expect(stat(folder)).rejects.toThrow();
  });

  it("creates each spill's files only readable by the user", async () => {
    if (process.platform === "win32") return;
    const spill = await fileSpills(parent).open<string>();
    await spill.add("owner", "x".repeat(2 * 1024 * 1024));
    const [directory] = await readdir(parent);
    const folder = join(parent, directory ?? "");
    expect((await stat(folder)).mode & 0o077).toBe(0);
    for (const file of await readdir(folder)) {
      expect((await stat(join(folder, file))).mode & 0o077).toBe(0);
    }
    await spill.close();
  });
});

describe("file spill sweep (PERF-07)", () => {
  it("removes only spill folders, which a pull sweeps while it holds the workspace lock", async () => {
    const parent = await mkdtemp(join(tmpdir(), "snagentic-spill-sweep-"));
    try {
      const spills = fileSpills(join(parent, "spill"));
      const live = await spills.open<string>();
      await live.add("owner", "row");
      await mkdir(join(parent, "spill", "notes"));
      expect(await spills.sweep()).toBe(1);
      expect(await readdir(join(parent, "spill"))).toEqual(["notes"]);
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  });
});

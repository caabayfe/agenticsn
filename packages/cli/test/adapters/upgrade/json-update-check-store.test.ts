import { afterEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  JsonUpdateCheckStore,
  updateCheckFile,
} from "../../../src/adapters/upgrade/json-update-check-store";

const folders: string[] = [];
afterEach(async () => {
  await Promise.all(folders.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("JsonUpdateCheckStore", () => {
  it("remembers the last check, and reads nothing from a missing or broken file", async () => {
    const dir = await mkdtemp(join(tmpdir(), "snagentic-cache-"));
    folders.push(dir);
    const store = new JsonUpdateCheckStore(join(dir, "snagentic", "update-check.json"));
    expect(await store.read()).toBeNull();
    await store.write({ checkedAt: "2026-10-08T12:00:00.000Z", latest: "1.3.0" });
    expect(await store.read()).toEqual({ checkedAt: "2026-10-08T12:00:00.000Z", latest: "1.3.0" });
    await writeFile(join(dir, "snagentic", "update-check.json"), "{ broken");
    expect(await store.read()).toBeNull();
  });

  it("keeps it in the user's cache folder on each platform", () => {
    expect(updateCheckFile({}, "/Users/a", "darwin")).toBe(
      "/Users/a/Library/Caches/snagentic/update-check.json",
    );
    expect(updateCheckFile({}, "/home/a", "linux")).toBe(
      "/home/a/.cache/snagentic/update-check.json",
    );
    expect(updateCheckFile({ XDG_CACHE_HOME: "/c" }, "/home/a", "linux")).toBe(
      "/c/snagentic/update-check.json",
    );
    expect(updateCheckFile({ LOCALAPPDATA: "/l" }, "/h", "win32")).toBe(
      join("/l", "snagentic", "update-check.json"),
    );
  });
});

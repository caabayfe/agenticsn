import { afterEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { InstanceName } from "@snagentic/core";
import { gitInventoryReader } from "../../../src/adapters/git/git-inventory-reader";
import { GitMirror } from "../../../src/adapters/git/git-mirror";
import { runGitOrThrow } from "../../../src/adapters/git/run-git";

const temporary: string[] = [];
afterEach(async () => {
  await Promise.all(temporary.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

describe("gitInventoryReader", () => {
  it("reads an inventory file from the instance's remote branch", async () => {
    const repo = await mkdtemp(join(tmpdir(), "snagentic-inventory-"));
    temporary.push(repo);
    await runGitOrThrow(["init", "-q", "-b", "main"], repo);
    expect(await gitInventoryReader.read(repo, "pdi", "plugins")).toBeNull();
    const mirror = await GitMirror.open(repo, InstanceName.parse("pdi"), "fresh");
    await mirror.writeDocument("instances/pdi/operational", "plugins.yaml", [
      { id: "com.snc.a", active: "active", version: "1.0" },
    ]);
    await mirror.finish("pull");
    expect(await gitInventoryReader.read(repo, "pdi", "plugins")).toEqual([
      { id: "com.snc.a", active: "active", version: "1.0" },
    ]);
    expect(await gitInventoryReader.read(repo, "pdi", "store_apps")).toBeNull();
  });

  it("reads a damaged inventory file as no rows rather than failing", async () => {
    const repo = await mkdtemp(join(tmpdir(), "snagentic-inventory-"));
    temporary.push(repo);
    await runGitOrThrow(["init", "-q", "-b", "main"], repo);
    const mirror = await GitMirror.open(repo, InstanceName.parse("pdi"), "fresh");
    await mirror.writeDocument("instances/pdi/operational", "plugins.yaml", { id: "not a list" });
    await mirror.writeDocument("instances/pdi/operational", "domains.yaml", [
      "text",
      { name: "TOP" },
    ]);
    await mirror.finish("pull");
    expect(await gitInventoryReader.read(repo, "pdi", "plugins")).toEqual([]);
    expect(await gitInventoryReader.read(repo, "pdi", "domains")).toEqual([{ name: "TOP" }]);
  });
});

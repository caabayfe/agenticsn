import { afterEach, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createProfile, InstanceName } from "@snagentic/core";
import { YamlProfileStore } from "../../../src/adapters/profiles/yaml-profile-store";

const temporary: string[] = [];
afterEach(async () => {
  await Promise.all(temporary.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

async function workspace(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "snagentic-profiles-"));
  temporary.push(root);
  return root;
}

const store = new YamlProfileStore();
const pdi = createProfile({
  name: InstanceName.parse("pdi"),
  url: "dev312411",
  username: "admin",
  kind: "development",
  acknowledgeReadOnly: false,
});

describe("YamlProfileStore", () => {
  it("writes a readable, secret-free instance.yaml", async () => {
    const root = await workspace();
    await store.write(root, pdi);
    expect(await readFile(join(root, "instances/pdi/instance.yaml"), "utf8")).toBe(
      [
        "auth:",
        "  method: basic",
        "  username: admin",
        "kind: development",
        "read_only_acknowledged: false",
        "url: https://dev312411.service-now.com",
        "",
      ].join("\n"),
    );
  });

  it("reads back what it wrote, and lists every profile", async () => {
    const root = await workspace();
    await store.write(root, pdi);
    expect(await store.read(root, pdi.name)).toEqual(pdi);
    expect(await store.list(root)).toEqual([pdi]);
  });

  it("returns nothing for a missing profile or an empty workspace", async () => {
    const root = await workspace();
    expect(await store.read(root, pdi.name)).toBeNull();
    expect(await store.list(root)).toEqual([]);
  });

  it("explains a hand-edited profile that is not valid", async () => {
    const root = await workspace();
    await mkdir(join(root, "instances/pdi"), { recursive: true });
    await writeFile(join(root, "instances/pdi/instance.yaml"), "kind: staging\nurl: x\n");
    await expect(store.read(root, pdi.name)).rejects.toMatchObject({ code: "invalid-profile" });
  });

  it("removes the profile file", async () => {
    const root = await workspace();
    await store.write(root, pdi);
    await store.remove(root, pdi.name);
    expect(await store.read(root, pdi.name)).toBeNull();
  });
});

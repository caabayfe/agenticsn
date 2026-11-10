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

  it("writes and reads an OAuth client profile, with the client id but never a secret", async () => {
    const root = await workspace();
    const client = createProfile({
      name: InstanceName.parse("pdi"),
      url: "dev312411",
      username: "svc_oauth",
      clientId: "0123abcd",
      kind: "development",
      acknowledgeReadOnly: false,
    });
    await store.write(root, client);
    expect(await readFile(join(root, "instances/pdi/instance.yaml"), "utf8")).toBe(
      [
        "auth:",
        "  client_id: 0123abcd",
        "  method: oauth-client-credentials",
        "  username: svc_oauth",
        "kind: development",
        "read_only_acknowledged: false",
        "url: https://dev312411.service-now.com",
        "",
      ].join("\n"),
    );
    expect(await store.read(root, client.name)).toEqual(client);
  });

  it("refuses a hand-edited client id that could change the keychain account", async () => {
    const root = await workspace();
    await mkdir(join(root, "instances/pdi"), { recursive: true });
    await writeFile(
      join(root, "instances/pdi/instance.yaml"),
      "url: https://x.service-now.com\nkind: development\nauth:\n  method: oauth-client-credentials\n  client_id: a@b\n  username: svc\n",
    );
    await expect(store.read(root, pdi.name)).rejects.toMatchObject({ code: "invalid-profile" });
  });

  it("writes and reads the shared mirror a team pulls from (ADR-0052)", async () => {
    const root = await workspace();
    const team = createProfile({
      name: InstanceName.parse("pdi"),
      url: "dev312411",
      username: "admin",
      kind: "development",
      acknowledgeReadOnly: false,
      sharedMirrorRemote: "origin",
    });
    await store.write(root, team);
    const text = await readFile(join(root, "instances/pdi/instance.yaml"), "utf8");
    expect(text).toContain("shared_mirror:\n  max_age_minutes: 30\n  remote: origin\n");
    expect(await store.read(root, team.name)).toEqual({
      ...pdi,
      sharedMirror: { remote: "origin", maxAgeMinutes: 30 },
    });
  });

  it("refuses a hand-edited shared mirror git could read as an option or a path", async () => {
    const root = await workspace();
    await mkdir(join(root, "instances/pdi"), { recursive: true });
    for (const remote of ["--upload-pack=x", "../elsewhere", "a b"]) {
      const yaml = `url: https://dev1.service-now.com\nkind: development\nauth:\n  method: basic\n  username: admin\nshared_mirror:\n  remote: '${remote}'\n`;
      await writeFile(join(root, "instances/pdi/instance.yaml"), yaml);
      await expect(store.read(root, pdi.name)).rejects.toMatchObject({ code: "invalid-profile" });
    }
    const late =
      "url: https://dev1.service-now.com\nkind: development\nauth:\n  method: basic\n  username: admin\nshared_mirror:\n  remote: origin\n  max_age_minutes: 2.5\n";
    await writeFile(join(root, "instances/pdi/instance.yaml"), late);
    await expect(store.read(root, pdi.name)).rejects.toMatchObject({ code: "invalid-profile" });
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

  it("refuses a hand-edited username that would change an encoded query", async () => {
    const root = await workspace();
    await mkdir(join(root, "instances/pdi"), { recursive: true });
    await writeFile(
      join(root, "instances/pdi/instance.yaml"),
      "url: https://x.service-now.com\nkind: development\nauth:\n  method: basic\n  username: a^NQuser_name=admin\n",
    );
    await expect(store.read(root, pdi.name)).rejects.toMatchObject({ code: "invalid-profile" });
  });

  it("reads the load limits an instance owner set, and keeps them when it writes", async () => {
    const root = await workspace();
    await mkdir(join(root, "instances/pdi"), { recursive: true });
    await writeFile(
      join(root, "instances/pdi/instance.yaml"),
      "url: https://x.service-now.com\nkind: production\nread_only_acknowledged: true\nauth:\n  method: basic\n  username: svc\nload:\n  max_concurrency: 1\n  request_budget: 3000\n",
    );
    const profile = await store.read(root, pdi.name);
    expect(profile?.load).toEqual({ maxConcurrency: 1, requestBudget: 3000 });
    if (profile === null) throw new Error("no profile");
    await store.write(root, profile);
    expect(await store.read(root, pdi.name)).toEqual(profile);
  });

  it("keeps load limits and a shared mirror side by side", async () => {
    const root = await workspace();
    await mkdir(join(root, "instances/pdi"), { recursive: true });
    await writeFile(
      join(root, "instances/pdi/instance.yaml"),
      "url: https://x.service-now.com\nkind: development\nauth:\n  method: basic\n  username: svc\nshared_mirror:\n  remote: origin\nload:\n  requests_per_second: 2\n",
    );
    const profile = await store.read(root, pdi.name);
    expect(profile).toMatchObject({
      load: { requestsPerSecond: 2 },
      sharedMirror: { remote: "origin" },
    });
    if (profile === null) throw new Error("no profile");
    await store.write(root, profile);
    expect(await store.read(root, pdi.name)).toEqual(profile);
  });

  it("refuses a load limit that is not a positive whole number", async () => {
    const root = await workspace();
    await mkdir(join(root, "instances/pdi"), { recursive: true });
    await writeFile(
      join(root, "instances/pdi/instance.yaml"),
      "url: https://x.service-now.com\nkind: development\nauth:\n  method: basic\n  username: svc\nload:\n  requests_per_second: 0\n",
    );
    await expect(store.read(root, pdi.name)).rejects.toMatchObject({ code: "invalid-profile" });
  });

  it("removes the profile file", async () => {
    const root = await workspace();
    await store.write(root, pdi);
    await store.remove(root, pdi.name);
    expect(await store.read(root, pdi.name)).toBeNull();
  });
});

import { afterEach, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  artifactFromRow,
  Catalog,
  DEFAULT_REDACTION,
  parseRecord,
  renderRecord,
} from "@snagentic/core";
import { FlatRecordStore } from "../../../src/adapters/records/flat-record-store";

const temporary: string[] = [];
afterEach(async () => {
  await Promise.all(temporary.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

async function scratch(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "snagentic-records-"));
  temporary.push(directory);
  return directory;
}

const catalog = new Catalog({
  parents: { sys_metadata: null, sys_script: "sys_metadata", sys_ui_page: "sys_metadata" },
  scopes: {},
  typedFields: {
    sys_script: { script: "script_server" },
    sys_ui_page: { html: "html", client_script: "script" },
  },
});

function artifact(overrides: Record<string, string> = {}) {
  return artifactFromRow(
    {
      sys_id: "0123456789abcdef0123456789abcdef",
      sys_class_name: "sys_script",
      sys_scope: "global",
      name: "Raise priority",
      script: "gs.info('x');",
      ...overrides,
    },
    catalog,
    DEFAULT_REDACTION,
  );
}

const store = new FlatRecordStore();

describe("FlatRecordStore", () => {
  it("writes the record YAML and its script file side by side", async () => {
    const root = await scratch();
    await store.write(root, renderRecord(artifact(), catalog));
    expect((await readdir(join(root, "global/sys_script"))).sort()).toEqual([
      "raise-priority--0123456789abcdef0123456789abcdef.script.js",
      "raise-priority--0123456789abcdef0123456789abcdef.yaml",
    ]);
    const yaml = await readFile(
      join(root, "global/sys_script/raise-priority--0123456789abcdef0123456789abcdef.yaml"),
      "utf8",
    );
    expect(yaml).toStartWith("_meta:\n");
    expect(yaml).toContain("name: Raise priority\n");
  });

  it("reads a record back into the same artifact", async () => {
    const root = await scratch();
    const rendered = renderRecord(artifact(), catalog);
    await store.write(root, rendered);
    const stored = await store.read(root, rendered.base);
    expect(stored).not.toBeNull();
    const parsed = parseRecord(stored?.document, stored?.files ?? []);
    expect(parsed.artifact.hash).toBe(artifact().hash);
    expect(parsed.storedHash).toBe(artifact().hash);
  });

  it("removes a field file that is no longer needed when the record is rewritten", async () => {
    const root = await scratch();
    const before = renderRecord(artifact(), catalog);
    await store.write(root, before);
    const after = renderRecord(artifact({ script: "" }), catalog);
    await store.write(
      root,
      after,
      before.files.map((file) => file.path),
    );
    expect(await readdir(join(root, "global/sys_script"))).toEqual([
      `${after.base.split("/").at(-1)}.yaml`,
    ]);
  });

  it("removes a record with all its sibling files", async () => {
    const root = await scratch();
    const rendered = renderRecord(artifact(), catalog);
    await store.write(root, rendered);
    await writeFile(
      join(root, `${rendered.base}.children.sys_hub_action_instance_v2.yaml`),
      "[]\n",
    );
    await store.remove(root, rendered.base);
    expect(await readdir(join(root, "global/sys_script"))).toEqual([]);
  });

  it("lists every record across scopes, classes and domains, grouping each record's files", async () => {
    const root = await scratch();
    const records = [
      artifact(),
      artifact({ sys_id: "11111111111111111111111111111111", name: "Second", sys_scope: "x1" }),
      artifactFromRow(
        {
          sys_id: "22222222222222222222222222222222",
          sys_class_name: "sys_ui_page",
          name: "Page",
          html: "<p/>",
          client_script: "x()",
          sys_domain: "d1",
        },
        catalog,
        DEFAULT_REDACTION,
      ),
    ];
    for (const record of records) {
      await store.write(root, renderRecord(record, catalog));
    }
    await mkdir(join(root, "global/sys_script/stray"), { recursive: true });
    await writeFile(join(root, "global/sys_script/README.md"), "not a record");
    const listed = [];
    for await (const record of store.list(root)) {
      listed.push({ base: record.base, fields: record.files.map((file) => file.field).sort() });
    }
    expect(listed.sort((a, b) => a.base.localeCompare(b.base))).toEqual([
      {
        base: "domains/d1/global/sys_ui_page/page--22222222222222222222222222222222",
        fields: ["client_script", "html"],
      },
      {
        base: "global/sys_script/raise-priority--0123456789abcdef0123456789abcdef",
        fields: ["script"],
      },
      { base: "x1/sys_script/second--11111111111111111111111111111111", fields: ["script"] },
    ]);
  });

  it("reads a record's child-row files together with the record", async () => {
    const root = await scratch();
    const rendered = renderRecord(artifact(), catalog);
    await store.write(root, rendered);
    await writeFile(
      join(root, `${rendered.base}.children.sys_hub_action_instance_v2.yaml`),
      "- order: '1'\n",
    );
    const stored = await store.read(root, rendered.base);
    expect(stored?.children).toEqual([
      { table: "sys_hub_action_instance_v2", content: "- order: '1'\n" },
    ]);
    expect(stored?.files.map((file) => file.field)).toEqual(["script"]);
  });

  it("lists nothing for a missing metadata folder", async () => {
    const listed = [];
    for await (const record of store.list(join(await scratch(), "missing"))) {
      listed.push(record);
    }
    expect(listed).toEqual([]);
  });

  it("returns nothing when reading a record that does not exist", async () => {
    expect(await store.read(await scratch(), "global/sys_script/none--0")).toBeNull();
  });
});

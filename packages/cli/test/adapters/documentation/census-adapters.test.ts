import { afterEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FsDocumentationSources } from "../../../src/adapters/documentation/fs-documentation-sources";
import { FsMirrorRecords } from "../../../src/adapters/documentation/fs-mirror-records";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function workspace() {
  const root = mkdtempSync(join(tmpdir(), "snagentic-census-"));
  roots.push(root);
  const write = (path: string, text: string) => {
    mkdirSync(join(root, path, ".."), { recursive: true });
    writeFileSync(join(root, path), text);
  };
  return { root, write };
}

describe("the census in the file system (ADR-0040)", () => {
  it("finds records by a field's value before parsing them, with the application holding each", async () => {
    const { root, write } = workspace();
    const metadata = join(root, "metadata");
    write(
      "metadata/sn_comm/sys_dictionary/source--r1.yaml",
      "name: comm_plan\nreference: 'task'\n",
    );
    write(
      "metadata/global/sys_dictionary/caller--r2.yaml",
      "name: incident\nreference: sys_user\n",
    );
    write("metadata/global/sys_dictionary/caller--r2.children.x.yaml", "reference: task\n");
    const mirror = new FsMirrorRecords(metadata, async () => null);
    const signal = new AbortController().signal;
    expect(await mirror.find("sys_dictionary", "reference", ["task", "incident"], signal)).toEqual([
      { sysId: "r1", scope: "sn_comm", fields: { name: "comm_plan", reference: "task" } },
    ]);
    expect((await mirror.list("sys_dictionary", signal)).map((item) => item.scope)).toEqual([
      "global",
      "sn_comm",
    ]);
    expect(
      await new FsMirrorRecords(join(root, "none"), async () => null).find("t", "f", [], signal),
    ).toEqual([]);
  });

  it("reads each process's features.yaml", async () => {
    const { root, write } = workspace();
    write("documentation/processes/incident/features.yaml", "features:\n  - id: core\n");
    expect(await new FsDocumentationSources(root).features()).toEqual([
      { path: "processes/incident/features.yaml", features: { features: [{ id: "core" }] } },
    ]);
  });
});

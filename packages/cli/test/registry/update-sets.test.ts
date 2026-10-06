import { afterEach, describe, expect, it } from "bun:test";
import { join } from "node:path";
import type { Row } from "@snagentic/core";
import { executeUseCase } from "../../src/registry/execute";
import { updateSetsCollisions } from "../../src/registry/update-sets-collisions";
import { updateSetsExport } from "../../src/registry/update-sets-export";
import { updateSetsList } from "../../src/registry/update-sets-list";
import { updateSetsShow } from "../../src/registry/update-sets-show";
import { instanceWorkspace } from "../support/instance-workspace";

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
});

const MINE = "a1000000000000000000000000000001";
const THEIRS = "b2000000000000000000000000000002";
const set = (sys_id: string, name: string, owner: string): Row => ({
  sys_id,
  name,
  state: "in progress",
  application: "global",
  is_default: "false",
  description: "",
  sys_created_by: owner,
  sys_updated_on: "2026-10-05 10:00:00",
});
const update = (sys_id: string, updateSet: string, by: string): Row => ({
  sys_id,
  update_set: updateSet,
  name: "sys_script_c0ffee",
  type: "Business Rule",
  target_name: "VIP flag",
  action: "INSERT_OR_UPDATE",
  table: "",
  application: "global",
  payload: "<record_update/>",
  sys_recorded_at: sys_id,
  sys_updated_by: by,
  sys_updated_on: "2026-10-05 10:00:00",
});

async function workspace() {
  const ws = await instanceWorkspace({
    sys_update_set: [set(MINE, "Incident tweaks", "alice"), set(THEIRS, "Bob's fix", "bob")],
    sys_update_xml: [update("u1", MINE, "alice"), update("u2", THEIRS, "bob")],
    sys_scope: [{ sys_id: "global", name: "Global", scope: "global", version: "" }],
    sys_dictionary: [
      { sys_id: "d1", name: "sys_remote_update_set", element: "name", internal_type: "string" },
      { sys_id: "d2", name: "sys_update_xml", element: "name", internal_type: "string" },
    ],
  });
  cleanups.push(ws.cleanup);
  return ws;
}

describe("update-sets commands", () => {
  it("lists update sets with their update counts", async () => {
    const { context } = await workspace();
    const { output } = await executeUseCase(updateSetsList, { instance: "pdi" }, context);
    expect(output["updateSets"]).toHaveLength(2);
    expect(updateSetsList.render(output as never, "text")).toContain("Incident tweaks");
  });

  it("shows one set's updates", async () => {
    const { context } = await workspace();
    const { output } = await executeUseCase(updateSetsShow, { instance: "pdi", id: MINE }, context);
    expect(updateSetsShow.render(output as never, "text")).toContain("Business Rule");
  });

  it("reports collisions as findings, so CI can stop on them", async () => {
    const { context } = await workspace();
    const { output, exitCode } = await executeUseCase(
      updateSetsCollisions,
      { instance: "pdi" },
      context,
    );
    expect(exitCode).toBe(1);
    expect(updateSetsCollisions.render(output as never, "text")).toContain(
      "1 collisions among 1 records in 2 open update sets",
    );
  });

  it("writes the export next to the person by default, named after the set", async () => {
    const { context, root, written } = await workspace();
    const { output } = await executeUseCase(
      updateSetsExport,
      { instance: "pdi", id: MINE },
      context,
    );
    const path = join(root, `incident-tweaks--${MINE}.xml`);
    expect(output).toMatchObject({ name: "Incident tweaks", updates: 1, path });
    expect(written.get(path)).toContain('<sys_remote_update_set action="INSERT_OR_UPDATE">');
    expect(updateSetsExport.render(output as never, "text")).toBe(
      `exported "Incident tweaks" (1 updates, ${output["bytes"]} bytes) to ${path}`,
    );
  });

  it("writes the export where asked", async () => {
    const { context, written } = await workspace();
    await executeUseCase(
      updateSetsExport,
      { instance: "pdi", id: MINE, output: "/tmp/out.xml" },
      context,
    );
    expect([...written.keys()]).toEqual(["/tmp/out.xml"]);
  });
});

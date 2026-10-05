import { describe, expect, it } from "bun:test";
import { MirrorIndex } from "../../../src/adapters/git/mirror-index";

const ROOT = "instances/pdi/metadata/";
const RULE = `${ROOT}global/sys_script/rule--0001`;
const FLOW = `${ROOT}global/sys_hub_flow/my-flow--0002`;

const index = () =>
  MirrorIndex.fromPaths([
    `${RULE}.yaml`,
    `${RULE}.script.js`,
    `${FLOW}.yaml`,
    `${FLOW}.children.sys_hub_action_instance_v2.yaml`,
    "instances/pdi/operational/v_plugin.yaml",
  ]);

describe("MirrorIndex", () => {
  it("groups every file of a record under its base", () => {
    expect(index().filesOf(RULE)).toEqual([`${RULE}.yaml`, `${RULE}.script.js`]);
    expect(index().filesOf(FLOW)).toEqual([
      `${FLOW}.yaml`,
      `${FLOW}.children.sys_hub_action_instance_v2.yaml`,
    ]);
  });

  it("finds a record's base by its sys_id", () => {
    expect(index().baseOf("0002")).toBe(FLOW);
    expect(index().baseOf("9999")).toBeUndefined();
  });

  it("lists record bases under a prefix, ignoring files that are not records", () => {
    expect([...index().bases(ROOT)].sort()).toEqual([
      "global/sys_hub_flow/my-flow--0002",
      "global/sys_script/rule--0001",
    ]);
    expect([...index().bases("instances/pdi/operational/")]).toEqual([]);
  });

  it("forgets a record once its last file is removed", () => {
    const tree = index();
    tree.remove(`${RULE}.script.js`);
    expect(tree.filesOf(RULE)).toEqual([`${RULE}.yaml`]);
    tree.remove(`${RULE}.yaml`);
    expect(tree.filesOf(RULE)).toEqual([]);
    expect(tree.baseOf("0001")).toBeUndefined();
  });

  it("follows a renamed record to its new base", () => {
    const tree = index();
    const renamed = `${ROOT}global/sys_script/better-rule--0001`;
    tree.remove(`${RULE}.yaml`);
    tree.remove(`${RULE}.script.js`);
    tree.add(`${renamed}.yaml`);
    expect(tree.baseOf("0001")).toBe(renamed);
  });

  it("does not list a file twice when it is written again", () => {
    const tree = index();
    tree.add(`${RULE}.yaml`);
    expect(tree.filesOf(RULE)).toHaveLength(2);
  });
});

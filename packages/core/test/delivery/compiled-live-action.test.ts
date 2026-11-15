import { expect, it } from "bun:test";
import { compiledCopyAgrees } from "../../src/authoring/domain/capture-content";
import type { BuiltUnit } from "../../src/authoring/domain/unit";

it("rejects a live action that is no longer published despite a valid captured snapshot", () => {
  const action: BuiltUnit = {
    updateName: "sys_hub_action_type_definition_action",
    file: "action.xml",
    head: {
      table: "sys_hub_action_type_definition",
      sysId: "action",
      action: "INSERT_OR_UPDATE",
      fields: { name: "Calculate", state: "published", master_snapshot: "snapshot" },
      referenceNames: {},
    },
    children: [],
  };
  const copy = { head: action.head.fields, children: [], version: "1", foreignRows: 0 };
  expect(compiledCopyAgrees(action, action, copy)).toBe(true);
  expect(
    compiledCopyAgrees(action, action, { ...copy, head: { ...copy.head, state: "draft" } }),
  ).toBe(false);
});

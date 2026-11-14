import { type BuiltUnit, unitDigest, withEntries } from "@snagentic/core";
import { unitSetup } from "./unit-fixture";

export const FLOW_ID = "f".repeat(32);
export const FLOW_NAME = `sys_hub_flow_${FLOW_ID}`;
export function flowUnit(value: string): BuiltUnit {
  return {
    updateName: FLOW_NAME,
    file: `${FLOW_NAME}.xml`,
    head: {
      table: "sys_hub_flow",
      sysId: FLOW_ID,
      action: "INSERT_OR_UPDATE",
      fields: { sys_id: FLOW_ID, name: "Notify", status: "draft", active: "false" },
      referenceNames: {},
    },
    children: [
      {
        table: "sys_hub_action_instance",
        sysId: "a1",
        action: "INSERT_OR_UPDATE",
        fields: { sys_id: "a1", inputs: value },
        referenceNames: {},
      },
    ],
  };
}
export function flowSetup() {
  const context = unitSetup();
  const previous = flowUnit("previous");
  const wanted = flowUnit("wanted");
  context.builds.set(context.project.path, [wanted]);
  context.xml.set(
    FLOW_NAME,
    `<record_update table="sys_hub_flow"><sys_hub_flow action="INSERT_OR_UPDATE"><sys_id>${FLOW_ID}</sys_id><name>Notify</name><status>draft</status></sys_hub_flow></record_update>`,
  );
  context.tables["sys_script_include"] = [];
  context.tables["sys_hub_flow"] = [
    { ...previous.head.fields, sys_mod_count: "1", sys_updated_on: "old", sys_domain: "global" },
  ];
  context.authoring.ledgers.set(
    context.project.path,
    withEntries(
      new Map(),
      "dev",
      new Map([[FLOW_NAME, { build: unitDigest(previous), instance: "1|old", losses: [] }]]),
    ),
  );
  context.tables["sys_update_set"]?.push({
    sys_id: "flow-set",
    name: "snagentic: feature/p1 [x_app]",
    state: "in progress",
    application: context.project.scopeId,
  });
  context.tables["sys_update_xml"] = [
    { sys_id: "old-capture", name: FLOW_NAME, update_set: "flow-set", payload: "old" },
  ];
  context.payloads.set("old", { unit: previous, published: true });
  return { ...context, previous, wanted };
}

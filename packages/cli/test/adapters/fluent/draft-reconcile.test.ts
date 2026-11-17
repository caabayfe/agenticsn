import { expect, it } from "bun:test";
import { type BuiltUnit, computeUnitPlan, type Row, unitDigest, versionOf } from "@snagentic/core";
import { QUERY, unitSetup } from "../../../../core/test/delivery/unit-fixture";
import { draftSchemas } from "../../../../core/test/support/draft-schema-fixture";
import { builtUnitOf } from "../../../src/adapters/fluent/built-units";
import { decodeCapture } from "../../../src/adapters/fluent/capture-decoder";

const ROOT = new URL(
  "../../../../../tests/fixtures/p1-delivery/pdi13-draft-2026-11-17/",
  import.meta.url,
);
const IDS = [
  "3ad20e12b1523d5738e3e890f3a625ff",
  "a3423c7421df98a9a2d4418906bd62e6",
  "dc3159a909ded6793ee4603e8b142b6f",
  "e47d7a531b022ca88a2ff402a3a3d0d1",
  "ed65090d7166e0e0d5dc7d622dc4413d",
];
const EXTRA: Readonly<Record<string, string>> = {
  sys_translated_text: "documentkey",
  sys_variable_value: "document_key",
  sys_flow_cat_variable_model: "id",
  sys_hub_pill_compound: "attached_to",
  sys_choice: "name",
  sys_flow_trigger_plan: "plan_id",
  sys_flow_subflow_plan: "plan_id",
  sys_hub_action_input_action_instance: "action_input",
};
function schema(tables: Record<string, Row[]>, captured: BuiltUnit) {
  draftSchemas(tables);
  const definitions = tables["sys_db_object"] ?? [];
  const dictionary = tables["sys_dictionary"] ?? [];
  let sequence = 9000;
  for (const table of new Set(captured.children.map((row) => row.table))) {
    if (!definitions.some((row) => row["name"] === table))
      definitions.push({
        sys_id: (++sequence).toString(16).padStart(32, "0"),
        name: table,
        super_class: "",
      });
    const fields = new Set([
      "sys_id",
      EXTRA[table] ?? "",
      ...captured.children
        .filter((row) => row.table === table)
        .flatMap((row) => Object.keys(row.fields)),
    ]);
    for (const element of fields)
      if (element && !dictionary.some((row) => row["name"] === table && row["element"] === element))
        dictionary.push({
          sys_id: (++sequence).toString(16).padStart(32, "0"),
          name: table,
          element,
          internal_type: "string",
          reference: "",
          unique: "false",
        });
  }
  tables["sys_db_object"] = definitions;
  tables["sys_dictionary"] = dictionary;
}
async function fixture(id: string) {
  const name = `sys_hub_flow_${id}`;
  const unit = builtUnitOf(`${name}.xml`, await Bun.file(new URL(`${id}-built.xml`, ROOT)).text());
  const payload = await Bun.file(new URL(`${id}-capture.xml`, ROOT)).text();
  const content = decodeCapture(name, payload);
  if (!content) throw new Error("Original complete native capture required");
  const head = content.unit.head.fields;
  const tables: Record<string, Row[]> = {
    sys_hub_flow: [head],
    sys_update_xml: [{ sys_id: "f".repeat(32), name, update_set: "original", payload }],
  };
  for (const row of content.unit.children.filter((row) => row.sysId)) {
    const rows = tables[row.table] ?? [];
    rows.push(row.fields);
    tables[row.table] = rows;
  }
  schema(tables, content.unit);
  const setup = unitSetup({ ledger: null });
  Object.assign(setup.tables, tables);
  setup.tables["sys_update_set"]?.push({
    sys_id: "original",
    name: "snagentic: feature/p1",
    state: "in progress",
    application: "global",
  });
  setup.builds.set(setup.project.path, [unit]);
  const native = setup.fake;
  const copy = { head, children: [], version: versionOf(head, []), foreignRows: 0 };
  const pending = {
    project: setup.project.path,
    updateName: name,
    digest: unitDigest(unit),
    updateSet: "original",
    before: null,
    operation: "create" as const,
    removes: null,
  };
  await setup.journal.write({
    planId: "interrupted",
    mirrorCommit: "c0ffee",
    startedAt: "2026-11-17T13:38:09Z",
    instance: QUERY.instance,
    url: setup.deps.url,
    label: await setup.deps.workspace.branch(),
    preferences: [],
    steps: [],
    pending: [pending],
  });
  const run = async () => (await computeUnitPlan({ ...setup.deps, decodeCapture }, QUERY)).plan;
  return { native, pending, copy, run, id };
}
for (const id of IDS)
  it(`proves original complete native draft ${id} with empty cleanup directives`, async () => {
    const c = await fixture(id);
    const plan = await c.run();
    expect(plan.problems).toEqual([]);
    expect(plan.ready).toBe(true);
    expect(plan.units).toHaveLength(1);
    expect(plan.units[0]).toMatchObject({
      updateName: c.pending.updateName,
      operation: "load",
      version: c.copy.version,
    });
  });
for (const [table, owner] of Object.entries(EXTRA))
  it(`refuses an unexpected live ${table} row despite an empty cleanup directive`, async () => {
    const c = await fixture(IDS[table === "sys_hub_action_input_action_instance" ? 1 : 4] ?? "");
    c.native.tables[table] = [
      {
        sys_id: "e".repeat(32),
        [owner]: table === "sys_choice" ? `var__m_sys_hub_flow_input_${c.id}` : c.id,
      },
    ];
    const plan = await c.run();
    expect(plan.ready).toBe(false);
    expect(plan.problems).toContainEqual(
      expect.objectContaining({ updateName: c.pending.updateName, kind: "unsafe" }),
    );
    expect(c.native.queries.some((query) => query.table === table)).toBe(true);
  });

import { afterEach, expect, it } from "bun:test";
import { runCli } from "../../src/cli/run-cli";
import { executeUseCase } from "../../src/registry/execute";
import { queryAggregate } from "../../src/registry/query-aggregate";
import { queryRecord } from "../../src/registry/query-record";
import { querySchema } from "../../src/registry/query-schema";
import { queryTable } from "../../src/registry/query-table";
import { instanceWorkspace } from "../support/instance-workspace";

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
});

it("every live operation verifies production roles before reading schema or records", async () => {
  const ws = await instanceWorkspace({}, "production");
  cleanups.push(ws.cleanup);
  const args = {
    instance: "pdi",
    table: "incident",
    fields: ["sys_id"],
    query: "sys_id=0123456789abcdef0123456789abcdef",
    sysId: "0123456789abcdef0123456789abcdef",
  };
  for (const useCase of [queryTable, queryRecord, querySchema, queryAggregate]) {
    await expect(executeUseCase(useCase, args, ws.context)).rejects.toMatchObject({
      code: "read-only-credential-required",
    });
  }
  expect(
    ws.instance.queries.filter(
      (query) => query.table === "incident" || query.table === "sys_db_object",
    ),
  ).toHaveLength(0);
  expect(ws.instance.writes).toHaveLength(0);
});

it("serves and renders every live query through the generated CLI without pulling metadata", async () => {
  const id = "0123456789abcdef0123456789abcdef";
  const ws = await instanceWorkspace({
    sys_db_object: [{ sys_id: id, name: "incident", super_class: "" }],
    sys_dictionary: [
      {
        sys_id: id,
        name: "incident",
        element: "number",
        internal_type: "string",
        unique: "true",
        reference: "",
      },
    ],
    incident: [{ sys_id: id, number: "INC001" }],
  });
  cleanups.push(ws.cleanup);
  for (const [command, flags, expected] of [
    ["table", ["--fields", "number", "--query", `sys_id=${id}`], { rows: [{ number: "INC001" }] }],
    ["record", ["--fields", "number", "--sys-id", id], { record: { number: "INC001" } }],
    [
      "schema",
      [],
      {
        complete: true,
        fields: expect.arrayContaining([expect.objectContaining({ name: "number" })]),
      },
    ],
    ["aggregate", ["--query", `sys_id=${id}`], { count: 1, groups: [] }],
  ] as const) {
    let stdout = "";
    let stderr = "";
    const code = await runCli(
      ["query", command, "--instance", "pdi", "--table", "incident", ...flags],
      [queryTable, queryRecord, querySchema, queryAggregate],
      ws.context,
      {
        stdout: (text) => {
          stdout += text;
        },
        stderr: (text) => {
          stderr += text;
        },
      },
      { version: "test", serveMcp: async () => {} },
    );
    expect({ code, stderr }).toEqual({ code: 0, stderr: "" });
    expect(JSON.parse(stdout)).toMatchObject(expected);
  }
  expect(ws.instance.writes).toHaveLength(0);
});

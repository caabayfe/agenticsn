import { afterEach, expect, it } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { InstanceName } from "@snagentic/core";
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

const USE_CASES = [queryTable, queryRecord, querySchema, queryAggregate];
const ARGS = {
  instance: "pdi",
  table: "incident",
  fields: ["sys_id"],
  query: "sys_id=0123456789abcdef0123456789abcdef",
  sysId: "0123456789abcdef0123456789abcdef",
};

async function enableLiveQueries(ws: Awaited<ReturnType<typeof instanceWorkspace>>) {
  const profile = await ws.context.profiles.read(ws.root, InstanceName.parse("pdi"));
  if (profile === null) throw new Error("the workspace has no pdi profile");
  await ws.context.profiles.write(ws.root, { ...profile, liveQueries: { enabled: true } });
}

for (const kind of ["test", "production"] as const) {
  it(`refuses every live query on a ${kind} instance before any request unless instance.yaml enables it`, async () => {
    const ws = await instanceWorkspace({}, kind);
    cleanups.push(ws.cleanup);
    for (const useCase of USE_CASES) {
      await expect(executeUseCase(useCase, ARGS, ws.context)).rejects.toMatchObject({
        code: "live-queries-disabled",
        hint: expect.stringContaining("instances/pdi/instance.yaml"),
      });
    }
    expect(ws.instance.queries).toHaveLength(0);
  });
}

it("every live operation verifies production roles before reading schema or records", async () => {
  const ws = await instanceWorkspace({}, "production");
  cleanups.push(ws.cleanup);
  await enableLiveQueries(ws);
  for (const useCase of USE_CASES) {
    await expect(executeUseCase(useCase, ARGS, ws.context)).rejects.toMatchObject({
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
  const log = await readFile(join(ws.root, ".snagentic/pdi/live-queries.jsonl"), "utf8");
  expect(log).not.toContain(id);
  expect(
    log
      .trimEnd()
      .split("\n")
      .map((line) => JSON.parse(line)),
  ).toMatchObject([
    { instance: "pdi", user: "admin", operation: "table", table: "incident" },
    { operation: "record", filter: [{ field: "sys_id", operator: "=" }] },
    { operation: "schema", filter: [] },
    { operation: "aggregate", filter: [{ field: "sys_id", operator: "=" }] },
  ]);
});

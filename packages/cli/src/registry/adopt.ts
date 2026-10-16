import {
  adopt as adoptRecords,
  InvalidRecordReferenceError,
  LOSS_DESCRIPTIONS,
  SdkUnavailableError,
} from "@snagentic/core";
import { z } from "zod";
import { connect } from "./connect";
import { instanceFor } from "./knowledge-session";
import { defineUseCase } from "./use-case";
import { workspaceRoot } from "./workspace-root";

const SYS_ID = /([0-9a-f]{32})(?!.*[0-9a-f]{32})/;

// A record as an agent names it: a mirror path, table:sys_id, or a bare sys_id. The class comes
// from the instance.
function targetOf(reference: string) {
  const sysId = SYS_ID.exec(reference)?.[1];
  if (sysId === undefined) throw new InvalidRecordReferenceError(reference);
  return { table: "", sysId };
}

export const adopt = defineUseCase({
  name: "adopt",
  description:
    "Bring records from a development instance into the workspace's Fluent source, to edit " +
    "them there (ADR-0031). The SDK converts each record; snagentic builds the result and " +
    "checks it would rebuild what the instance holds before writing anything. Writes " +
    "source/<scope>/ and its ledger; commit them. Name records by mirror path, table:sys_id or sys_id.",
  input: z.object({
    instance: z.string().optional().describe("default: the workspace's only instance"),
    records: z.array(z.string()).min(1).describe("mirror paths, table:sys_id, or sys_ids"),
  }),
  output: z.object({
    instance: z.string(),
    projects: z.array(z.object({ path: z.string(), created: z.boolean() })).readonly(),
    units: z
      .array(
        z.object({
          project: z.string(),
          updateName: z.string(),
          table: z.string(),
          losses: z.array(z.string()).readonly(),
        }),
      )
      .readonly(),
    files: z.array(z.string()).readonly(),
  }),
  flags: { readOnly: false, destructive: false, requiresDevelopmentInstance: true },
  mcp: false,
  arguments: ["records"],
  async handle(input, context, run) {
    const records = input.records.map(targetOf);
    const instance = await instanceFor(await workspaceRoot(context), context, input.instance);
    const connection = await connect(context, instance, run.signal);
    if (connection.reader.sdkAccess === undefined) throw new SdkUnavailableError(instance);
    const { workspace, toolchain } = context.authoring(connection.root);
    run.progress({ message: "converting the records with the ServiceNow SDK" });
    const result = await adoptRecords(
      {
        reader: connection.reader,
        workspace,
        toolchain,
        access: connection.reader.sdkAccess(run.signal),
        signal: run.signal,
      },
      { instance: connection.name, records },
    );
    return { instance: connection.name, ...result };
  },
  render(output) {
    const losses = new Set(output.units.flatMap((u) => u.losses));
    return [
      ...output.projects.filter((p) => p.created).map((p) => `created ${p.path}`),
      ...output.units.map(
        (u) =>
          `adopted ${u.updateName}${u.losses.length > 0 ? `  (also sets: ${u.losses.join(", ")})` : ""}`,
      ),
      ...[...losses].map(
        (loss) =>
          `  ${loss}: ${Object.entries(LOSS_DESCRIPTIONS).find(([id]) => id === loss)?.[1] ?? ""}`,
      ),
      `${output.files.length} source file(s) written; review and commit them with the ledger`,
    ].join("\n");
  },
  exitCode: () => 0,
});

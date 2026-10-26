import { InvalidRecordReferenceError, takeOver as takeOverRecords } from "@snagentic/core";
import { z } from "zod";
import { connect } from "./connect";
import { defineUseCase } from "./use-case";

const TARGET = /^([a-z0-9_]+):([0-9a-f]{32})$/;

function targetOf(reference: string) {
  const match = TARGET.exec(reference);
  if (match === null) throw new InvalidRecordReferenceError(reference);
  const [, table = "", sysId = ""] = match;
  return { table, sysId };
}

const Record = z.object({ table: z.string(), sysId: z.string() });
const Named = Record.extend({ updateName: z.string(), project: z.string() });

export const takeOver = defineUseCase({
  name: "take-over",
  description:
    "Take over out-of-box records the workspace's source declares whole, such as a form " +
    "layout (ADR-0038 item 8). A record still as the platform shipped it (no customer update) " +
    "is recorded in the ledger as this branch's, so the next plan loads the source over it. A " +
    "record the client customized is refused and nothing is written. Name records table:sys_id.",
  input: z.object({
    instance: z.string().describe("the development instance holding the records"),
    records: z.array(z.string()).min(1).describe("out-of-box records, as table:sys_id"),
    restated: z
      .array(z.string())
      .default([])
      .describe(
        "records among them whose source restates the instance's copy as it is now (a form section an accelerator adds a field to): taken over even when customized",
      ),
  }),
  output: z.object({
    instance: z.string(),
    taken: z.array(Named).readonly(),
    owned: z.array(z.string()).readonly(),
    customized: z.array(Named).readonly(),
    absent: z.array(Record).readonly(),
  }),
  flags: { readOnly: false, destructive: false, requiresDevelopmentInstance: true },
  mcp: false,
  arguments: ["records"],
  async handle(input, context, run) {
    const records = input.records.map(targetOf);
    const connection = await connect(context, input.instance, run.signal);
    const { workspace, toolchain } = context.authoring(connection.root);
    run.progress({ message: "building the source and reading the instance" });
    const result = await takeOverRecords(
      { reader: connection.reader, workspace, toolchain, signal: run.signal },
      { instance: connection.name, records, restated: input.restated.map(targetOf) },
    );
    return { instance: connection.name, ...result };
  },
  render(output) {
    return [
      ...output.taken.map((r) => `taken over ${r.table} ${r.sysId} (as ${r.updateName})`),
      ...output.owned.map((name) => `already this branch's: ${name}`),
      ...output.customized.map(
        (r) => `refused ${r.table} ${r.sysId}: customized on the instance (${r.updateName})`,
      ),
      ...output.absent.map(
        (r) => `refused ${r.table} ${r.sysId}: no record of the source matches it on the instance`,
      ),
      output.taken.length > 0 ? "next: plan_push loads the source over the taken records" : "",
    ]
      .filter(Boolean)
      .join("\n");
  },
  exitCode: (output) => (output.customized.length > 0 || output.absent.length > 0 ? 1 : 0),
});

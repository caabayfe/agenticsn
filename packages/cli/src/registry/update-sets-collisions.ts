import { updateSetCollisions } from "@snagentic/core";
import { z } from "zod";
import { connect } from "./connect";
import { defineUseCase } from "./use-case";

const Holder = z.object({
  updateSet: z.string(),
  updateSetName: z.string(),
  updatedBy: z.string(),
  updatedOn: z.string(),
  action: z.string(),
});

export const updateSetsCollisions = defineUseCase({
  group: "update-sets",
  name: "collisions",
  description:
    "Find records captured in more than one open update set (the last one committed wins). " +
    "Exits with 1 when there are any, so CI can stop on them.",
  input: z.object({ instance: z.string() }),
  output: z.object({
    instance: z.string(),
    openSets: z.number(),
    openRecords: z.number(),
    defaultSetRecords: z.number(),
    collisions: z.array(
      z.object({
        record: z.string(),
        type: z.string(),
        targetName: z.string(),
        holders: z.array(Holder),
      }),
    ),
  }),
  flags: { readOnly: true, destructive: false, requiresDevelopmentInstance: false },
  mcp: false,
  arguments: ["instance"],
  async handle(input, context, run) {
    const { name, pager, reader } = await connect(context, input.instance);
    const deps = { pager, statistics: reader, now: context.clock };
    const report = await updateSetCollisions(deps, run.signal);
    return {
      instance: name,
      ...report,
      collisions: report.collisions.map((c) => ({ ...c, holders: [...c.holders] })),
    };
  },
  render(output) {
    const header = `${output.instance}: ${output.collisions.length} collisions among ${output.openRecords} records in ${output.openSets} open update sets (${output.defaultSetRecords} more only in default sets)`;
    return [
      header,
      ...output.collisions.flatMap((c) => [
        `  ${c.type}: ${c.targetName} [${c.record}]`,
        ...c.holders.map((h) => `    ${h.updatedOn}  ${h.updatedBy.padEnd(12)} ${h.updateSetName}`),
      ]),
    ].join("\n");
  },
  exitCode: (output) => (output.collisions.length > 0 ? 1 : 0),
});

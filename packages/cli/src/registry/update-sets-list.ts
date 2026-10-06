import { listUpdateSets } from "@snagentic/core";
import { z } from "zod";
import { connect } from "./connect";
import { defineUseCase } from "./use-case";

const Summary = z.object({
  sysId: z.string(),
  name: z.string(),
  state: z.string(),
  application: z.string(),
  owner: z.string(),
  updates: z.number(),
  isDefault: z.boolean(),
  updatedOn: z.string(),
});

export const UpdateSetSummary = Summary;

export const updateSetsList = defineUseCase({
  group: "update-sets",
  name: "list",
  description:
    "List open update sets and those changed in the last days, with their update counts.",
  input: z.object({
    instance: z.string(),
    days: z.number().int().min(0).default(30).describe("also list sets changed in this many days"),
  }),
  output: z.object({ instance: z.string(), updateSets: z.array(Summary) }),
  flags: { readOnly: true, destructive: false, requiresDevelopmentInstance: false },
  mcp: false,
  arguments: ["instance"],
  async handle(input, context, run) {
    const { name, pager, reader } = await connect(context, input.instance);
    const deps = { pager, statistics: reader, now: context.clock };
    return { instance: name, updateSets: await listUpdateSets(deps, input.days, run.signal) };
  },
  render(output) {
    if (output.updateSets.length === 0) {
      return `${output.instance}: no open or recently changed update sets`;
    }
    return output.updateSets
      .map(
        (set) =>
          `${set.sysId}  ${set.state.padEnd(11)}  ${String(set.updates).padStart(5)} updates  ${set.application}  ${set.owner}  ${set.updatedOn}  ${set.name}${set.isDefault ? " (default)" : ""}`,
      )
      .join("\n");
  },
  exitCode: () => 0,
});

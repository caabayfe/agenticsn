import { showUpdateSet } from "@snagentic/core";
import { z } from "zod";
import { connect } from "./connect";
import { UpdateSetSummary } from "./update-sets-list";
import { defineUseCase } from "./use-case";
import { HELP_GROUPS } from "./use-case-help";

const Entry = z.object({
  sysId: z.string(),
  name: z.string(),
  type: z.string(),
  targetName: z.string(),
  action: z.string(),
  table: z.string(),
  updatedBy: z.string(),
  updatedOn: z.string(),
});

export const updateSetsShow = defineUseCase({
  help: {
    summary: "Inspect an update set and its updates",
    section: "Manage",
    group: HELP_GROUPS.updateSets,
    details: "Show update types, actions, targets, authors and dates without payloads.",
    effects: "Reads the instance; makes no instance changes.",
    examples: [["update-sets", "show", "dev", "0123456789abcdef0123456789abcdef"]],
  },
  group: "update-sets",
  name: "show",
  description:
    "Show one update set and its updates (type, action, target, author, date), without payloads.",
  input: z.object({ instance: z.string(), id: z.string().describe("the update set's sys_id") }),
  output: z.object({ instance: z.string(), updateSet: UpdateSetSummary, updates: z.array(Entry) }),
  flags: { readOnly: true, destructive: false, requiresDevelopmentInstance: false },
  mcp: false,
  arguments: ["instance", "id"],
  async handle(input, context, run) {
    const { name, pager, reader } = await connect(context, input.instance, run.signal);
    const deps = { pager, statistics: reader, now: context.clock };
    const shown = await showUpdateSet(deps, name, input.id, run.signal);
    return { instance: name, ...shown };
  },
  render(output) {
    const set = output.updateSet;
    return [
      `${set.name} (${set.state}, ${set.application}, owner ${set.owner}, ${set.updates} updates)`,
      ...output.updates.map(
        (u) =>
          `  ${u.action.padEnd(16)} ${u.type.padEnd(24)} ${u.targetName}  [${u.name}] ${u.updatedBy} ${u.updatedOn}`,
      ),
    ].join("\n");
  },
  exitCode: () => 0,
});

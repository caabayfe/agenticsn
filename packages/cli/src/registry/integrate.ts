import { driftedUnits, getInstance, InstanceName } from "@snagentic/core";
import { z } from "zod";
import { defineUseCase } from "./use-case";
import { workspaceRoot } from "./workspace-root";

export const integrate = defineUseCase({
  name: "integrate",
  description:
    "Merge the latest pull of an instance into the workspace's current branch. The mirror is " +
    "read-only, so the instance's copy always wins there; a local edit to it is discarded and " +
    "named. Reports adopted units the instance changed since they last agreed with source " +
    "(drift): run adopt --refresh on them before planning.",
  input: z.object({ instance: z.string() }),
  output: z.object({
    instance: z.string(),
    commit: z.string().nullable(),
    changedFiles: z.number(),
    discarded: z.array(z.string()).readonly().describe("local edits to the mirror, replaced"),
    drift: z
      .array(z.string())
      .readonly()
      .describe("adopted units changed on the instance: snagentic adopt --refresh them"),
  }),
  flags: { readOnly: false, destructive: false, requiresDevelopmentInstance: false },
  mcp: false,
  arguments: ["instance"],
  async handle(input, context, run) {
    const root = await workspaceRoot(context);
    const name = InstanceName.parse(input.instance);
    await getInstance(root, name, context.profiles);
    const { workspace } = context.authoring(root);
    const ledgers = await Promise.all(
      (await workspace.projects()).map((p) => workspace.readLedger(p)),
    );
    // Only the records adopted units track are read for drift: none in a workspace that
    // adopted nothing, where a first integrate changes every record.
    const adopted = new Set(ledgers.flatMap((ledger) => [...(ledger.get(name)?.keys() ?? [])]));
    const result = await context.integrator.integrate(root, name, {
      adopted,
      progress: run.progress,
    });
    const drift = driftedUnits(result.pulled, ledgers, name);
    return {
      instance: name,
      commit: result.commit,
      changedFiles: result.changedFiles,
      discarded: result.discarded,
      drift,
    };
  },
  render(output) {
    if (output.commit === null) {
      return `${output.instance}: already up to date`;
    }
    return [
      ...output.discarded.map((path) => `discarded a local edit to the mirror: ${path}`),
      ...output.drift.map(
        (unit) =>
          `changed on the instance: ${unit}; run snagentic adopt --refresh --instance ${output.instance} on it`,
      ),
      `${output.instance}: integrated ${output.changedFiles} changed file(s) -> ${output.commit.slice(0, 10)}`,
    ].join("\n");
  },
  exitCode: () => 0,
});

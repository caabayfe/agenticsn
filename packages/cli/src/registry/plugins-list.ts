import { InstanceName, listPlugins, NothingPulledError } from "@snagentic/core";
import { z } from "zod";
import { defineUseCase } from "./use-case";
import { workspaceRoot } from "./workspace-root";

const SHOWN = 200;

export const pluginsList = defineUseCase({
  group: "plugins",
  name: "list",
  description:
    "List installed and available plugins and store applications with their versions, from the " +
    "inventory of the last pull (no call to the instance).",
  input: z.object({
    instance: z.string(),
    text: z.string().optional().describe("only those whose id, scope or name contains this"),
    state: z.enum(["active", "inactive", "all"]).default("all").describe("filter by state"),
  }),
  output: z.object({
    instance: z.string(),
    asOf: z.string().nullable(),
    plugins: z.array(
      z.object({
        id: z.string(),
        name: z.string(),
        active: z.boolean(),
        version: z.string(),
        scope: z.string(),
      }),
    ),
    storeApps: z.array(
      z.object({
        scope: z.string(),
        name: z.string(),
        version: z.string(),
        active: z.boolean(),
        vendor: z.string(),
      }),
    ),
  }),
  flags: { readOnly: true, destructive: false, requiresDevelopmentInstance: false },
  mcp: true,
  mcpName: "plugins",
  arguments: ["instance", "text"],
  async handle(input, context) {
    const root = await workspaceRoot(context);
    const name = InstanceName.parse(input.instance);
    const filter = {
      state: input.state,
      ...(input.text === undefined ? {} : { text: input.text }),
    };
    const found = await listPlugins(
      context.inventory,
      context.syncState(root, name),
      root,
      name,
      filter,
    );
    if (found === null) {
      throw new NothingPulledError(name);
    }
    return {
      instance: name,
      asOf: found.asOf,
      plugins: [...found.plugins],
      storeApps: [...found.storeApps],
    };
  },
  render(output) {
    const state = (active: boolean) => (active ? "active  " : "inactive");
    const lines = [
      ...output.plugins.map(
        (p) => `plugin     ${state(p.active)}  ${p.version.padEnd(10)}  ${p.id}  (${p.name})`,
      ),
      ...output.storeApps.map(
        (a) => `store app  ${state(a.active)}  ${a.version.padEnd(10)}  ${a.scope}  (${a.name})`,
      ),
    ];
    const more =
      lines.length > SHOWN
        ? [`... and ${lines.length - SHOWN} more; narrow with a search text or --state`]
        : [];
    return [
      `${output.instance}: ${output.plugins.length} plugins, ${output.storeApps.length} store apps (inventory as of ${output.asOf ?? "unknown"} UTC; refresh with: snagentic pull ${output.instance})`,
      ...lines.slice(0, SHOWN),
      ...more,
    ].join("\n");
  },
  exitCode: () => 0,
});

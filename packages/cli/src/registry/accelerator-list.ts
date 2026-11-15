import { listPacks } from "@snagentic/core";
import { z } from "zod";
import { PackSummary } from "./accelerator-schemas";
import { defineUseCase } from "./use-case";
import { HELP_GROUPS } from "./use-case-help";

export const acceleratorList = defineUseCase({
  help: {
    summary: "List packs, modules and profiles",
    section: "Additional workflows",
    group: HELP_GROUPS.accelerator,
    details:
      "Discover bundled accelerator packs and packs configured in the workspace. Lists their " +
      "modules and installation profiles.",
    effects: "Reads local pack definitions; does not call the instance.",
    examples: [["accelerator", "list"]],
  },
  group: "accelerator",
  name: "list",
  description:
    "List the accelerator packs snagentic ships and those under the workspace's pack paths " +
    "(snagentic.yaml accelerators.paths), with their modules and profiles (ADR-0026, ADR-0038).",
  input: z.object({}),
  output: z.object({ packs: z.array(PackSummary).readonly() }),
  flags: { readOnly: true, destructive: false, requiresDevelopmentInstance: false },
  mcp: false,
  async handle(_input, context) {
    return { packs: await listPacks(context.packs) };
  },
  render(output) {
    if (output.packs.length === 0) return "no accelerator packs";
    return output.packs
      .flatMap((p) => [
        `${p.id} ${p.version}`,
        ...p.modules.map((m) => `  module   ${m.id}  ${m.label}`),
        ...Object.entries(p.profiles).map(([id, ms]) => `  profile  ${id}: ${ms.join(", ")}`),
      ])
      .join("\n");
  },
  exitCode: () => 0,
});

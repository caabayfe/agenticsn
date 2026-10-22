import { listPacks } from "@snagentic/core";
import { z } from "zod";
import { PackSummary } from "./accelerator-schemas";
import { defineUseCase } from "./use-case";

export const acceleratorList = defineUseCase({
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

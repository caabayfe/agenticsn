import { listPacks } from "@snagentic/core";
import { z } from "zod";
import { defineUseCase } from "./use-case";

export const PackSummary = z.object({
  id: z.string(),
  version: z.string(),
  scope: z.string(),
  capabilities: z
    .array(z.object({ id: z.string(), wave: z.number(), label: z.string() }))
    .readonly(),
});

export const acceleratorList = defineUseCase({
  group: "accelerator",
  name: "list",
  description:
    "List the accelerator packs snagentic ships, with their capabilities and waves (ADR-0026).",
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
        `${p.id} ${p.version}  (${p.scope})`,
        ...p.capabilities.map((c) => `  wave ${c.wave}  ${c.id}  ${c.label}`),
      ])
      .join("\n");
  },
  exitCode: () => 0,
});

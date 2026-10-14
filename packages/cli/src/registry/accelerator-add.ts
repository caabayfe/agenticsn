import { addPack, InstanceName, VERSION } from "@snagentic/core";
import { z } from "zod";
import { defineUseCase } from "./use-case";
import { workspaceRoot } from "./workspace-root";

export const acceleratorAdd = defineUseCase({
  group: "accelerator",
  name: "add",
  description:
    "Write an accelerator pack's capabilities into the workspace (ADR-0026): new records as " +
    "files, patches on the mirrored records, committed to the branch accelerator/<pack>/" +
    "<instance> and merged into this one. Changes nothing on the instance: validate, plan_push " +
    "and push deliver it. Refuses until accelerator check says every capability is ready.",
  input: z.object({
    pack: z.string(),
    instance: z.string(),
    waves: z.array(z.number()).optional().describe("add these waves (default: all)"),
    capabilities: z.array(z.string()).optional().describe("add these capabilities"),
  }),
  output: z.object({
    pack: z.string(),
    version: z.string(),
    selected: z.array(z.string()).readonly(),
    branch: z.string(),
    commit: z.string(),
    copied: z.number(),
    patched: z.number(),
    conflicts: z.array(z.string()).readonly(),
  }),
  flags: { readOnly: false, destructive: false, requiresDevelopmentInstance: false },
  mcp: false,
  arguments: ["pack", "instance"],
  async handle(input, context) {
    const root = await workspaceRoot(context);
    const name = InstanceName.parse(input.instance);
    return addPack(
      {
        packs: context.packs,
        inventory: context.inventory,
        workspace: context.packWorkspace(root, name),
      },
      {
        pack: input.pack,
        instance: { root, name },
        snagentic: VERSION,
        ...(input.waves === undefined ? {} : { waves: input.waves }),
        ...(input.capabilities === undefined ? {} : { capabilities: input.capabilities }),
      },
    );
  },
  render(output) {
    const added = `added ${output.pack} ${output.version} (${output.selected.join(", ")}): ${output.copied} new file(s), ${output.patched} patched, merged from ${output.branch}`;
    return output.conflicts.length === 0
      ? `${added}\nnext: snagentic validate, then snagentic plan-push`
      : [
          added,
          ...output.conflicts.map((c) => `conflict: ${c}`),
          "resolve the conflicts, commit, then snagentic validate",
        ].join("\n");
  },
  exitCode: (output) => (output.conflicts.length === 0 ? 0 : 1),
});

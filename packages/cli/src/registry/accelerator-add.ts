import { addPack, InstanceName, VERSION } from "@snagentic/core";
import { z } from "zod";
import { defineUseCase } from "./use-case";
import { workspaceRoot } from "./workspace-root";

export const acceleratorAdd = defineUseCase({
  group: "accelerator",
  name: "add",
  description:
    "Write an accelerator pack's capabilities into the workspace (ADR-0026, ADR-0031): their " +
    "Fluent source into the projects under source/, committed to the branch accelerator/<pack>/" +
    "<instance> and merged into this one, and the out-of-box records they customize, to adopt " +
    "and edit next. Changes nothing on the instance: validate, plan_push and push deliver it. " +
    "Refuses until accelerator check says every capability is ready.",
  input: z.object({
    pack: z.string(),
    instance: z.string(),
    waves: z.array(z.number()).optional().describe("add these waves (default: all)"),
    capabilities: z.array(z.string()).optional().describe("add these capabilities"),
  }),
  output: z.object({
    pack: z.string(),
    instance: z.string(),
    version: z.string(),
    selected: z.array(z.string()).readonly(),
    branch: z.string(),
    commit: z.string(),
    copied: z.array(z.string()).readonly().describe("Fluent source files written"),
    adoptions: z
      .array(
        z.object({
          capability: z.string(),
          table: z.string(),
          sysId: z.string(),
          note: z.string(),
        }),
      )
      .readonly()
      .describe("out-of-box records to adopt, then edit as the note says"),
    removed: z.array(z.string()).readonly(),
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
    const added = [
      `added ${output.pack} ${output.version} (${output.selected.join(", ")}): ${output.copied.length} file(s), merged from ${output.branch}`,
      ...output.copied.map((path) => `  ${path}`),
    ];
    const removed = output.removed.map(
      (r) => `no longer in the pack, kept: ${r} (snagentic never deletes; remove it yourself)`,
    );
    const adopt = output.adoptions.map(
      (a) =>
        `next (${a.capability}): snagentic adopt --instance ${output.instance} ${a.table}:${a.sysId}, then ${a.note}`,
    );
    const last =
      output.conflicts.length === 0
        ? ["next: snagentic validate, then snagentic plan-push"]
        : [
            ...output.conflicts.map((c) => `conflict: ${c}`),
            "resolve the conflicts, commit, then snagentic validate",
          ];
    return [...added, ...removed, ...adopt, ...last].join("\n");
  },
  exitCode: (output) => (output.conflicts.length === 0 ? 0 : 1),
});

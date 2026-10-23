import { checkPack, InstanceName, listPacks, VERSION } from "@snagentic/core";
import { z } from "zod";
import { PackSummary, SelectionInput, selectionOf } from "./accelerator-schemas";
import { defineUseCase } from "./use-case";
import { workspaceRoot } from "./workspace-root";

const Module = z.object({
  id: z.string(),
  state: z.enum(["ready", "needs-components", "not-entitled", "blocked"]),
  components: z
    .array(
      z.object({
        kind: z.enum(["plugin", "app"]),
        id: z.string(),
        state: z.enum(["active", "inactive", "missing", "too-old"]),
        version: z.string().nullable(),
        minVersion: z.string().nullable(),
        entitlement: z.enum(["free", "licensed"]),
      }),
    )
    .readonly(),
  next: z.array(z.string()).readonly().describe("commands that make it installable by hand"),
  waitsOn: z.array(z.string()).readonly().describe("modules it depends on that are not ready"),
  installable: z
    .boolean()
    .describe("accelerator install can install it: it lacks only plugins the install activates"),
});

const activatedNote = (c: { kind: string; state: string }) =>
  c.kind === "plugin" && c.state === "inactive" ? " (accelerator install activates it)" : "";

export const acceleratorCheck = defineUseCase({
  group: "accelerator",
  name: "check",
  description:
    "Accelerator packs (ADR-0026, ADR-0038): without a pack, list them; with one, the modules " +
    "a profile or a list installs and, with an instance, whether they can be installed there: " +
    "each module's state (ready, needs-components, not-entitled, blocked) and the exact " +
    "commands that fix it. Reads the mirror only, never the instance.",
  input: z.object({
    pack: z.string().optional().describe("the pack id; omit to list the packs"),
    instance: z.string().optional().describe("check against this instance's mirrored components"),
    ...SelectionInput,
  }),
  output: z.object({
    packs: z.array(PackSummary).readonly(),
    selected: z.array(z.string()).readonly(),
    unknown: z.array(z.string()).readonly(),
    data: z.array(z.string()).readonly().describe("data entities to load, in order"),
    problems: z.array(z.string()).readonly(),
    warnings: z.array(z.string()).readonly(),
    modules: z.array(Module).readonly(),
  }),
  flags: { readOnly: true, destructive: false, requiresDevelopmentInstance: false },
  mcp: true,
  mcpName: "accelerator",
  arguments: ["pack"],
  async handle(input, context) {
    const empty = { selected: [], unknown: [], data: [], problems: [], warnings: [], modules: [] };
    if (input.pack === undefined) return { packs: await listPacks(context.packs), ...empty };
    const instance =
      input.instance === undefined
        ? undefined
        : { root: await workspaceRoot(context), name: InstanceName.parse(input.instance) };
    const result = await checkPack(
      { packs: context.packs, inventory: context.inventory },
      {
        pack: input.pack,
        snagentic: VERSION,
        ...(instance === undefined ? {} : { instance }),
        ...selectionOf(input),
      },
    );
    return {
      packs: [result.pack],
      selected: result.selected,
      unknown: result.unknown,
      data: result.data,
      problems: result.report?.problems ?? [],
      warnings: result.report?.warnings ?? [],
      modules: result.report?.capabilities ?? [],
    };
  },
  render(output) {
    const [pack] = output.packs;
    if (pack === undefined || output.selected.length === 0) {
      return output.packs.map((p) => `${p.id} ${p.version}`).join("\n") || "no accelerator packs";
    }
    return [
      `${pack.id} ${pack.version}: installs ${output.selected.join(", ")}`,
      ...output.unknown.map((u) => `unknown: ${u}`),
      ...output.problems.map((p) => `problem: ${p}`),
      ...output.warnings.map((w) => `warning: ${w}`),
      ...output.modules.flatMap((m) => [
        `${m.state.padEnd(16)} ${m.id}`,
        ...m.components
          .filter((c) => c.state !== "active")
          .map((c) => `  ${c.kind} ${c.id}: ${c.state}${activatedNote(c)}`),
        ...(m.waitsOn.length === 0 ? [] : [`  waits on: ${m.waitsOn.join(", ")}`]),
        ...(m.installable ? [] : m.next.map((n) => `  next: ${n}`)),
      ]),
      output.data.length === 0 ? "" : `data to load, in order: ${output.data.join(", ")}`,
    ]
      .filter(Boolean)
      .join("\n");
  },
  exitCode: (output) =>
    output.problems.length + output.unknown.length > 0 || output.modules.some((m) => !m.installable)
      ? 1
      : 0,
});

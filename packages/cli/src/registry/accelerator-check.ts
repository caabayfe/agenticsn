import { checkPack, InstanceName, listPacks, VERSION } from "@snagentic/core";
import { z } from "zod";
import { PackSummary } from "./accelerator-list";
import { defineUseCase } from "./use-case";
import { workspaceRoot } from "./workspace-root";

const Capability = z.object({
  id: z.string(),
  wave: z.number(),
  state: z.enum(["ready", "needs-plugins", "not-entitled", "blocked"]),
  plugins: z
    .array(
      z.object({
        id: z.string(),
        state: z.enum(["active", "inactive", "missing", "too-old"]),
        version: z.string().nullable(),
        minVersion: z.string().nullable(),
      }),
    )
    .readonly(),
  next: z.array(z.string()).readonly().describe("commands that make it installable, in order"),
});

export const acceleratorCheck = defineUseCase({
  group: "accelerator",
  name: "check",
  description:
    "Accelerator packs (ADR-0026): without a pack, list them; with one, what its capabilities " +
    "install and, with an instance, whether they can be installed there: each capability's " +
    "state (ready, needs-plugins, not-entitled, blocked) and the exact commands that fix it. " +
    "Reads the mirror only, never the instance.",
  input: z.object({
    pack: z.string().optional().describe("the pack id; omit to list the packs"),
    instance: z.string().optional().describe("check against this instance's mirrored plugins"),
    waves: z.array(z.number()).optional().describe("install these waves (default: all)"),
    capabilities: z.array(z.string()).optional().describe("install these capabilities"),
  }),
  output: z.object({
    packs: z.array(PackSummary).readonly(),
    selected: z.array(z.string()).readonly(),
    unknown: z.array(z.string()).readonly(),
    data: z.array(z.string()).readonly().describe("data entities to load, in order"),
    problems: z.array(z.string()).readonly(),
    capabilities: z.array(Capability).readonly(),
  }),
  flags: { readOnly: true, destructive: false, requiresDevelopmentInstance: false },
  mcp: true,
  mcpName: "accelerator",
  arguments: ["pack"],
  async handle(input, context) {
    const empty = { selected: [], unknown: [], data: [], problems: [], capabilities: [] };
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
        ...(input.waves === undefined ? {} : { waves: input.waves }),
        ...(input.capabilities === undefined ? {} : { capabilities: input.capabilities }),
      },
    );
    return {
      packs: [result.pack],
      selected: result.selected,
      unknown: result.unknown,
      data: result.data,
      problems: result.report?.problems ?? [],
      capabilities: result.report?.capabilities ?? [],
    };
  },
  render(output) {
    const [pack] = output.packs;
    if (pack === undefined || output.selected.length === 0) {
      return output.packs.map((p) => `${p.id} ${p.version}`).join("\n") || "no accelerator packs";
    }
    return [
      `${pack.id} ${pack.version}: installs ${output.selected.join(", ")}`,
      ...output.unknown.map((u) => `unknown capability: ${u}`),
      ...output.problems.map((p) => `problem: ${p}`),
      ...output.capabilities.flatMap((c) => [
        `${c.state.padEnd(13)} ${c.id} (wave ${c.wave})`,
        ...c.plugins.filter((p) => p.state !== "active").map((p) => `  plugin ${p.id}: ${p.state}`),
        ...c.next.map((n) => `  next: ${n}`),
      ]),
      output.data.length === 0 ? "" : `data to load, in order: ${output.data.join(", ")}`,
    ]
      .filter(Boolean)
      .join("\n");
  },
  exitCode: (output) =>
    output.problems.length + output.unknown.length > 0 ||
    output.capabilities.some((c) => c.state !== "ready")
      ? 1
      : 0,
});

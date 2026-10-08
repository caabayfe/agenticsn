import { upgrade as upgradeBinary, VERSION } from "@snagentic/core";
import { z } from "zod";
import { defineUseCase } from "./use-case";
import { workspaceRoot } from "./workspace-root";

export const upgrade = defineUseCase({
  name: "upgrade",
  description:
    "Replace this snagentic with the latest release (or --to <version>), after checking it against " +
    "the release's SHA256SUMS and that it runs. Inside a workspace, also refreshes its agent " +
    "pack. Lists the upgrade steps of the releases skipped over. Run by a person, never by an " +
    "agent.",
  input: z.object({
    // Not `version`: the CLI's global --version would take it.
    to: z.string().optional().describe("the version to install (default: the latest)"),
  }),
  output: z.object({
    status: z.enum(["up-to-date", "upgraded"]),
    from: z.string(),
    to: z.string(),
    steps: z
      .array(z.object({ version: z.string(), sections: z.array(z.string()).readonly() }))
      .readonly(),
    workspace: z.string().nullable(),
    pack: z.array(z.string()).readonly(),
  }),
  flags: { readOnly: false, destructive: false, requiresDevelopmentInstance: false },
  mcp: false,
  async handle(input, context, run) {
    const root = await workspaceRoot(context).catch(() => null);
    const result = await upgradeBinary(
      {
        ...context.upgrade,
        workspaceFiles: context.workspaceFiles,
        current: VERSION,
        signal: run.signal,
      },
      {
        ...(input.to === undefined ? {} : { version: input.to }),
        ...(root === null ? {} : { workspace: root }),
      },
    );
    return result.status === "up-to-date"
      ? { status: result.status, from: VERSION, to: VERSION, steps: [], workspace: null, pack: [] }
      : { ...result, workspace: root };
  },
  render(output) {
    if (output.status === "up-to-date") {
      return `snagentic ${output.to} is the latest release`;
    }
    const lines = [`upgraded snagentic ${output.from} -> ${output.to}`];
    for (const step of output.steps) {
      lines.push("", `before you go on, from the ${step.version} release notes:`, ...step.sections);
    }
    if (output.pack.length > 0) {
      lines.push(
        "",
        `agent pack updated in ${output.workspace ?? "the workspace"}; commit: ${output.pack.join(" ")}`,
      );
    }
    return lines.join("\n");
  },
  exitCode: () => 0,
});

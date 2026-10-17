import { relative, resolve } from "node:path";
import { checkFiles } from "@snagentic/core";
import { z } from "zod";
import { defineUseCase } from "./use-case";
import { workspaceRoot } from "./workspace-root";

export const check = defineUseCase({
  name: "check",
  description:
    "Check whether files may be edited at all: the mirror of the instance, the ledgers, local " +
    "state and workspace configuration may not. Fast; host hooks run it around every edit. " +
    "What an edit to Fluent source introduces is validate's job.",
  input: z.object({
    paths: z.array(z.string()).min(1).describe("files, absolute or relative to the current folder"),
  }),
  output: z.object({
    protected: z.array(z.object({ path: z.string(), reason: z.string() })).readonly(),
    passed: z.boolean(),
  }),
  flags: { readOnly: true, destructive: false, requiresDevelopmentInstance: false },
  mcp: false,
  arguments: ["paths"],
  async handle(input, context) {
    const root = await workspaceRoot(context);
    const paths = input.paths.map((path) => relative(root, resolve(context.host.cwd, path)));
    return checkFiles({ paths });
  },
  render(output) {
    return [
      ...output.protected.map((p) => `protected: ${p.path}: ${p.reason}`),
      output.passed ? "check passed" : "check failed",
    ].join("\n");
  },
  exitCode: (output) => (output.passed ? 0 : 1),
});

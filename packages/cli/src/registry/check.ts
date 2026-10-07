import { relative, resolve } from "node:path";
import { checkFiles, InstanceName } from "@snagentic/core";
import { z } from "zod";
import { defineUseCase } from "./use-case";
import { workspaceRoot } from "./workspace-root";

export const check = defineUseCase({
  name: "check",
  description:
    "Check files around an edit: whether they may be edited at all (local state, child rows " +
    "and workspace configuration may not), and what the edit introduced (validate on those " +
    "records). Fast; host hooks run it after every edit.",
  input: z.object({
    paths: z.array(z.string()).min(1).describe("files, absolute or relative to the current folder"),
    edited: z.boolean().default(true).describe("false before an edit: only whether it is allowed"),
    instance: z
      .string()
      .optional()
      .describe("validate only this instance's records (default: each record's own instance)"),
  }),
  output: z.object({
    protected: z.array(z.object({ path: z.string(), reason: z.string() })).readonly(),
    findings: z
      .array(
        z.object({
          ruleId: z.string(),
          severity: z.enum(["block", "warn", "info"]),
          path: z.string(),
          line: z.number().nullable(),
          message: z.string(),
          remediation: z.string(),
        }),
      )
      .readonly(),
    passed: z.boolean(),
  }),
  flags: { readOnly: true, destructive: false, requiresDevelopmentInstance: false },
  mcp: false,
  arguments: ["paths"],
  async handle(input, context) {
    const root = await workspaceRoot(context);
    const paths = input.paths.map((path) => relative(root, resolve(context.host.cwd, path)));
    return checkFiles((instance) => context.governance(root, InstanceName.parse(instance)), {
      paths,
      validate: input.edited,
      ...(input.instance === undefined ? {} : { instance: input.instance }),
    });
  },
  render(output) {
    return [
      ...output.protected.map((p) => `protected: ${p.path}: ${p.reason}`),
      ...output.findings.map(
        (f) =>
          `${f.severity} ${f.ruleId} ${f.path}${f.line === null ? "" : `:${f.line}`} ${f.message} (fix: ${f.remediation})`,
      ),
      output.passed ? "check passed" : "check failed",
    ].join("\n");
  },
  exitCode: (output) => (output.passed ? 0 : 1),
});

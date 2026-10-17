import { EXIT_CODES, fluentSourcePath, validate as validateSource } from "@snagentic/core";
import { z } from "zod";
import { instanceFor } from "./knowledge-session";
import { defineUseCase } from "./use-case";
import { workspaceRoot } from "./workspace-root";

const Severity = z.enum(["block", "warn", "info"]);

export const validate = defineUseCase({
  name: "validate",
  description:
    "Build the Fluent source the change touched and check what it adds or edits against the " +
    "platform rules (security, performance, upgradability, manageability, user experience), " +
    "reporting only what the change introduced, with rule id, file, line, why and " +
    "remediation; edits to the read-only mirror are refused. By default checks every project " +
    "changed since HEAD; give paths to check those projects, or base=origin/main to check a " +
    "branch. Fix every block finding before delivering; never silence one.",
  input: z.object({
    paths: z
      .array(z.string())
      .optional()
      .describe("source files whose projects to check (default: every project changed since base)"),
    base: z
      .string()
      .default("HEAD")
      .describe("commit, branch or tag to compare with; findings already there are not reported"),
    instance: z.string().optional().describe("default: the workspace's only instance"),
    staged: z
      .boolean()
      .default(false)
      .describe(
        "check only what is staged for commit, as the index holds it (the pre-commit hook)",
      ),
  }),
  output: z.object({
    instance: z.string(),
    base: z.string(),
    units: z.number().describe("units (one update each) the change added or edited, checked"),
    fluentProjects: z.number().describe("Fluent projects under source/ built"),
    passed: z.boolean(),
    counts: z.object({ block: z.number(), warn: z.number(), info: z.number() }),
    findings: z
      .array(
        z.object({
          ruleId: z.string(),
          severity: Severity,
          title: z.string(),
          path: z.string(),
          root: z.enum(["workspace"]).optional().describe("path is relative to the workspace"),
          field: z.string().nullable(),
          line: z.number().nullable(),
          message: z.string(),
          evidence: z.string(),
          why: z.string(),
          remediation: z.string(),
        }),
      )
      .readonly(),
    notChecked: z.array(z.object({ path: z.string(), reason: z.string() })).readonly(),
    rulesNotChecked: z.array(z.object({ ruleId: z.string(), reason: z.string() })).readonly(),
  }),
  flags: { readOnly: true, destructive: false, requiresDevelopmentInstance: false },
  mcp: true,
  arguments: ["paths"],
  async handle(input, context, run) {
    const root = await workspaceRoot(context);
    const instance = await instanceFor(root, context, input.instance);
    run.progress({ message: "building the source and checking it" });
    const governance = context.governance(root, instance, { staged: input.staged });
    const paths = (input.paths ?? []).flatMap((p) => fluentSourcePath(root, p) ?? []);
    const result = await validateSource(governance, {
      base: input.base,
      ...(input.paths === undefined ? {} : { paths }),
    });
    return { instance, ...result };
  },
  render(output) {
    const lines = output.findings.flatMap((f) => [
      `${f.severity.padEnd(5)} ${f.ruleId}  ${f.path}${f.line === null ? "" : `:${f.line}`}  ${f.message}`,
      ...(f.evidence === "" ? [] : [`      ${f.evidence}`]),
      `      fix: ${f.remediation}`,
    ]);
    const skipped = output.notChecked.map((s) => `not checked: ${s.path} (${s.reason})`);
    const { block, warn, info } = output.counts;
    const summary =
      output.fluentProjects === 0 && output.findings.length === 0
        ? `no changed source since ${output.base}`
        : `${output.units} unit(s) in ${output.fluentProjects} project(s) checked against ${output.base}: ${block} block, ${warn} warn, ${info} info`;
    return [...lines, ...skipped, summary].join("\n");
  },
  exitCode: (output) => (output.passed ? 0 : EXIT_CODES.findings),
});

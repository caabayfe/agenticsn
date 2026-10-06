import { EXIT_CODES, metadataPath, validate as validateRecords } from "@snagentic/core";
import { z } from "zod";
import { instanceFor } from "./knowledge-session";
import { defineUseCase } from "./use-case";
import { workspaceRoot } from "./workspace-root";

const Severity = z.enum(["block", "warn", "info"]);

export const validate = defineUseCase({
  name: "validate",
  description:
    "Check changed ServiceNow records against the platform rules (security, performance, " +
    "upgradability, manageability, user experience) and report only what the change " +
    "introduced, with rule id, file, line, why and remediation. By default checks every " +
    "record edited since HEAD; give paths to check those, or base=origin/main to check a " +
    "branch. Fix every block finding before delivering; never silence one.",
  input: z.object({
    paths: z
      .array(z.string())
      .optional()
      .describe("record files to check (default: every record changed since base)"),
    base: z
      .string()
      .default("HEAD")
      .describe("commit, branch or tag to compare with; findings already there are not reported"),
    instance: z.string().optional().describe("default: the workspace's only instance"),
  }),
  output: z.object({
    instance: z.string(),
    base: z.string(),
    records: z.number(),
    passed: z.boolean(),
    counts: z.object({ block: z.number(), warn: z.number(), info: z.number() }),
    findings: z
      .array(
        z.object({
          ruleId: z.string(),
          severity: Severity,
          title: z.string(),
          path: z.string(),
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
    run.progress({ message: "checking changed records" });
    const result = await validateRecords(context.governance(root, instance), {
      base: input.base,
      ...(input.paths === undefined
        ? {}
        : { paths: input.paths.map((path) => metadataPath(instance, root, path)) }),
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
      output.records === 0
        ? `no changed records since ${output.base}`
        : `${output.records} record(s) checked against ${output.base}: ${block} block, ${warn} warn, ${info} info`;
    return [...lines, ...skipped, summary].join("\n");
  },
  exitCode: (output) => (output.passed ? 0 : EXIT_CODES.findings),
});

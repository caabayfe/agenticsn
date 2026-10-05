import { CHECK_STATUSES, EXIT_CODES, InvalidInputError, runDoctor } from "@snagentic/core";
import { z } from "zod";
import { defineUseCase } from "./use-case";

const CheckSchema = z.object({
  name: z.string(),
  status: z.enum(CHECK_STATUSES),
  detail: z.string(),
  hint: z.string().nullable(),
});

export const doctor = defineUseCase({
  name: "doctor",
  description:
    "Check that this machine can run snagentic: git, the OS keychain and the search index. " +
    "Run it first when snagentic behaves unexpectedly.",
  input: z.object({
    local: z.boolean().default(true).describe("check this machine only"),
  }),
  output: z.object({
    ok: z.boolean(),
    checks: z.array(CheckSchema).readonly(),
  }),
  flags: { readOnly: true, destructive: false, requiresDevelopmentInstance: false },
  mcp: true,
  async handle(input, context) {
    if (!input.local) {
      throw new InvalidInputError(
        "only local checks exist for now; instance checks arrive with instance profiles",
      );
    }
    return runDoctor(context.environmentProbes);
  },
  render(output) {
    const width = Math.max(...output.checks.map((check) => check.name.length), 0);
    const lines = output.checks.flatMap((check) => [
      `${check.status.padEnd(11)} ${check.name.padEnd(width)}  ${check.detail}`,
      ...(check.status === "ok" || check.hint === null
        ? []
        : [`${" ".repeat(13)}hint: ${check.hint}`]),
    ]);
    const failed = output.checks.filter((check) => check.status === "fail").length;
    lines.push(failed === 0 ? "doctor: ready" : `doctor: ${failed} check(s) failed`);
    return lines.join("\n");
  },
  exitCode(output) {
    return output.ok ? 0 : EXIT_CODES.precondition;
  },
});

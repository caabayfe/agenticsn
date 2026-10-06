import {
  CHECK_STATUSES,
  type Check,
  checkAgentPack,
  EXIT_CODES,
  getInstance,
  InstanceName,
  runDoctor,
  runInstanceChecks,
  summarizeChecks,
  VERSION,
  WorkspaceNotFoundError,
} from "@snagentic/core";
import { z } from "zod";
import { defineUseCase, type RunControl, type UseCaseContext } from "./use-case";
import { workspaceRoot } from "./workspace-root";

const CheckSchema = z.object({
  name: z.string(),
  status: z.enum(CHECK_STATUSES),
  detail: z.string(),
  hint: z.string().nullable(),
});

async function instanceChecks(
  name: string,
  context: UseCaseContext,
  run: RunControl,
): Promise<Check[]> {
  const profile = await getInstance(
    await workspaceRoot(context),
    InstanceName.parse(name),
    context.profiles,
  );
  const secret = await context.credentials.read(profile);
  run.progress({ message: `checking ${profile.url}` });
  const reader = context.connections.open(profile, secret ?? "");
  return runInstanceChecks(profile, secret, reader, run.signal);
}

// Checks of the workspace doctor runs in; none outside a workspace.
async function workspaceChecks(context: UseCaseContext): Promise<Check[]> {
  try {
    return [await checkAgentPack(context.workspaceFiles, await workspaceRoot(context), VERSION)];
  } catch (error) {
    if (error instanceof WorkspaceNotFoundError) {
      return [];
    }
    throw error;
  }
}

function renderCheck(check: Check, width: number): string[] {
  const line = `${check.status.padEnd(11)} ${check.name.padEnd(width)}  ${check.detail}`;
  return check.status === "ok" || check.hint === null
    ? [line]
    : [line, `${" ".repeat(13)}hint: ${check.hint}`];
}

export const doctor = defineUseCase({
  name: "doctor",
  description:
    "Check that snagentic can work: git, OS keychain and search index on this machine, and, " +
    "with --instance, credentials, connection, roles and timestamp handling of an instance.",
  input: z.object({
    instance: z.string().optional().describe("also check this instance of the workspace"),
  }),
  output: z.object({ ok: z.boolean(), checks: z.array(CheckSchema).readonly() }),
  flags: { readOnly: true, destructive: false, requiresDevelopmentInstance: false },
  mcp: true,
  async handle(input, context, run) {
    const local = summarizeChecks([
      ...(await runDoctor(context.environmentProbes)).checks,
      ...(await workspaceChecks(context)),
    ]);
    if (input.instance === undefined) {
      return local;
    }
    return summarizeChecks([
      ...local.checks,
      ...(await instanceChecks(input.instance, context, run)),
    ]);
  },
  render(output) {
    const width = Math.max(...output.checks.map((check) => check.name.length), 0);
    const lines = output.checks.flatMap((check) => renderCheck(check, width));
    const failed = output.checks.filter((check) => check.status === "fail").length;
    const warned = output.checks.filter((check) => check.status === "warn").length;
    const warnings = warned === 0 ? "" : ` (${warned} warning${warned === 1 ? "" : "s"})`;
    lines.push(failed === 0 ? `doctor: ready${warnings}` : `doctor: ${failed} check(s) failed`);
    return lines.join("\n");
  },
  exitCode(output) {
    return output.ok ? 0 : EXIT_CODES.precondition;
  },
});

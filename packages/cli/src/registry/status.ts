import {
  getInstance,
  INSTANCE_KINDS,
  InstanceName,
  type InstanceProfile,
  instanceStatus,
  listInstances,
} from "@snagentic/core";
import { z } from "zod";
import { defineUseCase, type UseCaseContext } from "./use-case";
import { workspaceRoot } from "./workspace-root";

const SHOWN_CHANGES = 10;

const InstanceStatusOutput = z.object({
  instance: z.string(),
  kind: z.enum(INSTANCE_KINDS),
  url: z.string(),
  phase: z.enum(["never-pulled", "interrupted", "not-integrated", "integrated"]),
  lastPull: z.string().nullable(),
  lastFullPull: z.string().nullable(),
  minutesSinceLastPull: z.number().nullable(),
  interrupted: z.object({ startedAt: z.string(), completedClasses: z.number() }).nullable(),
  remoteCommit: z.string().nullable(),
  unintegratedPulls: z.number(),
  localChanges: z.array(z.string()),
  next: z.string(),
});
type InstanceStatusOutput = z.output<typeof InstanceStatusOutput>;

async function profilesFor(root: string, instance: string | undefined, context: UseCaseContext) {
  return instance === undefined
    ? listInstances(root, context.profiles)
    : [await getInstance(root, InstanceName.parse(instance), context.profiles)];
}

async function statusOf(root: string, profile: InstanceProfile, context: UseCaseContext) {
  const status = await instanceStatus(root, profile.name, {
    state: context.syncState(root, profile.name),
    inspector: context.inspector,
    now: context.clock,
  });
  return {
    ...status,
    kind: profile.kind,
    url: profile.url,
    localChanges: [...status.localChanges],
  };
}

function age(minutes: number): string {
  if (minutes < 60) {
    return `${minutes} min ago`;
  }
  return minutes < 48 * 60
    ? `${Math.floor(minutes / 60)} h ago`
    : `${Math.floor(minutes / 1440)} days ago`;
}

function pullLine(status: InstanceStatusOutput): string {
  if (status.interrupted !== null) {
    return `  full pull interrupted (started ${status.interrupted.startedAt} UTC, ${status.interrupted.completedClasses} classes done); pulling again resumes it`;
  }
  if (status.lastPull === null || status.minutesSinceLastPull === null) {
    return "  never pulled";
  }
  return `  last pull ${status.lastPull} UTC (${age(status.minutesSinceLastPull)}); last full pull ${status.lastFullPull ?? "never"} UTC`;
}

function renderOne(status: InstanceStatusOutput): string {
  const changes = status.localChanges;
  const more = changes.length > SHOWN_CHANGES ? ` (+${changes.length - SHOWN_CHANGES} more)` : "";
  return [
    `${status.instance} (${status.kind}) ${status.url}`,
    pullLine(status),
    ...(status.unintegratedPulls > 0
      ? [`  ${status.unintegratedPulls} pull(s) not integrated yet`]
      : []),
    changes.length === 0
      ? "  no local changes to synced files"
      : `  ${changes.length} local change(s): ${changes.slice(0, SHOWN_CHANGES).join(", ")}${more}`,
    `  next: ${status.next}`,
  ].join("\n");
}

export const status = defineUseCase({
  name: "status",
  description:
    "Show how fresh each instance's mirror is: last pull, interrupted pulls, pulls not yet " +
    "integrated and local changes to synced files. Reads local state only; never calls the instance.",
  input: z.object({ instance: z.string().optional().describe("one instance (default: all)") }),
  output: z.object({ instances: z.array(InstanceStatusOutput) }),
  flags: { readOnly: true, destructive: false, requiresDevelopmentInstance: false },
  mcp: true,
  arguments: ["instance"],
  async handle(input, context) {
    const root = await workspaceRoot(context);
    const profiles = await profilesFor(root, input.instance, context);
    return {
      instances: await Promise.all(profiles.map((profile) => statusOf(root, profile, context))),
    };
  },
  render(output) {
    return output.instances.length === 0
      ? "no instances yet; add one with: snagentic instance add <name> --url <url> --username <user>"
      : output.instances.map(renderOne).join("\n\n");
  },
  exitCode: () => 0,
});

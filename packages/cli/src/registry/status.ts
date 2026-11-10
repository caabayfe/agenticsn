import {
  getInstance,
  INSTANCE_KINDS,
  InstanceName,
  type InstanceProfile,
  instanceStatus,
  listInstances,
  sharedMirrorStatus,
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
  // The team's shared mirror (ADR-0052), as git fetched it now; null without one.
  sharedMirror: z
    .object({
      remote: z.string(),
      reachable: z.boolean(),
      commit: z.string().nullable(),
      ageMinutes: z.number().nullable(),
      maxAgeMinutes: z.number(),
      ahead: z.boolean().describe("it holds pulls this clone lacks: integrate brings them in"),
      publisher: z.string().nullable().describe("the instance user who publishes it"),
      stale: z
        .boolean()
        .describe(
          "older than its max age and published by another user: pull takes it as it is unless --now",
        ),
    })
    .nullable(),
  // The plan id of a push that stopped part way: plan and push again to finish it.
  unfinishedPush: z.string().nullable(),
  // The instance's domains besides global, from the operational inventory (ADR-0027): build an
  // application in global, and in a customer's domain only that customer's changes.
  domains: z.array(z.object({ name: z.string(), sysId: z.string() })),
  next: z.string(),
});
type InstanceStatusOutput = z.output<typeof InstanceStatusOutput>;

async function profilesFor(root: string, instance: string | undefined, context: UseCaseContext) {
  return instance === undefined
    ? listInstances(root, context.profiles)
    : [await getInstance(root, InstanceName.parse(instance), context.profiles)];
}

async function statusOf(root: string, profile: InstanceProfile, context: UseCaseContext) {
  const state = context.syncState(root, profile.name);
  const deps = { state, shared: context.sharedMirror, now: context.clock };
  const setting = profile.sharedMirror;
  const shared =
    setting === undefined
      ? {}
      : {
          shared: await sharedMirrorStatus(
            deps,
            root,
            profile.name,
            setting,
            profile.auth.username,
          ),
        };
  const status = await instanceStatus(root, profile.name, {
    state,
    inspector: context.inspector,
    now: context.clock,
    ...shared,
  });
  const journal = await context.pushJournal(root, profile.name).read();
  const domains = ((await context.inventory.read(root, profile.name, "domains")) ?? [])
    .map((row) => ({ name: row["name"] ?? "", sysId: row["sys_id"] ?? "" }))
    .filter((domain) => domain.sysId !== "" && domain.sysId !== "global");
  // Push clears its journal when it finishes: one left behind is a push that stopped.
  const stopped = journal;
  return {
    ...status,
    kind: profile.kind,
    url: profile.url,
    localChanges: [...status.localChanges],
    unfinishedPush: stopped?.planId ?? null,
    domains,
    next:
      stopped === null
        ? status.next
        : `snagentic plan-push --instance ${profile.name}, then push: what reached the instance is only recorded`,
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

function sharedLine(shared: InstanceStatusOutput["sharedMirror"]): string[] {
  if (shared === null) return [];
  if (!shared.reachable)
    return [`  shared mirror on ${shared.remote}: unreachable (git fetch failed)`];
  if (shared.commit === null) return [`  shared mirror on ${shared.remote}: none yet`];
  const pulled = shared.ageMinutes === null ? "" : `, pulled ${age(shared.ageMinutes)}`;
  const ahead = shared.ahead ? "; it holds pulls this clone lacks" : "";
  const stale = shared.stale
    ? `; stale: ${shared.publisher ?? "its publisher"}'s scheduled pull looks late`
    : "";
  return [
    `  shared mirror on ${shared.remote}: ${shared.commit.slice(0, 10)}${pulled}${ahead}${stale}`,
  ];
}

function renderOne(status: InstanceStatusOutput): string {
  const changes = status.localChanges;
  const more = changes.length > SHOWN_CHANGES ? ` (+${changes.length - SHOWN_CHANGES} more)` : "";
  return [
    `${status.instance} (${status.kind}) ${status.url}`,
    pullLine(status),
    ...sharedLine(status.sharedMirror),
    ...(status.unfinishedPush === null
      ? []
      : [
          `  push ${status.unfinishedPush} stopped part way: the instance may hold some of its writes`,
        ]),
    ...(status.unintegratedPulls > 0
      ? [`  ${status.unintegratedPulls} pull(s) not integrated yet`]
      : []),
    ...(status.domains.length === 0
      ? []
      : [`  domains: ${status.domains.map((d) => `${d.name} (${d.sysId})`).join(", ")}`]),
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
    "integrated, local changes to synced files, and the team's shared mirror. Never calls the " +
    "instance; with a shared mirror it runs git fetch. Follow its next.",
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

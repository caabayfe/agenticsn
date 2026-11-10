import {
  actingAs,
  checkPublisher,
  continueFromNewest,
  getInstance,
  InstanceName,
  type InstanceProfile,
  minutesSince,
  PublishRejectedError,
  type SharedStart,
  SnagenticError,
} from "@snagentic/core";
import { z } from "zod";
import { PullOutput } from "./pull-output";
import { renderPull } from "./pull-render";
import { pullFromInstance } from "./pull-session";
import type { SharedPullOutput } from "./pull-shared-output";
import { defineUseCase, type RunControl, type UseCaseContext } from "./use-case";
import { tuneClone, workspaceRoot } from "./workspace-root";

class PublishNeedsSharedMirrorError extends SnagenticError {
  constructor(instance: string) {
    super(
      "publish-needs-shared-mirror",
      "usage",
      `--publish pushes to the shared mirror, and ${instance}'s profile names none`,
      `add shared_mirror: { remote: origin } to instances/${instance}/instance.yaml, or pull without --publish`,
    );
  }
}

// ADR-0053: the transaction log is large and its user_agent is not indexed, so measuring a
// run's cost is itself load; it is done only when asked, and only on development instances.
class CostNeedsDevelopmentError extends SnagenticError {
  constructor(instance: string, kind: string) {
    super(
      "cost-needs-development",
      "usage",
      `--cost reads the transaction log, which is measured only on development instances, and ${instance} is ${kind}`,
      `run without --cost: snagentic pull ${instance}`,
    );
  }
}

const PullInput = z.object({
  instance: z.string(),
  full: z.boolean().default(false).describe("pull everything again"),
  verify: z
    .boolean()
    .default(false)
    .describe("also compare the mirror with the instance by counts and repair differences"),
  now: z
    .boolean()
    .default(false)
    .describe("pull from the instance even when the shared mirror is younger than its max age"),
  publish: z
    .boolean()
    .default(false)
    .describe(
      "push the mirror branch to the shared mirror after the pull (the designated puller; fast-forward only)",
    ),
  cost: z
    .boolean()
    .default(false)
    .describe(
      "also measure the run's server cost from the instance's transaction log (development instances only)",
    ),
});
type PullInput = z.output<typeof PullInput>;
type Setting = NonNullable<InstanceProfile["sharedMirror"]>;

function sharedView(
  start: SharedStart,
  setting: Setting,
  now: Date,
  published: boolean,
): SharedPullOutput {
  return {
    remote: start.remote,
    from: start.from,
    sharedCommit: start.shared?.commit ?? null,
    ageMinutes: start.watermark === null ? null : minutesSince(start.watermark, now),
    maxAgeMinutes: setting.maxAgeMinutes,
    published,
  };
}

// The mirror is younger than maxAge: the pull asks the instance nothing (ADR-0052 item 3).
function currentOutput(
  name: string,
  commit: string,
  start: SharedStart,
  shared: SharedPullOutput,
): PullOutput {
  return {
    instance: name,
    mode: "current",
    resumed: false,
    commit,
    changed: false,
    records: 0,
    unreadable: [],
    secretRedactions: [],
    watermark: start.watermark ?? "",
    requests: 0,
    retries: 0,
    semaphoreWaitMs: 0,
    peakConcurrency: 0,
    requestSeconds: 0,
    seconds: 0,
    peakMemoryMb: 0,
    timeouts: 0,
    serverCostRequested: false,
    serverCost: null,
    shared,
  };
}

// ADR-0052 items 2, 3 and 5: start from the newest mirror, skip a current one, publish
// fast-forward only; a refused push fetches, continues from the newer commit and tries once more.
async function pullShared(
  root: string,
  profile: InstanceProfile,
  setting: Setting,
  input: PullInput,
  context: UseCaseContext,
  run: RunControl,
): Promise<PullOutput> {
  const state = context.syncState(root, profile.name);
  const deps = { shared: context.sharedMirror, state, now: context.clock };
  for (let attempt = 1; ; attempt += 1) {
    const start = await continueFromNewest(deps, root, profile.name, setting, input.publish);
    if (input.publish) checkPublisher(start, profile.name, profile.auth.username);
    const view = (published: boolean) => sharedView(start, setting, context.clock(), published);
    const tip = (await context.sharedMirror.localTip(root, profile.name)) ?? "";
    // A publisher skips only when the shared tip already holds what it would publish.
    const shared = !input.publish || tip === start.shared?.commit;
    if (start.current && shared && !input.now && !input.full && !input.verify) {
      return currentOutput(profile.name, tip, start, view(false));
    }
    const output = await pullFromInstance(root, profile, input, context, run);
    if (!input.publish) return { ...output, shared: view(false) };
    run.progress({ message: `publishing to ${setting.remote}` });
    const pushed = await context.sharedMirror.publish(
      root,
      profile.name,
      setting.remote,
      output.commit,
    );
    if (pushed === "published") return { ...output, shared: view(true) };
    if (attempt >= 2) throw new PublishRejectedError(profile.name, setting.remote);
  }
}

export const pull = defineUseCase({
  name: "pull",
  description:
    "Mirror an instance's metadata into the workspace's servicenow-remote/<name> branch. The " +
    "first pull is complete and resumable; later pulls fetch only what changed. With a shared " +
    "mirror, a pull continues from the newest of it and this clone's branch, and asks the " +
    "instance nothing while that mirror is younger than its max age. Then run integrate to " +
    "bring it into the working branch.",
  input: PullInput,
  output: PullOutput,
  flags: { readOnly: false, destructive: false, requiresDevelopmentInstance: false },
  mcp: true,
  arguments: ["instance"],
  async handle(input, context, run) {
    const root = await workspaceRoot(context);
    const profile = await getInstance(root, InstanceName.parse(input.instance), context.profiles);
    if (input.cost && profile.kind !== "development") {
      throw new CostNeedsDevelopmentError(profile.name, profile.kind);
    }
    run.progress({ message: `pulling ${profile.name} as ${actingAs(profile)}` });
    await tuneClone(context, root, run);
    const setting = profile.sharedMirror;
    if (setting === undefined) {
      if (input.publish) throw new PublishNeedsSharedMirrorError(profile.name);
      return pullFromInstance(root, profile, input, context, run);
    }
    return pullShared(root, profile, setting, input, context, run);
  },
  render: renderPull,
  exitCode: () => 0,
});

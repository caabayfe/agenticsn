import { actingAs } from "../../instance/domain/identity";
import type { InstanceProfile } from "../../instance/domain/profile";
import { CostNeedsDevelopmentError, PublishNeedsSharedMirrorError } from "../domain/pull-errors";
import { PublishRejectedError } from "../domain/shared-mirror-errors";
import {
  type InstancePull,
  type PullPorts,
  type PullRequest,
  type PullRun,
  pullFromInstance,
} from "./pull-session";
import {
  checkPublisher,
  continueFromNewest,
  type SharedPullSetting,
  type SharedStart,
} from "./shared-mirror";

export interface InstancePullRequest extends PullRequest {
  // Pull from the instance even while the shared mirror is younger than its max age.
  readonly now: boolean;
}

// What a pull did with the team's shared mirror (ADR-0052); absent without one.
export interface SharedPullFacts {
  readonly setting: SharedPullSetting;
  // Where the last attempt started.
  readonly start: SharedStart;
  readonly published: boolean;
}

export type PullOutcome =
  | (InstancePull & { readonly shared?: SharedPullFacts })
  // The mirror was younger than maxAge: the instance was asked nothing (ADR-0052 item 3).
  | { readonly mode: "current"; readonly commit: string; readonly shared: SharedPullFacts };

// ADR-0052 items 2, 3 and 5: start from the newest mirror, skip a current one, publish
// fast-forward only; a refused push fetches, continues from the newer commit and tries once more.
async function pullShared(
  ports: PullPorts,
  root: string,
  profile: InstanceProfile,
  setting: SharedPullSetting,
  input: InstancePullRequest,
  run: PullRun,
): Promise<PullOutcome> {
  const deps = { shared: ports.shared, state: ports.state, now: ports.clock };
  for (let attempt = 1; ; attempt += 1) {
    const start = await continueFromNewest(deps, root, profile.name, setting, input.publish);
    if (input.publish) checkPublisher(start, profile.name, profile.auth.username);
    const facts = (published: boolean) => ({ setting, start, published });
    const tip = (await ports.shared.localTip(root, profile.name)) ?? "";
    // A publisher skips only when the shared tip already holds what it would publish.
    const shared = !input.publish || tip === start.shared?.commit;
    if (start.current && shared && !input.now && !input.full && !input.verify) {
      return { mode: "current", commit: tip, shared: facts(false) };
    }
    const pulled = await pullFromInstance(ports, profile, input, run);
    if (!input.publish) return { ...pulled, shared: facts(false) };
    run.progress({ message: `publishing to ${setting.remote}` });
    const commit = pulled.facts.commit;
    const pushed = await ports.shared.publish(root, profile.name, setting.remote, commit);
    if (pushed === "published") return { ...pulled, shared: facts(true) };
    if (attempt >= 2) throw new PublishRejectedError(profile.name, setting.remote);
  }
}

// A pull of one instance: from the instance into the mirror branch, or, with a shared mirror,
// from the newest of it and this clone's branch (ADR-0052).
export async function pullInstance(
  ports: PullPorts,
  root: string,
  profile: InstanceProfile,
  input: InstancePullRequest,
  run: PullRun,
): Promise<PullOutcome> {
  if (input.cost && profile.kind !== "development") {
    throw new CostNeedsDevelopmentError(profile.name, profile.kind);
  }
  run.progress({ message: `pulling ${profile.name} as ${actingAs(profile)}` });
  await ports.prepareClone();
  const setting = profile.sharedMirror;
  if (setting === undefined) {
    if (input.publish) throw new PublishNeedsSharedMirrorError(profile.name);
    return pullFromInstance(ports, profile, input, run);
  }
  return pullShared(ports, root, profile, setting, input, run);
}

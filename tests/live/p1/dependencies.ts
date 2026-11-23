import { join, resolve } from "node:path";
import { EnvironmentCredentialStore } from "../../../packages/cli/src/adapters/credentials/environment-credential-store";
import { KeychainCredentialStore } from "../../../packages/cli/src/adapters/credentials/keychain-credential-store";
import { LayeredCredentialStore } from "../../../packages/cli/src/adapters/credentials/layered-credential-store";
import { GhPullRequests } from "../../../packages/cli/src/adapters/delivery/gh-pull-requests";
import { GitDeliveryWorkspace } from "../../../packages/cli/src/adapters/delivery/git-delivery-workspace";
import { decodeCapture } from "../../../packages/cli/src/adapters/fluent/capture-decoder";
import { SdkToolchain } from "../../../packages/cli/src/adapters/fluent/fluent-toolchain";
import { FLUENT_WORKER_COMMAND } from "../../../packages/cli/src/adapters/fluent/worker-protocol";
import { workerRuntime } from "../../../packages/cli/src/adapters/fluent/worker-runtime";
import { osSandbox } from "../../../packages/cli/src/adapters/fluent/worker-sandbox";
import { WorkspaceAuthoring } from "../../../packages/cli/src/adapters/fluent/workspace-authoring";
import { WorkspaceFluentProjects } from "../../../packages/cli/src/adapters/fluent/workspace-fluent-projects";
import { EslintScriptChecker } from "../../../packages/cli/src/adapters/governance/eslint-script-checker";
import { GitMirrorState } from "../../../packages/cli/src/adapters/governance/git-mirror-state";
import { YamlProfileStore } from "../../../packages/cli/src/adapters/profiles/yaml-profile-store";
import { fetchTransport } from "../../../packages/cli/src/adapters/servicenow/fetch-transport";
import { RequestScheduler } from "../../../packages/cli/src/adapters/servicenow/request-scheduler";
import { ServiceNowWriteClient } from "../../../packages/cli/src/adapters/servicenow/servicenow-write-client";
import { JsonPushJournalStore } from "../../../packages/cli/src/adapters/state/json-push-journal-store";
import {
  ensureDevelopmentInstance,
  getInstance,
  InstanceName,
  instancePaths,
  KeysetPager,
  resolveSecret,
  type UnitPushDependencies,
} from "../../../packages/core/src/index";

// Same real git/build/governance/HTTP adapters as the CLI. Only fault.ts wraps fluent/load
// to withhold this test property's capture between the actual load and verification.
export async function dependencies(root: string) {
  const instance = InstanceName.parse("pdi11");
  const profile = await getInstance(root, instance, new YamlProfileStore());
  ensureDevelopmentInstance(profile, "P1 fault-injection acceptance test");
  if (profile.url !== "https://dev221240.service-now.com")
    throw new Error("unexpected pdi11 target");
  const credentials = new LayeredCredentialStore(
    new EnvironmentCredentialStore(process.env),
    new KeychainCredentialStore(),
  );
  const client = new ServiceNowWriteClient(
    profile,
    await resolveSecret(profile, credentials),
    new RequestScheduler(fetchTransport()),
    "snagentic-p1-acceptance",
  );
  const runtime = workerRuntime({
    sdkVersion: "4.14.2",
    command: [resolve(import.meta.dir, "../../../dist/snagentic"), FLUENT_WORKER_COMMAND],
    sandbox: osSandbox(),
    warn: (line) => console.error(line),
  });
  const load = async () => runtime;
  const paths = instancePaths(instance);
  const now = () => new Date();
  const deps: UnitPushDependencies = {
    reader: client,
    writer: client.writer,
    username: profile.auth.username,
    url: profile.url,
    authoring: {
      workspace: new WorkspaceAuthoring(root, load),
      toolchain: new SdkToolchain(root, load),
    },
    workspace: new GitDeliveryWorkspace(root, instance),
    governance: {
      mirror: new GitMirrorState(root, paths.metadata, paths.remoteBranch),
      checker: new EslintScriptChecker(),
      fluent: new WorkspaceFluentProjects(root, load),
    },
    updateSets: { pager: new KeysetPager(client), statistics: client, now },
    journal: new JsonPushJournalStore(join(root, paths.localState)),
    decodeCapture,
    installer: client.fluent,
    pullRequests: new GhPullRequests(root),
    now,
    signal: AbortSignal.timeout(90000),
  };
  return { deps, client };
}

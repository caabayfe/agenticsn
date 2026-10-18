// A read-only connection to a live instance for the verification tools (test plan, spec 009):
// the profile and credential of a workspace, signed and scheduled as snagentic's own client is.
import { resolve } from "node:path";
import { EnvironmentCredentialStore } from "../../../packages/cli/src/adapters/credentials/environment-credential-store";
import { KeychainCredentialStore } from "../../../packages/cli/src/adapters/credentials/keychain-credential-store";
import { LayeredCredentialStore } from "../../../packages/cli/src/adapters/credentials/layered-credential-store";
import { YamlProfileStore } from "../../../packages/cli/src/adapters/profiles/yaml-profile-store";
import { fetchTransport } from "../../../packages/cli/src/adapters/servicenow/fetch-transport";
import { RequestScheduler } from "../../../packages/cli/src/adapters/servicenow/request-scheduler";
import { ServiceNowClient } from "../../../packages/cli/src/adapters/servicenow/servicenow-client";
import { getInstance, InstanceName, resolveSecret } from "../../../packages/core/src/index";

export async function liveClient(instance: string, workspace: string): Promise<ServiceNowClient> {
  const profile = await getInstance(
    resolve(workspace),
    InstanceName.parse(instance),
    new YamlProfileStore(),
  );
  const credentials = new LayeredCredentialStore(
    new EnvironmentCredentialStore(process.env),
    new KeychainCredentialStore(),
  );
  const secret = await resolveSecret(profile, credentials);
  return new ServiceNowClient(
    profile,
    secret,
    new RequestScheduler(fetchTransport()),
    "snagentic-verify",
  );
}

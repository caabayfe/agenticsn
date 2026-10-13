// Spike S9 (delivering ACLs): a connection to a development instance through snagentic's own
// adapters, so the credential is read only by snagentic code. Not product code.

import { EnvironmentCredentialStore } from "../../../packages/cli/src/adapters/credentials/environment-credential-store";
import { KeychainCredentialStore } from "../../../packages/cli/src/adapters/credentials/keychain-credential-store";
import { LayeredCredentialStore } from "../../../packages/cli/src/adapters/credentials/layered-credential-store";
import { YamlProfileStore } from "../../../packages/cli/src/adapters/profiles/yaml-profile-store";
import { fetchTransport } from "../../../packages/cli/src/adapters/servicenow/fetch-transport";
import { RequestScheduler } from "../../../packages/cli/src/adapters/servicenow/request-scheduler";
import { ServiceNowClient } from "../../../packages/cli/src/adapters/servicenow/servicenow-client";
import {
  ensureDevelopmentInstance,
  getInstance,
  InstanceName,
  resolveSecret,
} from "../../../packages/core/src/index";

export async function connect(workspace: string, instance: string) {
  const profile = await getInstance(
    workspace,
    InstanceName.parse(instance),
    new YamlProfileStore(),
  );
  ensureDevelopmentInstance(profile);
  const credentials = new LayeredCredentialStore(
    new EnvironmentCredentialStore(process.env),
    new KeychainCredentialStore(),
  );
  const secret = await resolveSecret(profile, credentials);
  return new ServiceNowClient(
    profile,
    secret,
    new RequestScheduler(fetchTransport()),
    "snagentic-spike-s9",
  );
}

export const signal = new AbortController().signal;

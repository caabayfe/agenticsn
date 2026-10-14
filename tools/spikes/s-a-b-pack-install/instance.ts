// Spikes S-A and S-B (spec 005): raw requests to a development instance with the profile's
// basic credential, read only by snagentic code. Spike only: product code goes through the
// request scheduler (ADR-0016).
import { EnvironmentCredentialStore } from "../../../packages/cli/src/adapters/credentials/environment-credential-store";
import { KeychainCredentialStore } from "../../../packages/cli/src/adapters/credentials/keychain-credential-store";
import { LayeredCredentialStore } from "../../../packages/cli/src/adapters/credentials/layered-credential-store";
import { YamlProfileStore } from "../../../packages/cli/src/adapters/profiles/yaml-profile-store";
import {
  ensureDevelopmentInstance,
  getInstance,
  InstanceName,
  resolveSecret,
} from "../../../packages/core/src/index";

export async function instance(workspace: string, name: string) {
  const profile = await getInstance(workspace, InstanceName.parse(name), new YamlProfileStore());
  ensureDevelopmentInstance(profile, "spikes S-A and S-B");
  if (profile.auth.method !== "basic") throw new Error("basic only");
  const secret = await resolveSecret(
    profile,
    new LayeredCredentialStore(
      new EnvironmentCredentialStore(process.env),
      new KeychainCredentialStore(),
    ),
  );
  const auth = `Basic ${Buffer.from(`${profile.auth.username}:${secret}`).toString("base64")}`;
  return async (method: string, path: string, body?: unknown) => {
    const started = performance.now();
    const response = await fetch(new URL(path, profile.url), {
      method,
      headers: {
        Authorization: auth,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await response.text();
    let json: unknown = text;
    try {
      json = JSON.parse(text);
    } catch {}
    return { status: response.status, ms: Math.round(performance.now() - started), json };
  };
}

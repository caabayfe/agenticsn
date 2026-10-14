// Spike S11: one raw request with the profile's basic credential, printing status and body.
// Spike only: product code goes through the request scheduler (ADR-0016).
//   bun raw.ts <workspace> <instance> <METHOD> <path> [json body]
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

const [workspace = ".", instance = "pdi2", method = "GET", path = "/", body] =
  process.argv.slice(2);
const profile = await getInstance(workspace, InstanceName.parse(instance), new YamlProfileStore());
ensureDevelopmentInstance(profile);
if (profile.auth.method !== "basic") throw new Error("basic only");
const secret = await resolveSecret(
  profile,
  new LayeredCredentialStore(
    new EnvironmentCredentialStore(process.env),
    new KeychainCredentialStore(),
  ),
);
const response = await fetch(new URL(path, profile.url), {
  method,
  headers: {
    Authorization: `Basic ${Buffer.from(`${profile.auth.username}:${secret}`).toString("base64")}`,
    Accept: "application/json",
    "Content-Type": "application/json",
  },
  ...(body === undefined ? {} : { body }),
});
// RAW_FULL=1 prints the whole body (update record payloads are long).
const text = await response.text();
console.log(response.status, process.env["RAW_FULL"] === "1" ? text : text.slice(0, 3000));

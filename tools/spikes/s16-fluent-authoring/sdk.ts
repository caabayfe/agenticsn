// Spike S16 (from S11): run a now-sdk command against a development instance with the credential snagentic
// holds, passed only through the child's environment. The secret is never printed.
//   bun tools/spikes/s16-fluent-authoring/sdk.ts <workspace> <instance> <app dir> <now-sdk args...>
import { join } from "node:path";
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

const [workspace = ".", instance = "pdi2", appDir = ".", ...args] = process.argv.slice(2);
const profile = await getInstance(workspace, InstanceName.parse(instance), new YamlProfileStore());
ensureDevelopmentInstance(profile);
if (profile.auth.method !== "basic") throw new Error("spike supports basic profiles only");
const secret = await resolveSecret(
  profile,
  new LayeredCredentialStore(
    new EnvironmentCredentialStore(process.env),
    new KeychainCredentialStore(),
  ),
);
const bin = join(
  import.meta.dir,
  "../../../packages/cli/node_modules/@servicenow/sdk/bin/index.js",
);
const child = Bun.spawn(["node", bin, ...args], {
  cwd: appDir,
  env: {
    ...process.env,
    SN_SDK_INSTANCE_URL: profile.url,
    SN_SDK_USER: profile.auth.username,
    SN_SDK_USER_PWD: secret,
    SN_SDK_AUTH_TYPE: "basic",
    SN_SDK_NODE_ENV: "SN_SDK_CI_INSTALL",
    NO_TELEMETRY: "1",
  },
  stdout: "inherit",
  stderr: "inherit",
});
process.exit(await child.exited);

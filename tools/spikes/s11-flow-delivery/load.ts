// Spike S11/S13: load built records the way `now-sdk install` does for a project of type
// "configuration" (Orchestrator.installConfigurations): every XML file under the build's app
// folder, as multipart "files", to /api/fluent/load/<scopeId>, optionally into a named set.
// Spike only: product code goes through the request scheduler (ADR-0016).
//   bun load.ts <workspace> <instance> <dist app dir> <scopeId> [targetUpdateSetId]
import { readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
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

const [workspace = ".", instance = "pdi2", appDir = "dist/app", scopeId = "", target] =
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

const form = new FormData();
const files = readdirSync(appDir, { recursive: true, encoding: "utf8" })
  .filter((f) => f.endsWith(".xml"))
  .sort();
for (const file of files) {
  form.append(
    "files",
    new Blob([readFileSync(join(appDir, file))], { type: "application/xml" }),
    basename(file),
  );
}
const url = new URL(`/api/fluent/load/${scopeId}`, profile.url);
if (target) url.searchParams.set("targetUpdateSetId", target);
const response = await fetch(url, {
  method: "POST",
  headers: {
    Authorization: `Basic ${Buffer.from(`${profile.auth.username}:${secret}`).toString("base64")}`,
    Accept: "application/json",
  },
  body: form,
});
console.log(`loaded ${files.length} files:`, files.join(" "));
console.log(response.status, (await response.text()).slice(0, 3000));

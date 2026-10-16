// Spike S15: load update XML files through fluent/load into a named update set (ADR-0028's route),
// then report what the instance holds. Not product code: product requests go through the request
// scheduler (ADR-0016).
//   bun tools/spikes/s15-composite-loads/load.ts <workspace> <instance> <scope sys_id> <update set> <file.xml>...
import { readFileSync } from "node:fs";
import { basename } from "node:path";
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

const [workspace = "", instance = "pdi2", scopeId = "", updateSet = "", ...files] =
  process.argv.slice(2);
const profile = await getInstance(workspace, InstanceName.parse(instance), new YamlProfileStore());
ensureDevelopmentInstance(profile);
const secret = await resolveSecret(
  profile,
  new LayeredCredentialStore(
    new EnvironmentCredentialStore(process.env),
    new KeychainCredentialStore(),
  ),
);
const form = new FormData();
for (const file of files) {
  form.append("files", new Blob([readFileSync(file)], { type: "application/xml" }), basename(file));
}
const url = new URL(`/api/fluent/load/${scopeId}`, profile.url);
url.searchParams.set("targetUpdateSetId", updateSet);
const user = profile.auth.method === "basic" ? profile.auth.username : "";
const response = await fetch(url, {
  method: "POST",
  headers: {
    Authorization: `Basic ${Buffer.from(`${user}:${secret}`).toString("base64")}`,
    Accept: "application/json",
  },
  body: form,
});
console.log(response.status, (await response.text()).slice(0, 2000));

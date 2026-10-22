// Spike helper (spec 011, incident-task): the classic form's confirmation, server side.
// In one session: record the confirmation through the GlideAjax processor, then resolve.
//   bun confirm-resolve.ts <workspace> <instance> <incident sys_id>

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

const [workspace = ".", name = "pdi2", incident = ""] = process.argv.slice(2);
const profile = await getInstance(workspace, InstanceName.parse(name), new YamlProfileStore());
ensureDevelopmentInstance(profile, "incident-task confirmation test");
if (profile.auth.method !== "basic") throw new Error("basic only");
const secret = await resolveSecret(
  profile,
  new LayeredCredentialStore(
    new EnvironmentCredentialStore(process.env),
    new KeychainCredentialStore(),
  ),
);
const auth = `Basic ${Buffer.from(`${profile.auth.username}:${secret}`).toString("base64")}`;
let cookies = "";
const keep = (response: Response) => {
  const set = response.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
  if (set) cookies = cookies ? `${cookies}; ${set}` : set;
};
const ajax = await fetch(new URL("/xmlhttp.do", profile.url), {
  method: "POST",
  headers: { Authorization: auth, "Content-Type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({
    sysparm_processor: "ACCIncidentTaskAjax",
    sysparm_name: "confirmCloseTasks",
    sysparm_incident: incident,
  }),
});
keep(ajax);
console.log("ajax", ajax.status, (await ajax.text()).slice(0, 300));
const resolve = await fetch(
  new URL(`/api/now/table/incident/${incident}?sysparm_fields=number,state`, profile.url),
  {
    method: "PATCH",
    headers: {
      Authorization: auth,
      Cookie: cookies,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      state: "6",
      close_code: "Solution provided",
      close_notes: "ACC test: resolved with confirmation",
    }),
  },
);
console.log("resolve", resolve.status, await resolve.text());

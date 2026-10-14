// Spike S11/S13, test B3: how long is a live flow inactive while push redelivers it, and are
// triggers lost meanwhile? Delivers as push would, in one process: load into the batch set,
// select the batch set for the scope, publish, restore the preferences. Meanwhile it creates a
// matching incident every 200 ms, then reports which ones the flow ran for.
// Spike only: product code goes through the request scheduler (ADR-0016).
//   bun window.ts <workspace> <instance> <dist app dir> <scope> <batch set> <flow sys_id>
//                 <incident prefix> <work note marker>
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

const [workspace = ".", instance = "pdi2", appDir = "", scope = "", set = "", flow = ""] =
  process.argv.slice(2);
const [prefix = "", marker = ""] = process.argv.slice(8);
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
const auth = `Basic ${Buffer.from(`${profile.auth.username}:${secret}`).toString("base64")}`;
type Row = Record<string, string>;
async function call(method: string, path: string, body?: unknown): Promise<Row[] & Row> {
  const response = await fetch(new URL(path, profile.url), {
    method,
    headers: {
      Authorization: auth,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const json = (await response.json()) as { result: Row[] & Row };
  if (!response.ok)
    throw new Error(`${method} ${path}: ${response.status} ${JSON.stringify(json)}`);
  return json.result;
}
const q = (s: string) => encodeURIComponent(s);
const now = () => performance.now();

const admin =
  (
    await call(
      "GET",
      `/api/now/table/sys_user?sysparm_query=user_name=${profile.auth.username}&sysparm_fields=sys_id`,
    )
  )[0]?.["sys_id"] ?? "";
const scopeId = scope === "global" ? "global" : scope;
const prefNames = ["sys_update_set", `updateSetForScope${scopeId}`];

// Incidents every 200 ms from t=0 until delivery is done plus 2 s.
const created: { number: string; sysId: string; at: number }[] = [];
let stop = false;
const start = now();
const creator = (async () => {
  for (let n = 0; !stop; n++) {
    const at = now() - start;
    const row = await call("POST", "/api/now/table/incident?sysparm_fields=sys_id,number", {
      short_description: `${prefix} window ${n}`,
      caller_id: admin,
    });
    created.push({ number: row["number"] ?? "", sysId: row["sys_id"] ?? "", at });
    await Bun.sleep(Math.max(0, 200 - (now() - start - at)));
  }
})();

await Bun.sleep(1500);
const form = new FormData();
for (const file of readdirSync(appDir, { recursive: true, encoding: "utf8" }).filter((f) =>
  f.endsWith(".xml"),
)) {
  form.append(
    "files",
    new Blob([readFileSync(join(appDir, file))], { type: "application/xml" }),
    basename(file),
  );
}
const t: Record<string, number> = {};
t["load start"] = now() - start;
const load = await fetch(
  new URL(`/api/fluent/load/${scopeId}?targetUpdateSetId=${set}`, profile.url),
  {
    method: "POST",
    headers: { Authorization: auth, Accept: "application/json" },
    body: form,
  },
);
if (!load.ok) throw new Error(`load: ${load.status} ${await load.text()}`);
t["load done"] = now() - start;
const previous: { sysId: string; value: string }[] = [];
for (const name of prefNames) {
  const row = (
    await call(
      "GET",
      `/api/now/table/sys_user_preference?sysparm_query=${q(`user=${admin}^name=${name}`)}&sysparm_fields=sys_id,value`,
    )
  )[0];
  if (row === undefined) throw new Error(`no preference ${name}`);
  previous.push({ sysId: row["sys_id"] ?? "", value: row["value"] ?? "" });
  await call("PATCH", `/api/now/table/sys_user_preference/${row["sys_id"]}?sysparm_fields=sys_id`, {
    value: set,
  });
}
t["preferences selected"] = now() - start;
let published: unknown;
try {
  published = await call(
    "POST",
    `/api/now/wfa_fluent/activate_flows?sysparm_transaction_scope=${scopeId}`,
    {
      flows: [{ sys_id: flow, active: "true", state: "" }],
      actions: [],
    },
  );
} finally {
  t["publish done"] = now() - start;
  for (const p of previous) {
    await call("PATCH", `/api/now/table/sys_user_preference/${p.sysId}?sysparm_fields=sys_id`, {
      value: p.value,
    });
  }
}
await Bun.sleep(2000);
stop = true;
await creator;
console.log("publish:", JSON.stringify(published).slice(0, 200));
console.log(
  "timeline (ms):",
  Object.entries(t)
    .map(([k, v]) => `${k} ${Math.round(v)}`)
    .join(", "),
);
console.log(
  `window (load start → publish done): ${Math.round((t["publish done"] ?? 0) - (t["load start"] ?? 0))} ms`,
);

// Give the flows time to run, then see which incidents got the note.
await Bun.sleep(20000);
for (const c of created) {
  const notes = await call(
    "GET",
    `/api/now/table/sys_journal_field?sysparm_query=${q(`element_id=${c.sysId}^element=work_notes`)}&sysparm_fields=value`,
  );
  const ran = notes.map((n) => n["value"] ?? "");
  const phase =
    c.at < (t["load start"] ?? 0) ? "before" : c.at < (t["publish done"] ?? 0) ? "WINDOW" : "after";
  console.log(
    `${c.number} t=${Math.round(c.at)} ${phase} ${ran.length ? ran.join(" | ") : "NO RUN"}${ran.some((v) => v.includes(marker)) ? " (new version)" : ""}`,
  );
}

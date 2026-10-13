// Spike S9, step 2 (writes to a development instance): deliver ACLs without the Table API's
// security_admin check, as a remote update set loaded with Table API inserts, then previewed
// and committed through the CI/CD update set API.
//   bun tools/spikes/s9-acl-delivery/deliver.ts <workspace> <instance> load|preview|commit|check <acl files...>
// `load` prints the remote update set's sys_id; later steps take it as REMOTE=<sys_id>.
import { readFileSync } from "node:fs";
import { parse } from "yaml";
import { connect, signal } from "./connect";

const [workspace = ".", instance = "pdi", step = "check", ...files] = process.argv.slice(2);
const client = await connect(workspace, instance);
const remote = process.env["REMOTE"] ?? "";

type Doc = { _meta: { sys_id: string; sys_class_name: string }; [field: string]: unknown };
const docs = files.map((file) => parse(readFileSync(file, "utf8")) as Doc);
const acls = docs.filter((d) => d._meta.sys_class_name === "sys_security_acl");
const roles = docs.filter((d) => d._meta.sys_class_name === "sys_security_acl_role");

const xml = (value: string) =>
  value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
const element = (tag: string, fields: Record<string, string>) =>
  `<${tag} action="INSERT_OR_UPDATE">${Object.entries(fields)
    .map(([k, v]) => (v === "" ? `<${k}/>` : `<${k}>${xml(v)}</${k}>`))
    .join("")}</${tag}>`;
const fieldsOf = (doc: Doc) =>
  Object.fromEntries(
    Object.entries(doc)
      .filter(([k]) => k !== "_meta")
      .map(([k, v]) => [k, String(v)]),
  );

// One update per ACL, holding the ACL and its roles, as the platform records them.
function payload(acl: Doc): string {
  const id = acl._meta.sys_id;
  const own = roles.filter((r) => r["sys_security_acl"] === id);
  const record = element("sys_security_acl", {
    ...fieldsOf(acl),
    sys_class_name: "sys_security_acl",
    sys_id: id,
    sys_name: String(acl["name"]),
    sys_scope: "global",
    sys_update_name: `sys_security_acl_${id}`,
  });
  const children = own.map((r) =>
    element("sys_security_acl_role", { ...fieldsOf(r), sys_id: r._meta.sys_id }),
  );
  return `<?xml version="1.0" encoding="UTF-8"?><record_update table="sys_security_acl">${record}${children.join("")}</record_update>`;
}

const table = (path: string, what: string) => client.callApi("GET", path, what, signal);
const insert = (name: string, values: Record<string, string>) =>
  client.sendJson(
    "POST",
    `/api/now/table/${name}?sysparm_fields=sys_id`,
    values,
    `creating ${name}`,
    signal,
  );

async function waitFor(answer: unknown, what: string) {
  const id = (answer as { links?: { progress?: { id?: string } } }).links?.progress?.id;
  console.log(`${what}:`, JSON.stringify(answer));
  for (let i = 0; id !== undefined && i < 120; i++) {
    const progress = (await client.callApi("GET", `/api/sn_cicd/progress/${id}`, what, signal)) as {
      status?: string;
      status_label?: string;
      status_message?: string;
      percent_complete?: number;
    };
    if (!["0", "1"].includes(String(progress.status))) {
      console.log(`${what} finished:`, JSON.stringify(progress));
      return;
    }
    await Bun.sleep(3000);
  }
}

if (step === "load") {
  const set = (await insert("sys_remote_update_set", {
    name: "snagentic spike S9: on-call escalation ACLs",
    description: "Spike S9: delivering ACLs as a committed remote update set. Safe to delete.",
    state: "loaded",
    application: "global",
  })) as { sys_id: string };
  for (const acl of acls) {
    await insert("sys_update_xml", {
      remote_update_set: set.sys_id,
      name: `sys_security_acl_${acl._meta.sys_id}`,
      type: "Access Control",
      target_name: String(acl["name"]),
      action: "INSERT_OR_UPDATE",
      category: "customer",
      application: "global",
      update_domain: "global",
      payload: payload(acl),
    });
  }
  console.log(`REMOTE=${set.sys_id} (${acls.length} ACL updates, ${roles.length} roles)`);
} else if (step === "preview") {
  await waitFor(
    await client.callApi("POST", `/api/sn_cicd/update_set/preview/${remote}`, "preview", signal),
    "preview",
  );
  const query = encodeURIComponent(`remote_update_set=${remote}`);
  console.log(
    "problems:",
    JSON.stringify(
      await table(
        `/api/now/table/sys_update_preview_problem?sysparm_query=${query}&sysparm_fields=type,description,status&sysparm_no_count=true`,
        "preview problems",
      ),
    ),
  );
} else if (step === "commit") {
  await waitFor(
    await client.callApi("POST", `/api/sn_cicd/update_set/commit/${remote}`, "commit", signal),
    "commit",
  );
} else {
  const ids = acls.map((a) => a._meta.sys_id).join(",");
  const q = (s: string) => encodeURIComponent(s);
  const show = async (label: string, path: string) =>
    console.log(label, JSON.stringify(await table(path, label)));
  await show(
    "ACLs on the instance:",
    `/api/now/table/sys_security_acl?sysparm_query=${q(`sys_idIN${ids}`)}&sysparm_fields=sys_id,name,operation,active&sysparm_no_count=true`,
  );
  await show(
    "ACL roles:",
    `/api/now/table/sys_security_acl_role?sysparm_query=${q(`sys_security_aclIN${ids}`)}&sysparm_fields=sys_id,sys_security_acl,sys_user_role&sysparm_no_count=true`,
  );
  const names = acls.map((a) => `sys_security_acl_${a._meta.sys_id}`).join(",");
  await show(
    "update records (local and remote):",
    `/api/now/table/sys_update_xml?sysparm_query=${q(`nameIN${names}`)}&sysparm_fields=name,update_set.name,remote_update_set&sysparm_no_count=true`,
  );
  if (remote !== "") {
    await show(
      "remote update set:",
      `/api/now/table/sys_remote_update_set/${remote}?sysparm_fields=state,update_set,commit_date`,
    );
  }
}

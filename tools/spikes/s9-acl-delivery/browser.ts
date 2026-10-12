// Spike S9b (writes to a development instance): deliver ACLs through REST calls that ride a
// browser session in which a person logged in and elevated to security_admin.
//   bun tools/spikes/s9-acl-delivery/browser.ts <workspace> <instance> <acl and acl role files...>
// Needs playwright-core, which is not a repo dependency: install it outside the repo and
// run from there, or `bun add -d playwright-core` temporarily. Uses the installed Chrome.
// Not run yet: the PDI went offline on 2026-10-09 before the login step.
// Questions: does the session's elevation carry over to REST calls made outside the browser
// (cookie + X-UserToken)? Do the writes land in the update set chosen by the user preference?
import { readFileSync } from "node:fs";
import { chromium } from "playwright-core";
import { parse } from "yaml";
import { YamlProfileStore } from "../../../packages/cli/src/adapters/profiles/yaml-profile-store";
import { getInstance, InstanceName } from "../../../packages/core/src/index";

const [workspace = ".", instance = "pdi", ...files] = process.argv.slice(2);
const profile = await getInstance(workspace, InstanceName.parse(instance), new YamlProfileStore());
if (profile.kind !== "development") throw new Error("development instances only");
const base = profile.url.replace(/\/$/, "");

type Doc = { _meta: { sys_id: string; sys_class_name: string }; [field: string]: unknown };
const docs = files.map((f) => parse(readFileSync(f, "utf8")) as Doc);
const acls = docs.filter((d) => d._meta.sys_class_name === "sys_security_acl");
const roles = docs.filter((d) => d._meta.sys_class_name === "sys_security_acl_role");
const log = (...a: unknown[]) => console.log(new Date().toISOString().slice(11, 19), ...a);

// 1. A person logs in (any method: password, SSO, MFA) in a real Chrome window.
const browser = await chromium.launchPersistentContext(`${import.meta.dir}/chrome-profile`, {
  channel: "chrome",
  headless: false,
});
let page = browser.pages()[0] ?? (await browser.newPage());
await page.goto(`${base}/login.do`);
log("LOG IN in the Chrome window (do not elevate yet).");
let token = "";
for (let i = 0; i < 300 && token === ""; i++) {
  await Bun.sleep(2000);
  if (page.isClosed()) {
    page = browser.pages()[0] ?? (await browser.newPage());
    await page.goto(`${base}/login.do`).catch(() => undefined);
    log("window was closed; reopened the login page.");
  }
  token = await page
    .evaluate(() => String((window as unknown as { g_ck?: string }).g_ck ?? ""))
    .catch(() => "");
}
if (token === "") throw new Error("no session token after 10 minutes");

// 2. From here on, plain REST calls outside the browser, carrying only its cookies and token.
async function rest(method: string, path: string, body?: unknown) {
  const cookies = (await browser.cookies(base)).map((c) => `${c.name}=${c.value}`).join("; ");
  const response = await fetch(`${base}${path}`, {
    method,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      Cookie: cookies,
      "X-UserToken": token,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  return {
    status: response.status,
    body: text.startsWith("{") ? JSON.parse(text) : text.slice(0, 300),
  };
}
const q = encodeURIComponent;
const rows = async (path: string) =>
  ((await rest("GET", path)).body as { result?: Record<string, string>[] }).result ?? [];

const me = (
  await rows(
    `/api/now/table/sys_user?sysparm_query=${q("sys_id=javascript:gs.getUserID()")}&sysparm_fields=sys_id,user_name&sysparm_no_count=true`,
  )
)[0];
log("session user:", JSON.stringify(me));
const ops = Object.fromEntries(
  (
    await rows(
      `/api/now/table/sys_security_operation?sysparm_query=${q("nameINread,write,create,delete")}&sysparm_fields=sys_id,name&sysparm_no_count=true`,
    )
  ).map((r) => [r["name"], r["sys_id"]]),
);

// 3. A fresh update set, made current through the user preference (what push does today).
const set = await rest("POST", "/api/now/table/sys_update_set?sysparm_fields=sys_id,name", {
  name: "snagentic spike S9b: ACLs through a browser session",
  description: "Spike S9b. Safe to delete.",
  application: "global",
  state: "in progress",
});
const setId = (set.body as { result: { sys_id: string } }).result.sys_id;
log("update set:", set.status, setId);
const prefQuery = q(`user=${me?.["sys_id"]}^name=sys_update_set`);
const pref = (
  await rows(
    `/api/now/table/sys_user_preference?sysparm_query=${prefQuery}&sysparm_fields=sys_id,value&sysparm_no_count=true`,
  )
)[0];
log("previous preference:", JSON.stringify(pref));
const prefWrite = pref
  ? await rest("PATCH", `/api/now/table/sys_user_preference/${pref["sys_id"]}`, { value: setId })
  : await rest("POST", "/api/now/table/sys_user_preference", {
      user: me?.["sys_id"],
      name: "sys_update_set",
      value: setId,
    });
log("preference set:", prefWrite.status);

const fields = (d: Doc) =>
  Object.fromEntries(
    Object.entries(d)
      .filter(([k]) => k !== "_meta")
      .map(([k, v]) => [k, String(v)]),
  );
const aclBody = (d: Doc) => ({
  ...fields(d),
  operation: ops[String(d["operation"])] ?? String(d["operation"]),
  sys_id: d._meta.sys_id,
});
const insertAcl = (d: Doc) =>
  rest("POST", "/api/now/table/sys_security_acl?sysparm_fields=sys_id,name,operation", aclBody(d));

// 4. Control: before elevation the write must be refused, or elevation is not the issue.
const [firstAcl, ...rest_] = acls;
if (firstAcl === undefined) throw new Error("no ACL files given");
let first = await insertAcl(firstAcl);
log("control, not elevated:", first.status, JSON.stringify(first.body).slice(0, 300));

// 5. The person elevates; retry every 10 seconds.
if (first.status >= 300) {
  log("NOW ELEVATE: user menu > Elevate role > security_admin.");
  for (let i = 0; i < 60 && first.status >= 300; i++) {
    await Bun.sleep(10_000);
    first = await insertAcl(firstAcl);
    log("attempt", i + 1, first.status);
  }
}
log("first ACL:", first.status, JSON.stringify(first.body));
for (const d of rest_) {
  const r = await insertAcl(d);
  log("ACL", d._meta.sys_id, r.status, JSON.stringify(r.body).slice(0, 200));
}
for (const d of roles) {
  const r = await rest("POST", "/api/now/table/sys_security_acl_role?sysparm_fields=sys_id", {
    ...fields(d),
    sys_id: d._meta.sys_id,
  });
  log("role", d._meta.sys_id, r.status, JSON.stringify(r.body).slice(0, 200));
}

// 6. Where did the update records land?
const names = acls.map((a) => `sys_security_acl_${a._meta.sys_id}`).join(",");
log(
  "update records:",
  JSON.stringify(
    await rows(
      `/api/now/table/sys_update_xml?sysparm_query=${q(`nameIN${names}`)}&sysparm_fields=name,update_set,sys_created_by&sysparm_no_count=true`,
    ),
  ),
);
log(
  "records in the spike set:",
  JSON.stringify(
    await rows(
      `/api/now/table/sys_update_xml?sysparm_query=${q(`update_set=${setId}`)}&sysparm_fields=name,type&sysparm_no_count=true`,
    ),
  ),
);
const ids = acls.map((a) => a._meta.sys_id).join(",");
log(
  "ACLs:",
  JSON.stringify(
    await rows(
      `/api/now/table/sys_security_acl?sysparm_query=${q(`sys_idIN${ids}`)}&sysparm_fields=sys_id,name,operation,active&sysparm_no_count=true`,
    ),
  ),
);
log(
  "ACL roles:",
  JSON.stringify(
    await rows(
      `/api/now/table/sys_security_acl_role?sysparm_query=${q(`sys_security_aclIN${ids}`)}&sysparm_fields=sys_id,sys_user_role&sysparm_no_count=true`,
    ),
  ),
);

// 7. Put the preference back.
if (pref)
  await rest("PATCH", `/api/now/table/sys_user_preference/${pref["sys_id"]}`, {
    value: pref["value"],
  });
log("done; preference restored:", pref !== undefined);
await browser.close();

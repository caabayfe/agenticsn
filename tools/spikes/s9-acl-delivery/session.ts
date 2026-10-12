// Spike S9c (writes to a development instance): deliver ACLs with no manual step.
// Playwright signs in with the keychain password in a throwaway Chrome profile, elevates to
// security_admin through the elevated_role_dialog UI page, then creates ACLs with REST calls made
// from inside the page (same session). It also imports a second ACL as XML, to compare which of
// the two is recorded in the current update set.
//   PLAYWRIGHT=<path to playwright-core/index.mjs> bun session.ts <workspace> <instance> [--headless]
// Both ACLs are inactive and guard a field that does not exist, so they change no access.
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
import { connect, signal } from "./connect";

const [workspace = ".", instance = "pdi2", flag = ""] = process.argv.slice(2);
const profile = await getInstance(workspace, InstanceName.parse(instance), new YamlProfileStore());
ensureDevelopmentInstance(profile);
const password = await resolveSecret(
  profile,
  new LayeredCredentialStore(
    new EnvironmentCredentialStore(process.env),
    new KeychainCredentialStore(),
  ),
);
const base = profile.url.replace(/\/$/, "");
const log = (...a: unknown[]) => console.log(new Date().toISOString().slice(11, 19), ...a);
const q = encodeURIComponent;

// 0. Choose the update set BEFORE signing in, through the normal API (as push does): an
// interactive session reads the current update set at sign-in (run 1 landed in "Default").
const client = await connect(workspace, instance);
const list = async (path: string, what: string) =>
  (await client.callApi("GET", path, what, signal)) as Record<string, string>[];
const meId =
  (
    await list(
      `/api/now/table/sys_user?sysparm_query=${q("sys_id=javascript:gs.getUserID()")}&sysparm_fields=sys_id&sysparm_no_count=true`,
      "me",
    )
  )[0]?.["sys_id"] ?? "";
const setId = (
  (await client.sendJson(
    "POST",
    "/api/now/table/sys_update_set?sysparm_fields=sys_id",
    {
      name: "snagentic spike S9c run 2: ACLs with no manual step",
      description: "Spike S9c. Safe to delete.",
      application: "global",
      state: "in progress",
    },
    "creating the spike update set",
    signal,
  )) as { sys_id: string }
).sys_id;
const pref = (
  await list(
    `/api/now/table/sys_user_preference?sysparm_query=${q(`user=${meId}^name=sys_update_set`)}&sysparm_fields=sys_id,value&sysparm_no_count=true`,
    "preference",
  )
)[0];
if (pref)
  await client.sendJson(
    "PATCH",
    `/api/now/table/sys_user_preference/${pref["sys_id"]}`,
    { value: setId },
    "setting the preference",
    signal,
  );
else
  await client.sendJson(
    "POST",
    "/api/now/table/sys_user_preference",
    { user: meId, name: "sys_update_set", value: setId },
    "creating the preference",
    signal,
  );
log("update set chosen before sign-in:", setId, "previous:", JSON.stringify(pref));
const { chromium } = await import(process.env["PLAYWRIGHT"] ?? "playwright-core");

// 1. Sign in. No persistent profile: the session cookies never touch the disk.
const browser = await chromium.launch({ channel: "chrome", headless: flag === "--headless" });
const page = await (await browser.newContext()).newPage();
await page.goto(`${base}/login.do`);
await page.fill("#user_name", profile.auth.username);
await page.fill("#user_password", password);
await page.click("#sysverb_login");
// The sign-in redirects several times, and the token changes at sign-in: read it only once the
// landing page has settled.
await page.waitForURL((u: URL) => !u.pathname.includes("login"), { timeout: 60_000 });
await page.waitForLoadState("networkidle").catch(() => undefined);
let token = "";
for (let i = 0; i < 30 && token === ""; i++) {
  await Bun.sleep(1000);
  token = await page
    .evaluate(() => String((window as unknown as { g_ck?: string }).g_ck ?? ""))
    .catch(() => "");
}
if (token === "") throw new Error(`no session token after sign-in (at ${page.url()})`);
log("signed in; token found at", page.url());
// A JSON response is a page that runs no script and never navigates, so calls made from it
// cannot be cut off by a redirect.
await page.goto(
  `${base}/api/now/table/sys_user?sysparm_limit=1&sysparm_fields=sys_id&sysparm_no_count=true`,
);

// 2. Every call runs inside the page, so it carries the page's session and elevation.
type Answer = { status: number; body: unknown };
async function call(method: string, path: string, body?: unknown): Promise<Answer> {
  return page.evaluate(
    async ([m, p, b, t]: [string, string, string | null, string]) => {
      const r = await fetch(p, {
        method: m,
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          "X-UserToken": t,
        },
        ...(b === null ? {} : { body: b }),
      });
      const text = await r.text();
      return {
        status: r.status,
        body: text.startsWith("{") ? JSON.parse(text) : text.slice(0, 300),
      };
    },
    [method, path, body === undefined ? null : JSON.stringify(body), token] as [
      string,
      string,
      string | null,
      string,
    ],
  );
}
const rows = async (path: string) =>
  ((await call("GET", path)).body as { result?: Record<string, string>[] }).result ?? [];
const one = (a: Answer) => JSON.stringify(a.body).slice(0, 250);

const me = (
  await rows(
    `/api/now/table/sys_user?sysparm_query=${q("sys_id=javascript:gs.getUserID()")}&sysparm_fields=sys_id,user_name&sysparm_no_count=true`,
  )
)[0];
log("session user:", JSON.stringify(me));
const read =
  (
    await rows(
      `/api/now/table/sys_security_operation?sysparm_query=${q("name=read")}&sysparm_fields=sys_id&sysparm_no_count=true`,
    )
  )[0]?.["sys_id"] ?? "";

const REST_ID = "5e1a5e1a5e1a5e1a5e1a5e1a5e1a0003";
const XML_ID = "5e1a5e1a5e1a5e1a5e1a5e1a5e1a0004";
const acl = (id: string, field: string) => ({
  sys_id: id,
  name: `incident.${field}`,
  type: "record",
  operation: read,
  decision_type: "allow",
  active: "false",
  admin_overrides: "true",
  description: "snagentic spike S9c. Inactive, guards a field that does not exist. Safe to delete.",
});
const insertRestAcl = () =>
  call(
    "POST",
    "/api/now/table/sys_security_acl?sysparm_fields=sys_id,name",
    acl(REST_ID, "u_snagentic_s9_rest2"),
  );

// 4. Control: before elevation the write must be refused, or elevation is not the issue.
const control = await insertRestAcl();
log("control, not elevated:", control.status, one(control));

// 5. Elevate: the same form post the Elevate dialog makes.
const elevate = await page.evaluate(
  async ([t]: [string]) => {
    const form = new URLSearchParams({
      name: "elevated_role_dialog",
      elevated_roles: "security_admin",
      sysparm_ck: t,
    });
    const r = await fetch("/ui_page_process.do", {
      method: "POST",
      body: form,
      redirect: "manual",
    });
    return { status: r.status, type: r.type };
  },
  [token] as [string],
);
log("elevation post:", JSON.stringify(elevate));

// 6. The REST insert, elevated.
const first = control.status < 300 ? control : await insertRestAcl();
log("REST ACL, elevated:", first.status, one(first));
const role = await call("POST", "/api/now/table/sys_security_acl_role?sysparm_fields=sys_id", {
  sys_security_acl: REST_ID,
  sys_user_role: "itil",
});
log("REST ACL role:", role.status, one(role));

// 7. The XML import of a second ACL, elevated, through the page Import XML uses.
const fields = acl(XML_ID, "u_snagentic_s9_xml2");
const body = Object.entries({ ...fields, sys_class_name: "sys_security_acl", sys_scope: "global" })
  .map(([k, v]) => `<${k}>${v}</${k}>`)
  .join("");
const unload = `<?xml version="1.0" encoding="UTF-8"?><unload unload_date="2026-10-12 12:00:00"><sys_security_acl action="INSERT_OR_UPDATE">${body}</sys_security_acl></unload>`;
const upload = await page.evaluate(
  async ([t, xml]: [string, string]) => {
    const form = new FormData();
    form.append("sysparm_ck", t);
    form.append("sysparm_referring_url", "sys_security_acl_list.do");
    form.append("sysparm_target", "sys_security_acl");
    form.append("attachFile", new File([xml], "acl.xml", { type: "text/xml" }));
    const r = await fetch("/sys_upload.do", { method: "POST", body: form, redirect: "manual" });
    return { status: r.status, type: r.type };
  },
  [token, unload] as [string, string],
);
log("XML import post:", JSON.stringify(upload));
await Bun.sleep(3000);

// 8. What exists, and which update set recorded it?
const ids = `${REST_ID},${XML_ID}`;
log(
  "ACLs:",
  JSON.stringify(
    await rows(
      `/api/now/table/sys_security_acl?sysparm_query=${q(`sys_idIN${ids}`)}&sysparm_fields=sys_id,name,active&sysparm_no_count=true`,
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
const names = `sys_security_acl_${REST_ID},sys_security_acl_${XML_ID}`;
log(
  "update records for the ACLs:",
  JSON.stringify(
    await rows(
      `/api/now/table/sys_update_xml?sysparm_query=${q(`nameIN${names}`)}&sysparm_fields=name,update_set.name,sys_created_by&sysparm_no_count=true`,
    ),
  ),
);
log(
  "everything in the spike set:",
  JSON.stringify(
    await rows(
      `/api/now/table/sys_update_xml?sysparm_query=${q(`update_set=${setId}`)}&sysparm_fields=name,type&sysparm_no_count=true`,
    ),
  ),
);

// 9. Clean up every spike ACL (runs 1 and 2), still elevated, then put the preference back.
const all = ["0001", "0002", "0003", "0004"].map((n) => `5e1a5e1a5e1a5e1a5e1a5e1a5e1a${n}`);
for (const r of await rows(
  `/api/now/table/sys_security_acl_role?sysparm_query=${q(`sys_security_aclIN${all.join(",")}`)}&sysparm_fields=sys_id&sysparm_no_count=true`,
)) {
  log(
    "delete ACL role:",
    (await call("DELETE", `/api/now/table/sys_security_acl_role/${r["sys_id"]}`)).status,
  );
}
for (const id of all)
  log(
    "delete ACL",
    id.slice(-4),
    (await call("DELETE", `/api/now/table/sys_security_acl/${id}`)).status,
  );
if (pref)
  await client.sendJson(
    "PATCH",
    `/api/now/table/sys_user_preference/${pref["sys_id"]}`,
    { value: pref["value"] },
    "restoring the preference",
    signal,
  );
log("done; preference restored:", pref !== undefined);
await browser.close();

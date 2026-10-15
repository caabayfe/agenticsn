// Spike S11, criterion 3: is a flow captured in the update set push selects?
// 1. Find or create a scratch update set in the flow's scope.
// 2. Load the built app without publishing (now-sdk install --skip-flow-activation).
// 3. Make the set current the way push does (apps.current_app, updateSetForScope<scope>).
// 4. Publish through the activation endpoint.
// 5. List the update records in the scratch set; restore both preferences (always).
//   bun capture.ts <workspace> <instance> <app dir> <scope sys_id> <flow sys_id>
import { connect, signal } from "../s9-acl-delivery/connect";

const [workspace = ".", instance = "pdi2", appDir = ".", scopeId = "", flowId = ""] =
  process.argv.slice(2);
const client = await connect(workspace, instance);
type Row = Record<string, string>;
const list = async (table: string, query: string, fields: string) =>
  (await client.callApi(
    "GET",
    `/api/now/table/${table}?sysparm_query=${encodeURIComponent(query)}&sysparm_fields=${fields}&sysparm_exclude_reference_link=true&sysparm_no_count=true`,
    table,
    signal,
  )) as Row[];

const admin = (await list("sys_user", "user_name=admin", "sys_id"))[0]?.sys_id ?? "";

const switched: { sysId: string; name: string; previous: string; created: boolean }[] = [];
const prefer = async (name: string, value: string) => {
  const existing = (
    await list("sys_user_preference", `user=${admin}^name=${name}`, "sys_id,value")
  )[0];
  if (existing !== undefined) {
    await client.sendJson(
      "PATCH",
      `/api/now/table/sys_user_preference/${existing["sys_id"]}?sysparm_fields=sys_id`,
      { value },
      name,
      signal,
    );
    switched.push({
      sysId: existing["sys_id"] ?? "",
      name,
      previous: existing["value"] ?? "",
      created: false,
    });
  } else {
    const row = (await client.sendJson(
      "POST",
      "/api/now/table/sys_user_preference?sysparm_fields=sys_id",
      { user: admin, name, value },
      name,
      signal,
    )) as Row;
    switched.push({ sysId: row["sys_id"] ?? "", name, previous: "", created: true });
  }
};
try {
  const install = Bun.spawn(
    [
      "bun",
      "tools/spikes/s11-flow-delivery/sdk.ts",
      workspace,
      instance,
      appDir,
      "install",
      "--skip-flow-activation",
    ],
    { stdout: "inherit", stderr: "inherit" },
  );
  if ((await install.exited) !== 0) throw new Error("install failed");
  const afterLoad = (
    await list("sys_hub_flow", `sys_idIN${flowId}`, "name,status,active,master_snapshot")
  )[0];
  console.log("flow after load, before publish:", JSON.stringify(afterLoad));
  // After the load: the install resets the user's update set preferences to the app's Default.
  await prefer("apps.current_app", scopeId);
  // Created only now: the Table API puts a new record in the user's current application
  // (ADR-0025), and a scope ignores an update set preference that names another scope's set.
  const NAME = "snagentic spike S11: scoped capture";
  let set: string | undefined = (
    await list("sys_update_set", `name=${NAME}^application=${scopeId}^state=in progress`, "sys_id")
  )[0]?.sys_id;
  if (set === undefined) {
    const created = (await client.sendJson(
      "POST",
      "/api/now/table/sys_update_set?sysparm_fields=sys_id",
      {
        name: NAME,
        application: scopeId,
        state: "in progress",
        description: "Spike S11; safe to delete.",
      },
      "scratch update set",
      signal,
    )) as Row;
    set = created["sys_id"] ?? "";
  }
  console.log("scratch update set:", set);
  await prefer(`updateSetForScope${scopeId}`, set);
  console.log("preferences switched:", switched.map((s) => s.name).join(", "));

  const published = await client.sendJson(
    "POST",
    `/api/now/wfa_fluent/activate_flows?sysparm_transaction_scope=${scopeId}`,
    {
      flows: flowId.split(",").map((sys_id) => ({ sys_id, active: "true", state: "" })),
      actions: [],
    },
    "publishing",
    signal,
  );
  console.log("publish:", JSON.stringify(published));
} catch (error) {
  console.log("failed:", error instanceof Error ? error.message : String(error));
} finally {
  for (const s of switched.reverse()) {
    if (s.created)
      await client
        .callApi(
          "DELETE",
          `/api/now/table/sys_user_preference/${s.sysId}`,
          `remove ${s.name}`,
          signal,
        )
        .catch((e) => console.log("restore failed", s.name, String(e)));
    else
      await client
        .sendJson(
          "PATCH",
          `/api/now/table/sys_user_preference/${s.sysId}?sysparm_fields=sys_id`,
          { value: s.previous },
          s.name,
          signal,
        )
        .catch((e) => console.log("restore failed", s.name, String(e)));
  }
  console.log("preferences restored");
}
console.log(
  "records in scratch set:",
  JSON.stringify(
    await list(
      "sys_update_xml",
      `update_set.name=snagentic spike S11: scoped capture^sys_updated_on>javascript:gs.minutesAgoStart(3)`,
      "name,type,action,sys_updated_on",
    ),
    null,
    2,
  ),
);
console.log(
  "flow now:",
  JSON.stringify(
    await list("sys_hub_flow", `sys_idIN${flowId}`, "name,status,active,master_snapshot"),
  ),
);

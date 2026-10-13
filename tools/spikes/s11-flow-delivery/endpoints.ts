// Spike S11: do the flow activation and Fluent load endpoints exist? Activation is called with
// empty lists, so it changes nothing.
import { connect, signal } from "../s9-acl-delivery/connect";

const [workspace = ".", instance = "pdi2"] = process.argv.slice(2);
const client = await connect(workspace, instance);
const probe = async (label: string, run: () => Promise<unknown>) => {
  try {
    console.log(label, "answered:", JSON.stringify(await run()).slice(0, 400));
  } catch (error) {
    console.log(
      label,
      "refused:",
      error instanceof Error ? error.message.slice(0, 400) : String(error),
    );
  }
};
await probe("activate_flows (empty)", () =>
  client.sendJson(
    "POST",
    "/api/now/wfa_fluent/activate_flows",
    { flows: [], actions: [] },
    "empty activation",
    signal,
  ),
);
await probe("fluent/load (GET)", () =>
  client.callApi(
    "GET",
    "/api/fluent/load/00000000000000000000000000000000",
    "fluent load probe",
    signal,
  ),
);
const q = encodeURIComponent("nameLIKEServiceNow IDE^ORnameLIKEFluent");
await probe("IDE apps", () =>
  client.callApi(
    "GET",
    `/api/now/table/sys_store_app?sysparm_query=${q}&sysparm_fields=name,scope,version,active&sysparm_no_count=true`,
    "IDE app",
    signal,
  ),
);

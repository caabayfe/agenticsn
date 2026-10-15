// Spike S11 (read-only): the domain setup that blocked publishing, and the flow's state.
import { connect, signal } from "../s9-acl-delivery/connect";

const [workspace = ".", instance = "pdi2"] = process.argv.slice(2);
const client = await connect(workspace, instance);
const get = (path: string) => client.callApi("GET", path, path, signal);
const show = async (label: string, path: string) => {
  try {
    console.log(label, JSON.stringify(await get(path)));
  } catch (e) {
    console.log(label, "refused:", e instanceof Error ? e.message.slice(0, 200) : e);
  }
};
await show(
  "domain plugins",
  `/api/now/table/v_plugin?sysparm_query=${encodeURIComponent("idSTARTSWITHcom.glide.domain")}&sysparm_fields=id,name,active&sysparm_no_count=true`,
);
await show(
  "admin",
  `/api/now/table/sys_user?sysparm_query=user_name=admin&sysparm_fields=sys_domain,sys_domain_path&sysparm_display_value=true&sysparm_no_count=true`,
);
await show(
  "domain prefs",
  `/api/now/table/sys_user_preference?sysparm_query=${encodeURIComponent("user.user_name=admin^nameLIKEdomain")}&sysparm_fields=name,value&sysparm_no_count=true`,
);
await show(
  "flow",
  `/api/now/table/sys_hub_flow/8a924849cd84412081573bb363ec4326?sysparm_fields=status,active,sys_domain,master_snapshot,latest_snapshot&sysparm_display_value=true`,
);

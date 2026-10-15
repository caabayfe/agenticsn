// Spike S11: release, vendor prefix and plugins that matter to flows (read-only).
import { connect, signal } from "../s9-acl-delivery/connect";

const [workspace = ".", instance = "pdi2"] = process.argv.slice(2);
const client = await connect(workspace, instance);
const q = encodeURIComponent(
  "nameINglide.buildtag,glide.war,glide.buildname,glide.appcreator.company.code",
);
console.log(
  JSON.stringify(
    await client.callApi(
      "GET",
      `/api/now/table/sys_properties?sysparm_query=${q}&sysparm_fields=name,value&sysparm_no_count=true`,
      "release properties",
      signal,
    ),
  ),
);
const p = encodeURIComponent(
  "idINcom.glide.hub.flow_engine,com.glide.hub.flow_designer,com.sn_cicd_spoke,com.glide.continuousdelivery,sn_cicd,com.glide.sdk",
);
console.log(
  JSON.stringify(
    await client.callApi(
      "GET",
      `/api/now/table/v_plugin?sysparm_query=${p}&sysparm_fields=id,name,active,version&sysparm_no_count=true`,
      "flow and CI/CD plugins",
      signal,
    ),
  ),
);

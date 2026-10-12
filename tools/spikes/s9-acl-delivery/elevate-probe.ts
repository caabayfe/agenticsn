// Spike S9c (read-only): which records implement role elevation on this release.
import { connect, signal } from "./connect";

const [workspace = ".", instance = "pdi2"] = process.argv.slice(2);
const client = await connect(workspace, instance);
const q = encodeURIComponent;
const show = async (label: string, table: string, query: string, fields: string) =>
  console.log(
    label,
    JSON.stringify(
      await client.callApi(
        "GET",
        `/api/now/table/${table}?sysparm_query=${q(query)}&sysparm_fields=${fields}&sysparm_no_count=true&sysparm_limit=20`,
        label,
        signal,
      ),
    ),
  );
await show("build:", "sys_properties", "name=glide.buildtag.last^ORname=glide.war", "name,value");
await show("ui pages:", "sys_ui_page", "nameLIKEelevat", "sys_id,name,processing_script");
await show(
  "script includes:",
  "sys_script_include",
  "nameLIKEelevat^ORnameLIKEElevat",
  "sys_id,name,client_callable,api_name",
);
await show(
  "rest operations:",
  "sys_ws_operation",
  "nameLIKEelevat^ORrelative_pathLIKEelevat",
  "sys_id,name,http_method,relative_path,web_service_definition.base_uri",
);
await show("elevated roles:", "sys_user_role", "elevated_privilege=true", "name");

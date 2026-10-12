// Spike S9c (read-only): what session.ts left on the instance.
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
        `/api/now/table/${table}?sysparm_query=${q(query)}&sysparm_fields=${fields}&sysparm_no_count=true&sysparm_exclude_reference_link=true`,
        label,
        signal,
      ),
    ),
  );
const ids = "5e1a5e1a5e1a5e1a5e1a5e1a5e1a0001,5e1a5e1a5e1a5e1a5e1a5e1a5e1a0002";
await show(
  "spike update sets:",
  "sys_update_set",
  "nameSTARTSWITHsnagentic spike S9c",
  "sys_id,name,state,sys_created_on",
);
await show(
  "ACLs:",
  "sys_security_acl",
  `sys_idIN${ids}`,
  "sys_id,name,active,sys_created_by,sys_created_on",
);
await show(
  "ACL roles:",
  "sys_security_acl_role",
  `sys_security_aclIN${ids}`,
  "sys_id,sys_security_acl,sys_user_role",
);
await show(
  "update records:",
  "sys_update_xml",
  "nameINsys_security_acl_5e1a5e1a5e1a5e1a5e1a5e1a5e1a0001,sys_security_acl_5e1a5e1a5e1a5e1a5e1a5e1a5e1a0002",
  "name,update_set,sys_created_on",
);
await show(
  "elevation events:",
  "sysevent",
  "name=security.elevated_role.enabled^sys_created_onONToday@javascript:gs.beginningOfToday()@javascript:gs.endOfToday()",
  "parm1,parm2,sys_created_on",
);

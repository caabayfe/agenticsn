// Spike S-A: does the instance accept an application whose scope has another vendor prefix than
// its company code (glide.appcreator.company.code)? Push creates applications from files with
// the Table API (ADR-0025); the ITSM pack's scope is x_nttdata_acc.
//   bun s-a.ts <workspace> <instance>
import { instance } from "./instance";

const [workspace = ".", name = "pdi2"] = process.argv.slice(2);
const call = await instance(workspace, name);
const code = await call(
  "GET",
  "/api/now/table/sys_properties?sysparm_query=name=glide.appcreator.company.code&sysparm_fields=value",
);
console.log("company code:", JSON.stringify(code.json));
const scope = "x_nttdata_s005a";
const created = await call(
  "POST",
  "/api/now/table/sys_app?sysparm_fields=sys_id,scope,name,active",
  {
    name: "snagentic test S-A foreign prefix",
    scope,
    version: "1.0.0",
  },
);
console.log("create:", created.status, JSON.stringify(created.json).slice(0, 400));
const sysId = (created.json as { result?: { sys_id?: string } }).result?.sys_id;
if (sysId) {
  const scopeRow = await call(
    "GET",
    `/api/now/table/sys_scope?sysparm_query=sys_id=${sysId}&sysparm_fields=scope,name,vendor_prefix,source`,
  );
  console.log("sys_scope:", JSON.stringify(scopeRow.json));
  const off = await call("PATCH", `/api/now/table/sys_app/${sysId}?sysparm_fields=active`, {
    active: "false",
  });
  console.log("set inactive:", off.status, JSON.stringify(off.json));
}

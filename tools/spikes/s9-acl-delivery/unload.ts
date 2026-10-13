// Spike S9: the ACLs and their roles as an "unload" XML file, the format the platform's
// Import XML reads, keeping each record's sys_id.
//   bun tools/spikes/s9-acl-delivery/unload.ts <out.xml> <acl and acl role files...>
import { readFileSync, writeFileSync } from "node:fs";
import { parse } from "yaml";

const [out = "acls.xml", ...files] = process.argv.slice(2);
type Doc = { _meta: { sys_id: string; sys_class_name: string }; [field: string]: unknown };
const xml = (value: string) =>
  value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
const records = files.map((file) => {
  const doc = parse(readFileSync(file, "utf8")) as Doc;
  const table = doc._meta.sys_class_name;
  const fields: Record<string, string> = {
    ...Object.fromEntries(
      Object.entries(doc)
        .filter(([k]) => k !== "_meta")
        .map(([k, v]) => [k, String(v)]),
    ),
    sys_id: doc._meta.sys_id,
    sys_class_name: table,
    sys_scope: "global",
  };
  const body = Object.entries(fields)
    .map(([k, v]) => `<${k}>${xml(v)}</${k}>`)
    .join("");
  // ACLs first, so their roles refer to records that exist.
  return {
    order: table === "sys_security_acl" ? 0 : 1,
    text: `<${table} action="INSERT_OR_UPDATE">${body}</${table}>`,
  };
});
records.sort((a, b) => a.order - b.order);
writeFileSync(
  out,
  `<?xml version="1.0" encoding="UTF-8"?><unload unload_date="2026-10-08 21:00:00">${records.map((r) => r.text).join("")}</unload>\n`,
);
console.log(`wrote ${records.length} records to ${out}`);

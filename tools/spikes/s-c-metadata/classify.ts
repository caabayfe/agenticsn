// Spike S-C (spec 005): for each table the ITSM pack's waves 0 and 1 need, is it metadata
// (extends sys_metadata: mirrored, pushed, captured in update sets) or a data record (loaded per
// instance)? Reads the table hierarchy from a workspace's mirror; no instance call.
//   bun classify.ts <workspace> <instance>
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";

const [workspace = ".", instance = "pdi2"] = process.argv.slice(2);
const metadata = join(workspace, "instances", instance, "metadata");

const TABLES: Readonly<Record<string, string>> = {
  contract_sla: "SLA and OLA definitions",
  cmn_schedule: "schedules",
  cmn_schedule_span: "schedule entries",
  cmn_rota: "on-call rotas",
  cmn_rota_roster: "rota rosters",
  cmn_rota_escalation_set: "escalation sets",
  sysrule_assignment: "assignment rules",
  dl_definition: "data lookup definitions",
  dl_u_assignment: "assignment data lookups",
  dl_u_priority: "priority data lookups",
  sysevent_email_action: "notifications",
  sysevent_in_email_action: "inbound email actions",
  sc_cat_item_producer: "record producers",
  sc_cat_item: "catalog items",
  kb_knowledge_base: "knowledge bases",
  kb_knowledge: "knowledge articles",
  sys_cs_topic: "Virtual Agent topics",
  sys_ux_page_registry: "workspace pages",
  sys_ux_app_config: "workspace configuration",
  pa_indicators: "Performance Analytics indicators",
  sys_user_group: "groups",
  sys_user_role: "roles",
  sys_properties: "system properties",
  cmn_location: "locations",
  core_company: "companies",
  cmdb_ci_service: "services",
  service_offering: "service offerings",
  sys_choice: "choices",
  sys_hub_flow: "flows",
  sys_security_acl: "ACLs",
};

const bySysId = new Map<string, { name: string; superClass: string }>();
for (const scope of readdirSync(metadata)) {
  const folder = join(metadata, scope, "sys_db_object");
  let files: string[] = [];
  try {
    files = readdirSync(folder).filter((f) => f.endsWith(".yaml") && !f.includes(".children."));
  } catch {
    continue;
  }
  for (const file of files) {
    const doc = parse(readFileSync(join(folder, file), "utf8")) as Record<string, unknown>;
    const meta = doc["_meta"] as Record<string, string>;
    bySysId.set(meta["sys_id"] ?? "", {
      name: String(doc["name"] ?? ""),
      superClass: String(doc["super_class"] ?? ""),
    });
  }
}
const byName = new Map([...bySysId.values()].map((t) => [t.name, t]));

// A table's collection dictionary entry: update_synch=true makes update sets capture its
// records although it does not extend sys_metadata (sys_choice, for example).
const synched = new Set<string>();
for (const scope of readdirSync(metadata)) {
  const folder = join(metadata, scope, "sys_dictionary");
  let files: string[] = [];
  try {
    files = readdirSync(folder).filter((f) => f.endsWith(".yaml"));
  } catch {
    continue;
  }
  for (const file of files) {
    const text = readFileSync(join(folder, file), "utf8");
    if (!text.includes("internal_type: collection") || !text.includes("update_synch")) continue;
    const doc = parse(text) as Record<string, unknown>;
    if (/update_synch=true/.test(String(doc["attributes"] ?? ""))) synched.add(String(doc["name"]));
  }
}

function chain(name: string): string[] {
  const path: string[] = [];
  let current = byName.get(name);
  while (current !== undefined && path.length < 20) {
    path.push(current.name);
    current = bySysId.get(current.superClass);
  }
  return path;
}

console.log(`tables in the mirror: ${bySysId.size}\n`);
console.log("| Table | What | Metadata (push) or record (load) | Chain |\n|---|---|---|---|");
for (const [table, what] of Object.entries(TABLES)) {
  const path = chain(table);
  const kind =
    path.length === 0
      ? "not on this instance"
      : path.includes("sys_metadata")
        ? "metadata"
        : path.some((t) => synched.has(t))
          ? "record, captured (update_synch)"
          : "record";
  console.log(`| ${table} | ${what} | ${kind} | ${path.join(" → ")} |`);
}

// Spike S16 (F2–F4): live steps on a development instance, through snagentic's own client (the
// credential is read only by snagentic code, requests go through its scheduler). Not product code.
//   bun live.ts <workspace> <instance> set <scope sys_id> <name>        find or create an update set
//   bun live.ts <workspace> <instance> load <scope sys_id> <set> <built dir> [<file>...]
//   bun live.ts <workspace> <instance> updates <set> [<since>]           what the set records
//   bun live.ts <workspace> <instance> query <table> <query> <fields>
import { readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { TableName } from "../../../packages/core/src/index";
import { connect, signal } from "../s9-acl-delivery/connect";

const [workspace = "", instance = "pdi2", command = "", ...rest] = process.argv.slice(2);
const client = await connect(workspace, instance);
const query = (table: string, q: string, fields: string[], limit = 500) =>
  client.query({ table: TableName.parse(table), query: q, fields, limit }, signal);

async function updateSet(scopeId: string, name: string): Promise<string> {
  const q = `name=${name}^application=${scopeId}^state=in progress`;
  const found = await query("sys_update_set", q, ["sys_id"]);
  if (found[0]?.["sys_id"]) return String(found[0]["sys_id"]);
  const created = await client.sendJson(
    "POST",
    "/api/now/table/sys_update_set",
    { name, application: scopeId, state: "in progress" },
    "create update set",
    signal,
  );
  return String((created as { sys_id?: string } | null)?.sys_id ?? "");
}

switch (command) {
  case "set": {
    const [scopeId = "", name = ""] = rest;
    console.log(await updateSet(scopeId, name));
    break;
  }
  case "load": {
    const [scopeId = "", set = "", dir = "", ...names] = rest;
    const chosen = names.length > 0 ? names : readdirSync(dir).filter((n) => n.endsWith(".xml"));
    const files = chosen.map((n) => ({
      name: basename(n),
      content: readFileSync(join(dir, basename(n)), "utf8"),
    }));
    await client.fluent.load(scopeId, files, set, signal);
    console.log(`loaded ${files.length} files into ${set}`);
    break;
  }
  case "updates": {
    const [set = "", since = ""] = rest;
    const after = since === "" ? "" : `^sys_updated_on>${since}`;
    const rows = await query("sys_update_xml", `update_set=${set}${after}^ORDERBYname`, [
      "name",
      "type",
      "action",
      "target_name",
      "sys_updated_on",
    ]);
    for (const r of rows) {
      console.log(
        `${r["action"]}\t${r["type"]}\t${r["name"]}\t${r["target_name"]}\t${r["sys_updated_on"]}`,
      );
    }
    console.log(`${rows.length} updates`);
    break;
  }
  case "query": {
    const [table = "", q = "", fields = "sys_id"] = rest;
    for (const r of await query(table, q, fields.split(","))) console.log(JSON.stringify(r));
    break;
  }
  default:
    throw new Error(`unknown command ${command}`);
}

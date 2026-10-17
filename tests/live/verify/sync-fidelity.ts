// Test plan L0 (spec 009): is every record of a class in the mirror, field for field, as the
// instance holds it? Read-only on the instance. Writes an evidence bundle per group.
//   bun tests/live/verify/sync-fidelity.ts <workspace> <instance> <group...> [--evidence <dir>]
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fromYamlStrings } from "../../../packages/cli/src/adapters/yaml/own-style";
import { KeysetPager, type Row, TableName } from "../../../packages/core/src/index";
import { liveClient } from "./live-connection";
import { MirrorReader } from "./mirror-reader";

const GROUPS: Readonly<Record<string, { records: string[]; children: string[] }>> = {
  "L0-1": {
    records: [
      "sys_ui_policy",
      "sys_ui_policy_action",
      "sys_ui_policy_rl_action",
      "catalog_ui_policy",
      "catalog_ui_policy_action",
    ],
    children: [],
  },
  "L0-2": {
    records: [
      "sys_ui_action",
      "sys_ui_action_role",
      "sys_ui_action_view",
      "sys_declarative_action_assignment",
      "sys_ux_form_action",
    ],
    children: [],
  },
  "L0-3": { records: ["sys_app_application", "sys_app_module"], children: [] },
  "L0-4": { records: ["sys_user_role", "sys_user_role_contains"], children: [] },
  "L0-5": {
    records: ["sys_security_acl", "sys_security_acl_role", "sys_security_attribute"],
    children: [],
  },
  "L0-6": {
    records: ["sys_dictionary", "sys_dictionary_override", "sys_choice_set"],
    children: ["sys_choice"],
  },
  "L0-7": { records: ["sys_script_include"], children: ["sys_es_latest_script"] },
  "L0-8": { records: ["sysevent_in_email_action"], children: [] },
  // Positive control: on a mirror pulled before 2.1, every ES-latest row must be missing.
  "control-es-latest": { records: [], children: ["sys_es_latest_script"] },
  "L0-9": {
    records: ["sys_hub_flow", "sys_hub_action_type_definition"],
    children: [
      "sys_hub_trigger_instance_v2",
      "sys_hub_action_instance_v2",
      "sys_hub_flow_logic_instance_v2",
      "sys_hub_sub_flow_instance_v2",
      "sys_hub_flow_stage",
      "sys_hub_step_instance",
    ],
  },
};

const BATCH = 100;
const ROOT = "instances";
const signal = new AbortController().signal;
const normal = (value: string) => value.replace(/\r\n?/g, "\n").replace(/\n+$/, "");

interface Tally {
  instance: number;
  mirror: number;
  missing: string[];
  extra: string[];
  compared: number;
  changedSincePull: number;
  differences: Record<string, number>;
  examples: string[];
}

const newTally = (): Tally => ({
  instance: 0,
  mirror: 0,
  missing: [],
  extra: [],
  compared: 0,
  changedSincePull: 0,
  differences: {},
  examples: [],
});

function count(tally: Tally, key: string, example: string) {
  tally.differences[key] = (tally.differences[key] ?? 0) + 1;
  if (tally.examples.length < 10) tally.examples.push(example);
}

// One mirrored record or child row against the instance's row: every field the instance
// answers. Redacted fields and empty instance values the mirror leaves out are expected.
function compareRow(
  tally: Tally,
  id: string,
  live: Row,
  mirrored: (field: string) => string | undefined,
  redacted: ReadonlySet<string>,
) {
  for (const [field, value] of Object.entries(live)) {
    if (redacted.has(field)) continue;
    const kept = mirrored(field);
    if (kept === undefined) {
      if (value !== "") count(tally, `absent ${field}`, `${id} ${field}`);
    } else if (normal(kept) !== normal(value)) {
      count(tally, `differs ${field}`, `${id} ${field}`);
    }
  }
}

async function liveRows(pager: KeysetPager, table: string, base: string, fields: string[] | "all") {
  const rows: Row[] = [];
  const listing = {
    table: TableName.parse(table),
    fields,
    kind: "snapshot" as const,
    base,
    allDomains: true,
  };
  for await (const row of pager.rows(listing, signal)) rows.push(row);
  return rows;
}

// Mirrored records of a table by sys_id (base path without .yaml), and their field files.
function mirroredRecords(paths: readonly string[], table: string) {
  const pattern = new RegExp(`/${table}/[^/]+--([0-9a-f]{32})\\.yaml$`);
  const bases = new Map<string, string>();
  for (const path of paths) {
    const id = pattern.exec(path)?.[1];
    if (id !== undefined) bases.set(id, path.slice(0, -".yaml".length));
  }
  const known = new Set(bases.values());
  const files = new Map<string, Map<string, string>>();
  for (const path of paths) {
    const cut = path.lastIndexOf("--");
    const dot = cut < 0 ? -1 : path.indexOf(".", cut);
    const base = dot < 0 ? "" : path.slice(0, dot);
    if (path.endsWith(".yaml") || !known.has(base)) continue;
    const field = path.slice(dot + 1).split(".")[0] ?? "";
    files.set(base, (files.get(base) ?? new Map()).set(field, path));
  }
  return { bases, files };
}

// One record against the instance's row; false when it changed since the pull.
async function compareRecord(
  tally: Tally,
  mirror: MirrorReader,
  row: Row,
  base: string,
  files: ReadonlyMap<string, string>,
): Promise<boolean> {
  const text = (await mirror.read(`${base}.yaml`)) ?? "";
  const document = fromYamlStrings(text) as Record<string, unknown>;
  const meta = (document["_meta"] ?? {}) as Record<string, unknown>;
  if ((row["sys_updated_on"] ?? "") !== String(meta["sys_updated_on"] ?? "")) return false;
  const redacted = new Set(Array.isArray(meta["redacted"]) ? meta["redacted"].map(String) : []);
  const sidecars = new Map<string, string>();
  for (const [field, path] of files) sidecars.set(field, (await mirror.read(path)) ?? "");
  const value = (field: string) => {
    const own = document[field] ?? meta[field];
    return typeof own === "string" ? own : sidecars.get(field);
  };
  compareRow(tally, row["sys_id"] ?? "", row, value, redacted);
  return true;
}

async function verifyRecords(
  pager: KeysetPager,
  mirror: MirrorReader,
  paths: readonly string[],
  table: string,
  cutoff: string,
): Promise<Tally> {
  const tally = newTally();
  const { bases, files } = mirroredRecords(paths, table);
  const ids = await liveRows(pager, table, `sys_class_name=${table}`, ["sys_id", "sys_updated_on"]);
  const live = new Map(ids.map((row) => [row["sys_id"] ?? "", row["sys_updated_on"] ?? ""]));
  tally.instance = live.size;
  tally.mirror = bases.size;
  tally.missing = [...live].filter(([id, on]) => !bases.has(id) && on < cutoff).map(([id]) => id);
  tally.extra = [...bases.keys()].filter((id) => !live.has(id));
  const shared = [...bases.keys()].filter((id) => live.has(id)).sort();
  for (let i = 0; i < shared.length; i += BATCH) {
    const base = `sys_idIN${shared.slice(i, i + BATCH).join(",")}`;
    for (const row of await liveRows(pager, table, base, "all")) {
      const own = bases.get(row["sys_id"] ?? "") ?? "";
      const same = await compareRecord(tally, mirror, row, own, files.get(own) ?? new Map());
      if (same) tally.compared += 1;
      else tally.changedSincePull += 1;
    }
  }
  return tally;
}

// Child rows: every row of the table against the rows of the mirror's child files, by sys_id.
// A missing row whose owner the mirror doesn't hold is an orphan by design (M3), not a gap.
async function verifyChildren(
  pager: KeysetPager,
  mirror: MirrorReader,
  paths: readonly string[],
  table: string,
): Promise<Tally & { orphans: number }> {
  const tally = newTally();
  const mirrored = new Map<string, Row>();
  for (const path of paths.filter((p) => p.endsWith(`.children.${table}.yaml`))) {
    const rows = fromYamlStrings((await mirror.read(path)) ?? "");
    for (const row of Array.isArray(rows) ? (rows as Row[]) : []) {
      mirrored.set(String(row["sys_id"] ?? ""), row);
    }
  }
  const live = await liveRows(pager, table, "", "all");
  tally.instance = live.length;
  tally.mirror = mirrored.size;
  const liveIds = new Set(live.map((row) => row["sys_id"] ?? ""));
  tally.extra = [...mirrored.keys()].filter((id) => !liveIds.has(id));
  let orphans = 0;
  for (const row of live) {
    const id = row["sys_id"] ?? "";
    const kept = mirrored.get(id);
    if (kept === undefined) {
      orphans += 1;
      continue;
    }
    tally.compared += 1;
    compareRow(tally, `${table}:${id}`, row, (field) => kept[field], new Set());
  }
  return { ...tally, orphans };
}

async function main() {
  const args = process.argv.slice(2);
  const evidenceAt = args.indexOf("--evidence");
  const evidence = evidenceAt >= 0 ? args.splice(evidenceAt, 2)[1] : undefined;
  const [workspace = ".", instance = "", ...groups] = args;
  const repository = resolve(workspace);
  const mirror = new MirrorReader(repository, `servicenow-remote/${instance}`);
  const paths = await mirror.paths(`${ROOT}/${instance}/metadata`);
  const tip = Bun.spawnSync(["git", "log", "-1", "--format=%cI", `servicenow-remote/${instance}`], {
    cwd: repository,
  });
  const cutoff = new Date(tip.stdout.toString().trim())
    .toISOString()
    .slice(0, 19)
    .replace("T", " ");
  const pager = new KeysetPager(await liveClient(instance, repository));
  for (const group of groups) {
    const spec = GROUPS[group];
    if (spec === undefined) throw new Error(`unknown group ${group}`);
    const result: Record<string, unknown> = { group, cutoff };
    for (const table of spec.records) {
      result[table] = await verifyRecords(pager, mirror, paths, table, cutoff);
      console.log(group, table, summary(result[table] as Tally));
    }
    for (const table of spec.children) {
      result[table] = await verifyChildren(pager, mirror, paths, table);
      console.log(group, table, summary(result[table] as Tally));
    }
    if (evidence !== undefined) {
      mkdirSync(join(evidence, group), { recursive: true });
      writeFileSync(join(evidence, group, "summary.json"), `${JSON.stringify(result, null, 2)}\n`);
    }
  }
  mirror.close();
}

function summary(tally: Tally & { orphans?: number }): string {
  const orphans = tally.orphans === undefined ? "" : `, ${tally.orphans} not in the mirror`;
  return `instance ${tally.instance}, mirror ${tally.mirror}, missing ${tally.missing.length}, extra ${tally.extra.length}${orphans}; compared ${tally.compared} (changed since pull ${tally.changedSincePull}); differences ${JSON.stringify(tally.differences)}`;
}

await main();
